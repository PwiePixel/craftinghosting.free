/**
 * Admin-Bereich: Server eines Kunden aufwerten (anderes Paket) und auf eine bestimmte Node umziehen –
 * auch auf eine private Node, die für neue kostenlose Server nie verwendet wird.
 *
 * Paketwechsel: Ressourcen und Slots werden sofort im Panel gesetzt, der Port bleibt.
 * Umzug: Nicht jedes Panel bietet ihn per Schnittstelle an (Pelican ja, das klassische Pterodactyl nicht).
 *  – „api“: Das Panel hat den Umzug gestartet; er läuft im Hintergrund.
 *  – „manual“: Das Team verschiebt den Server im Panel (Admin → Servers → Manage → Transfer).
 * In beiden Fällen prüft ein Job jede Minute, ob der Server auf der neuen Node angekommen ist, übernimmt die
 * neue Adresse und informiert den Kunden.
 */
import { and, eq, isNotNull } from 'drizzle-orm';
import { allPlans, findPlan, type AdminUpgradeOptionsDTO, type AdminUpgradeResultDTO, type PlanSetting } from '@chfree/shared';
import { db } from '../db/client';
import { servers, users, type Server } from '../db/schema';
import { sendDm } from '../discord/invite-rewards';
import { mapLimit } from '../jobs/types';
import { ApiError, Errors, L } from '../lib/errors';
import { pterodactyl } from '../pterodactyl';
import { PterodactylError, type PteroNode, type PteroServer } from '../pterodactyl/types';
import { audit } from './audit.service';
import { notify } from './notification.service';
import { trySyncPanelDescription } from './panel';
import { getSettings } from './settings.service';

const UPGRADABLE: Server['status'][] = ['active', 'expiring', 'suspended'];
const COLOR = 0x22c55e;

const gb = (mb: number) => (mb < 1024 ? `${mb} MB` : `${mb % 1024 === 0 ? mb / 1024 : (mb / 1024).toFixed(1)} GB`);
const planLine = (p: Pick<PlanSetting, 'name' | 'memoryMb' | 'cpuPercent' | 'diskMb'>, l: 'de' | 'en') =>
  l === 'en' ? `${p.name} (${gb(p.memoryMb)} RAM, ${p.cpuPercent} % CPU, ${gb(p.diskMb)} storage)` : `${p.name} (${gb(p.memoryMb)} RAM, ${p.cpuPercent} % CPU, ${gb(p.diskMb)} Speicher)`;
const address = (p: PteroServer) => (p.allocation ? `${p.allocation.alias || p.allocation.ip}:${p.allocation.port}` : null);
const panelError = (err: unknown) => (err instanceof PterodactylError ? `${err.message}${err.status ? ` (Fehler ${err.status})` : ''}` : (err as Error).message).slice(0, 220);

async function loadServer(id: string): Promise<Server> {
  const [server] = await db.select().from(servers).where(eq(servers.id, id)).limit(1);
  if (!server || server.status === 'deleted') throw Errors.notFound(L('Server nicht gefunden.', 'Server not found.'));
  return server;
}

function assertUpgradable(server: Server): number {
  if (!server.pteroServerId || !UPGRADABLE.includes(server.status)) {
    throw Errors.conflict('not_upgradable', L('Dieser Server ist im Panel noch nicht angelegt – ändern lässt er sich erst danach.', 'This server has not been created in the panel yet.'));
  }
  return server.pteroServerId;
}

/** Node, auf der der Server liegt – beim ersten Mal aus dem Panel gelesen und gemerkt */
async function currentNodeId(server: Server): Promise<number | null> {
  if (server.nodeId !== null) return server.nodeId;
  if (!server.pteroServerId) return null;
  const p = await pterodactyl().getServer(server.pteroServerId).catch(() => null);
  if (!p || p.nodeId === null) return null;
  await db.update(servers).set({ nodeId: p.nodeId }).where(eq(servers.id, server.id));
  return p.nodeId;
}

/** Auswahl für den Dialog „Upgrade / Umzug“: Pakete dieses Angebots und alle Nodes mit freien Ports */
export async function upgradeOptions(id: string): Promise<AdminUpgradeOptionsDTO> {
  const server = await loadServer(id);
  const settings = await getSettings();
  const ptero = pterodactyl();
  const nodes = await ptero.listNodes().catch(() => [] as PteroNode[]);
  const free = new Map<number, number | null>();
  await mapLimit(nodes, 4, async (n) => void free.set(n.id, await ptero.freeAllocations(n.id).then((f) => f.count, () => null)));
  return {
    server: {
      id: server.id,
      name: server.name,
      kind: server.kind,
      status: server.status,
      planId: server.planId,
      nodeId: await currentNodeId(server),
      upgrade: server.upgradedAt ? { at: server.upgradedAt.toISOString(), note: server.upgradeNote } : null,
      transfer: server.transferNodeId !== null ? { nodeId: server.transferNodeId, mode: server.transferMode ?? 'manual', startedAt: (server.transferStartedAt ?? new Date()).toISOString() } : null,
    },
    plans: allPlans(settings)
      .filter((p) => p.kind === server.kind)
      .sort((a, b) => a.memoryMb - b.memoryMb)
      .map((p) => ({ id: p.id, name: p.name, memoryMb: p.memoryMb, cpuPercent: p.cpuPercent, diskMb: p.diskMb, enabled: p.enabled })),
    nodes: nodes.map((n) => ({
      id: n.id,
      name: n.name,
      private: settings.privateNodeIds.includes(n.id),
      maintenance: n.maintenanceMode,
      freePorts: free.get(n.id) ?? null,
      use: settings.products.discord.nodeIds.includes(n.id) ? ('discord' as const) : settings.products.minecraft.nodeIds.includes(n.id) ? ('minecraft' as const) : null,
    })),
  };
}

export interface AdminUpgradeInput {
  /** Neues Paket (null/gleich = unverändert) */
  planId?: string | null;
  /** Ziel-Node (null/gleich = unverändert) */
  nodeId?: number | null;
  /** Server beim Kunden als „Upgrade“ kennzeichnen (false = Kennzeichnung entfernen) */
  markUpgrade: boolean;
  /** Hinweis für den Kunden (erscheint an der Kennzeichnung und in der Benachrichtigung) */
  note: string;
  /** Kunden benachrichtigen (E-Mail und Discord-Direktnachricht) */
  notify: boolean;
}

export async function adminUpgradeServer(admin: { email: string }, id: string, input: AdminUpgradeInput, ip?: string): Promise<AdminUpgradeResultDTO> {
  const server = await loadServer(id);
  const pteroId = assertUpgradable(server);
  const settings = await getSettings();
  const ptero = pterodactyl();
  const now = new Date();
  const note = input.note.trim().slice(0, 300);

  const oldPlan = findPlan(settings, server.planId);
  const newPlan = input.planId && input.planId !== server.planId ? findPlan(settings, input.planId) : undefined;
  if (input.planId && input.planId !== server.planId && (!newPlan || newPlan.kind !== server.kind)) {
    throw Errors.conflict('plan_unknown', L('Dieses Paket gibt es für diesen Server nicht.', 'This plan does not exist for this server.'));
  }
  const fromNode = await currentNodeId(server);
  const toNode = input.nodeId && input.nodeId !== fromNode ? input.nodeId : null;
  const markChanged = input.markUpgrade !== !!server.upgradedAt || (input.markUpgrade && note !== (server.upgradeNote ?? ''));
  if (!newPlan && !toNode && !markChanged) {
    throw Errors.conflict('nothing_to_do', L('Es gibt nichts zu ändern – wähle ein anderes Paket, eine andere Node oder ändere die Kennzeichnung.', 'Nothing to change.'));
  }

  if (toNode && server.transferNodeId !== null) {
    throw Errors.conflict('transfer_running', L('Für diesen Server läuft schon ein Umzug. Brich ihn zuerst ab oder warte, bis er fertig ist.', 'A move is already in progress for this server.'));
  }
  // Ziel-Node prüfen, bevor irgendetwas geändert wird
  let target: PteroNode | undefined;
  let allocationId: number | null = null;
  if (toNode) {
    try {
      target = (await ptero.listNodes()).find((n) => n.id === toNode);
      if (!target) throw Errors.conflict('node_unknown', L('Diese Node gibt es im Panel nicht (mehr).', 'This node does not exist in the panel.'));
      allocationId = (await ptero.freeAllocations(toNode)).firstId;
    } catch (err) {
      if (err instanceof ApiError) throw err;
      throw new ApiError(502, 'panel_error', L(`Das Panel antwortet nicht wie erwartet: ${panelError(err)}`, `The panel did not answer as expected: ${panelError(err)}`));
    }
    if (allocationId === null) {
      throw Errors.conflict('node_full', L(`Auf der Node „${target.name}“ ist kein freier Port (Allokation). Bitte im Panel weitere Ports anlegen.`, `There is no free port (allocation) on node “${target.name}”.`));
    }
  }

  // 1) Paket
  if (newPlan) {
    try {
      await ptero.updateServerBuild(
        pteroId,
        { memory: newPlan.memoryMb, disk: newPlan.diskMb, cpu: newPlan.cpuPercent, swap: newPlan.swapMb, io: newPlan.ioWeight },
        { databases: newPlan.databases, allocations: newPlan.allocations, backups: newPlan.backups },
      );
    } catch (err) {
      throw new ApiError(502, 'panel_error', L(`Das Paket konnte im Panel nicht geändert werden: ${panelError(err)}`, `The plan could not be changed in the panel: ${panelError(err)}`));
    }
    await db.update(servers).set({ planId: newPlan.id, memoryMb: newPlan.memoryMb, diskMb: newPlan.diskMb, cpuPercent: newPlan.cpuPercent }).where(eq(servers.id, id));
  }

  // 2) Umzug
  let transfer: AdminUpgradeResultDTO['transfer'] = 'none';
  let transferError: string | null = null;
  if (toNode && target && allocationId !== null) {
    try {
      transfer = (await ptero.transferServer(pteroId, toNode, allocationId)) === 'started' ? 'started' : 'manual';
    } catch (err) {
      // Das Paket ist schon geändert – deshalb kein Abbruch, sondern eine klare Meldung
      transferError = panelError(err);
    }
    if (transfer !== 'none') {
      await db
        .update(servers)
        .set({ transferNodeId: toNode, transferStartedAt: now, transferMode: transfer === 'started' ? 'api' : 'manual' })
        .where(eq(servers.id, id));
    }
  }

  // 3) Kennzeichnung
  if (markChanged || (input.markUpgrade && (newPlan || transfer !== 'none'))) {
    await db
      .update(servers)
      .set(input.markUpgrade ? { upgradedAt: now, upgradeNote: note || null } : { upgradedAt: null, upgradeNote: null })
      .where(eq(servers.id, id));
  }
  await trySyncPanelDescription(id);

  const changes = [
    newPlan ? `Paket ${oldPlan?.name ?? server.planId} → ${newPlan.name}` : null,
    transfer === 'started' ? `Umzug auf Node „${target!.name}“ gestartet` : transfer === 'manual' ? `Umzug auf Node „${target!.name}“ vorgemerkt (im Panel verschieben)` : null,
    transferError ? `Umzug auf Node „${target?.name}“ fehlgeschlagen: ${transferError}` : null,
    markChanged ? (input.markUpgrade ? 'als Upgrade gekennzeichnet' : 'Upgrade-Kennzeichnung entfernt') : null,
  ].filter(Boolean);
  await audit({ userId: server.userId, serverId: id, actor: 'admin', action: 'admin.server_upgraded', message: `Server „${server.name}“: ${changes.join(', ')} (durch ${admin.email})`, ip });

  // 4) Kunde
  let notified = false;
  const worthTelling = !!newPlan || transfer !== 'none' || (markChanged && input.markUpgrade);
  if (input.notify && worthTelling) {
    const moving = transfer !== 'none';
    const lines = (l: 'de' | 'en') =>
      [
        input.markUpgrade
          ? l === 'en'
            ? `Good news: our team has upgraded your server “${server.name}”.`
            : `Gute Nachrichten: Unser Team hat deinen Server „${server.name}“ aufgewertet.`
          : l === 'en'
            ? `Our team has changed your server “${server.name}”.`
            : `Unser Team hat deinen Server „${server.name}“ angepasst.`,
        newPlan ? (l === 'en' ? `New plan: ${planLine(newPlan, l)}${oldPlan ? ` – previously ${oldPlan.name}` : ''}.` : `Neues Paket: ${planLine(newPlan, l)}${oldPlan ? ` – bisher ${oldPlan.name}` : ''}.`) : null,
        moving
          ? l === 'en'
            ? 'Your server is being moved to a different node. It is briefly unavailable during the move and its address may change – we will let you know as soon as the move is complete.'
            : 'Dein Server zieht auf eine andere Node um. Während des Umzugs ist er kurz nicht erreichbar, und die Adresse kann sich ändern – wir melden uns, sobald der Umzug abgeschlossen ist.'
          : null,
        note ? (l === 'en' ? `Note from the team: ${note}` : `Hinweis vom Team: ${note}`) : null,
        l === 'en' ? 'You do not need to do anything – your data stays as it is.' : 'Du musst nichts tun – deine Daten bleiben erhalten.',
      ]
        .filter(Boolean)
        .join('\n');
    const title = input.markUpgrade
      ? L(`Dein Server „${server.name}“ hat ein Upgrade bekommen 🎉`, `Your server “${server.name}” has been upgraded 🎉`)
      : L(`Änderung an deinem Server „${server.name}“`, `Change to your server “${server.name}”`);
    notified = await notify({ userId: server.userId, serverId: id, type: 'server.upgraded', title, body: (l) => lines(l), dedupeKey: `server-upgrade:${id}:${now.getTime()}`, email: true });
    const [owner] = await db.select({ discordId: users.discordId }).from(users).where(eq(users.id, server.userId)).limit(1);
    if (owner?.discordId && settings.discord.enabled) {
      await sendDm(owner.discordId, {
        embeds: [{ title: input.markUpgrade ? '🎉 Server-Upgrade' : 'ℹ️ Server-Änderung · Server change', color: COLOR, description: `🇩🇪 ${lines('de')}\n\n🇬🇧 ${lines('en')}`, footer: { text: 'CraftingHosting.free' } }],
      }).catch(() => false);
    }
  }

  const message = [
    newPlan ? `Paket auf ${newPlan.name} geändert.` : null,
    transfer === 'started' ? `Der Umzug auf „${target!.name}“ läuft – sobald er fertig ist, wird die neue Adresse übernommen und der Kunde informiert.` : null,
    transfer === 'manual'
      ? `Dieses Panel bietet den Umzug nicht per Schnittstelle an. Bitte verschiebe den Server jetzt im Panel (Admin → Servers → Server öffnen → Manage → Transfer Server) auf „${target!.name}“. Sobald er dort liegt, wird die neue Adresse automatisch übernommen und der Kunde informiert.`
      : null,
    transferError ? `Der Umzug konnte nicht gestartet werden: ${transferError}` : null,
    markChanged ? (input.markUpgrade ? 'Als Upgrade gekennzeichnet.' : 'Upgrade-Kennzeichnung entfernt.') : null,
    notified ? 'Der Kunde wurde benachrichtigt.' : null,
  ]
    .filter(Boolean)
    .join(' ');
  return { planChanged: !!newPlan, transfer, transferError, notified, message };
}

/** Umzug abgeschlossen: neue Node und Adresse übernehmen, Kunden informieren */
async function finishTransfer(server: Server, p: PteroServer): Promise<void> {
  const newAddress = address(p) ?? server.address;
  await db
    .update(servers)
    .set({ nodeId: p.nodeId, address: newAddress, transferNodeId: null, transferStartedAt: null, transferMode: null })
    .where(and(eq(servers.id, server.id), isNotNull(servers.transferNodeId)));
  await trySyncPanelDescription(server.id);
  await audit({ userId: server.userId, serverId: server.id, actor: 'system', action: 'server.transfer_done', message: `Umzug von „${server.name}“ abgeschlossen: Node ${p.nodeId}, Adresse ${newAddress ?? '–'}` });
  const changed = newAddress !== server.address;
  await notify({
    userId: server.userId,
    serverId: server.id,
    type: 'server.transfer_done',
    title: L(`Umzug abgeschlossen: „${server.name}“`, `Move complete: “${server.name}”`),
    body: (l) =>
      l === 'en'
        ? `Your server “${server.name}” has moved to its new node and can be used again.\n${changed && newAddress ? `New address: ${newAddress} – please use it from now on.` : 'The address has not changed.'}`
        : `Dein Server „${server.name}“ ist auf die neue Node umgezogen und kann wieder genutzt werden.\n${changed && newAddress ? `Neue Adresse: ${newAddress} – bitte ab jetzt diese verwenden.` : 'Die Adresse ist gleich geblieben.'}`,
    dedupeKey: `server-transfer-done:${server.id}:${server.transferStartedAt?.getTime() ?? 0}`,
    email: true,
  });
}

/** Prüft laufende Umzüge: Liegt der Server laut Panel auf der neuen Node? (Job, jede Minute – und auf Knopfdruck) */
export async function checkServerTransfers(onlyId?: string): Promise<{ open: number; finished: number }> {
  const rows = await db
    .select()
    .from(servers)
    .where(onlyId ? and(eq(servers.id, onlyId), isNotNull(servers.transferNodeId)) : isNotNull(servers.transferNodeId));
  let finished = 0;
  for (const server of rows) {
    if (!server.pteroServerId || server.status === 'deleted') {
      await db.update(servers).set({ transferNodeId: null, transferStartedAt: null, transferMode: null }).where(eq(servers.id, server.id));
      continue;
    }
    const p = await pterodactyl().getServer(server.pteroServerId).catch(() => null);
    if (!p || p.nodeId === null) continue;
    // Von Hand verschoben zählt auch eine andere Node als die vorgemerkte – maßgeblich ist, wo der Server wirklich liegt
    const arrived = p.nodeId === server.transferNodeId || (server.transferMode === 'manual' && server.nodeId !== null && p.nodeId !== server.nodeId);
    if (!arrived) continue;
    await finishTransfer(server, p);
    finished++;
  }
  return { open: rows.length - finished, finished };
}

/** Umzug abbrechen: im Panel (soweit möglich) und in der eigenen Vormerkung */
export async function cancelServerTransfer(admin: { email: string }, id: string, ip?: string): Promise<{ panelCancelled: boolean }> {
  const server = await loadServer(id);
  if (server.transferNodeId === null) throw Errors.conflict('no_transfer', L('Für diesen Server läuft kein Umzug.', 'No move is in progress for this server.'));
  const panelCancelled = server.transferMode === 'api' && server.pteroServerId ? await pterodactyl().cancelServerTransfer(server.pteroServerId) : false;
  await db.update(servers).set({ transferNodeId: null, transferStartedAt: null, transferMode: null }).where(eq(servers.id, id));
  await audit({ userId: server.userId, serverId: id, actor: 'admin', action: 'admin.transfer_cancelled', message: `Umzug von „${server.name}“ abgebrochen${panelCancelled ? '' : ' (nur die Vormerkung – im Panel ggf. selbst abbrechen)'} (durch ${admin.email})`, ip });
  return { panelCancelled };
}
