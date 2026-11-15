/**
 * Belohnungen für Server-Boosts (Admin → Discord → Belohnungen).
 *
 * Solange jemand den Discord-Server boostet, bekommt der verknüpfte Website-Account zusätzliche Server – je nach
 * Anzahl der Boosts (es gilt die höchste erreichte Stufe, Stufen addieren sich nicht). Steigt jemand in eine
 * höhere Stufe auf und hat schon einen Server im kleineren Paket, wird dieser automatisch auf das größere
 * Paket hochgestuft.
 *
 * Discord nennt Bots nicht, wie oft ein Mitglied boostet. Gezählt werden deshalb die Boost-Meldungen im
 * Systemkanal („… hat den Server geboostet“), solange das Mitglied boostet; endet der Boost ganz, steht die
 * Zählung wieder auf null. Nimmt jemand nur einen von mehreren Boosts zurück, merkt der Bot das nicht – dafür
 * lässt sich die Anzahl im Admin-Bereich von Hand setzen.
 *
 * Endet ein Boost, laufen die Boost-Server bis zum Ende ihrer Laufzeit weiter; verlängern (reaktivieren) lassen
 * sie sich nur, solange sie in die dann geltenden Grenzen passen.
 */
import { and, desc, eq, inArray, isNotNull, sql } from 'drizzle-orm';
import { boostTierFor, type BonusSlot, type BoostRewardSlot, type Localized, type PlanSetting, type ProductKind, type SiteSettings } from '@chfree/shared';
import { affectedRows, db } from '../db/client';
import { discordBoosts, servers, users, type DiscordBoost, type Server } from '../db/schema';
import { env } from '../env';
import { pterodactyl } from '../pterodactyl';
import { audit } from '../services/audit.service';
import { getSettings } from '../services/settings.service';
import { sendDm } from './invite-rewards';
import type { DiscordMember } from './rest';
import { botRequest, discordConfig } from './service';

const COLOR = 0xf47fff;
const both = (t: Localized) => `🇩🇪 ${t.de}\n🇬🇧 ${t.en}`;
const KIND_NAME: Record<ProductKind, Localized> = { minecraft: { de: 'Minecraft-Server', en: 'Minecraft server' }, discord: { de: 'Discord-Bot', en: 'Discord bot' } };

/** Aktuelle Anzahl der Boosts eines Kontos */
export function boostCount(row: Pick<DiscordBoost, 'premium' | 'messages' | 'manual'> | undefined): number {
  if (!row) return 0;
  if (row.manual !== null) return row.manual;
  return row.premium ? Math.max(1, row.messages) : 0;
}

async function boostRow(discordId: string): Promise<DiscordBoost | undefined> {
  const [row] = await db.select().from(discordBoosts).where(eq(discordBoosts.discordId, discordId)).limit(1);
  return row;
}

/* ------------------------------------------------------------ Slots je Stufe */

export interface ResolvedBoostSlot {
  kind: ProductKind;
  plan: PlanSetting;
}

/** Paket eines Boost-Slots: kleinstes/größtes aktives Paket des Angebots oder ein bestimmtes */
function resolveSlot(settings: SiteSettings, slot: BoostRewardSlot): ResolvedBoostSlot | null {
  const plans = settings.products[slot.kind].plans;
  const active = [...plans].filter((p) => p.enabled).sort((a, b) => a.memoryMb - b.memoryMb);
  const plan = slot.planId === 'smallest' ? active[0] : slot.planId === 'largest' ? active[active.length - 1] : plans.find((p) => p.id === slot.planId);
  return plan ? { kind: slot.kind, plan } : null;
}

/** Zusätzliche Server für eine Anzahl Boosts (leer = keine bzw. Boost-Belohnungen aus) */
export function boostSlots(settings: SiteSettings, boosts: number): ResolvedBoostSlot[] {
  const tier = boostTierFor(settings.discord.boostRewards, boosts);
  return tier ? tier.slots.map((s) => resolveSlot(settings, s)).filter((s): s is ResolvedBoostSlot => s !== null) : [];
}

/** „1× Minecraft-Server Free 6 GB und 1× Minecraft-Server Free 4 GB“ */
export function slotsText(slots: ResolvedBoostSlot[], lang: 'de' | 'en'): string {
  const groups = new Map<string, { n: number; text: string }>();
  for (const s of slots) {
    const key = `${s.kind}:${s.plan.id}`;
    const g = groups.get(key) ?? { n: 0, text: `${KIND_NAME[s.kind][lang]} ${s.plan.name}` };
    g.n++;
    groups.set(key, g);
  }
  const parts = [...groups.values()].map((g) => `${g.n}× ${g.text}`);
  return parts.join(lang === 'de' ? ' und ' : ' and ');
}

/** Zusätzliche Slots des Accounts aus seinen aktuellen Boosts */
export async function boostBonusSlots(discordId: string | null, settings: SiteSettings): Promise<BonusSlot[]> {
  if (!discordId || !settings.discord.boostRewards.enabled) return [];
  return boostSlots(settings, boostCount(await boostRow(discordId))).map((s) => ({ kind: s.kind, planId: s.plan.id }));
}

/** Hatte dieses Konto je Boost-Belohnungen? Dann werden die Grenzen auch beim Verlängern geprüft. */
export async function hadBoostRewards(discordId: string | null): Promise<boolean> {
  return !!discordId && !!(await boostRow(discordId));
}

/* ------------------------------------------------------------ Änderungen anwenden */

/** Stuft einen Server auf ein größeres Paket hoch (Ressourcen im Panel und im eigenen Datenbestand) */
async function upgradeServer(server: Server, plan: PlanSetting): Promise<boolean> {
  if (!server.pteroServerId) return false;
  try {
    await pterodactyl().updateServerBuild(
      server.pteroServerId,
      { memory: plan.memoryMb, disk: plan.diskMb, cpu: plan.cpuPercent, swap: plan.swapMb, io: plan.ioWeight },
      { databases: plan.databases, allocations: plan.allocations, backups: plan.backups },
    );
  } catch {
    return false;
  }
  await db.update(servers).set({ planId: plan.id, memoryMb: plan.memoryMb, diskMb: plan.diskMb, cpuPercent: plan.cpuPercent }).where(eq(servers.id, server.id));
  await audit({ userId: server.userId, serverId: server.id, actor: 'system', action: 'discord.boost_upgrade', message: `Server „${server.name}“ wegen Server-Boost auf das Paket ${plan.name} hochgestuft` });
  return true;
}

/**
 * Welche Slots fallen weg und werden durch ein größeres Paket desselben Angebots ersetzt?
 * (1 Boost → 2 Boosts: kleines Paket weg, großes dazu → der vorhandene kleine Server wird hochgestuft)
 */
function upgradePairs(before: ResolvedBoostSlot[], after: ResolvedBoostSlot[]): { from: ResolvedBoostSlot; to: ResolvedBoostSlot }[] {
  const key = (s: ResolvedBoostSlot) => `${s.kind}:${s.plan.id}`;
  const added = [...after];
  const removed: ResolvedBoostSlot[] = [];
  for (const s of before) {
    const i = added.findIndex((a) => key(a) === key(s));
    if (i === -1) removed.push(s);
    else added.splice(i, 1);
  }
  const pairs: { from: ResolvedBoostSlot; to: ResolvedBoostSlot }[] = [];
  for (const from of removed) {
    const i = added.findIndex((a) => a.kind === from.kind && a.plan.memoryMb > from.plan.memoryMb);
    if (i !== -1) pairs.push({ from, to: added.splice(i, 1)[0]! });
  }
  return pairs;
}

async function notify(discordId: string, settings: SiteSettings, text: Localized): Promise<void> {
  const delivered = await sendDm(discordId, { embeds: [{ title: '💜 Server-Boost', color: COLOR, description: both(text), footer: { text: 'CraftingHosting.free · !rewards' } }] });
  const channelId = settings.discord.inviteRewards.fallbackChannelId;
  if (delivered || !channelId) return;
  await botRequest('POST', `/channels/${channelId}/messages`, {
    json: {
      content: `<@${discordId}>\n${both({
        de: '💜 Danke für deinen Boost! Dafür gibt es bei uns zusätzliche Server. Weil deine Direktnachrichten deaktiviert sind, melde ich mich hier: Schreibe mir per Direktnachricht `!rewards`, dann zeige ich dir alles.',
        en: '💜 Thank you for boosting! You get extra servers for it. Because your direct messages are disabled, I am letting you know here: send me `!rewards` as a direct message and I will show you everything.',
      })}`,
      allowed_mentions: { parse: [], users: [discordId] },
    },
  }).catch(() => null);
}

/**
 * Gleicht die Belohnungen eines Kontos mit seiner aktuellen Boost-Anzahl ab: stuft bei einem Aufstieg den
 * vorhandenen kleineren Server hoch und benachrichtigt das Mitglied. Jede Änderung wird genau einmal verarbeitet.
 */
export async function applyBoosts(discordId: string): Promise<void> {
  if (env.BETA_MODE) return;
  const row = await boostRow(discordId);
  if (!row) return;
  const now = boostCount(row);
  if (now === row.applied) return;
  // Nur ein Lauf verarbeitet die Änderung (API und Worker können gleichzeitig hier ankommen)
  const claimed = await db
    .update(discordBoosts)
    .set({ applied: now, updatedAt: new Date() })
    .where(and(eq(discordBoosts.discordId, discordId), eq(discordBoosts.applied, row.applied)));
  if (affectedRows(claimed) !== 1) return;

  const settings = await getSettings();
  const before = boostSlots(settings, row.applied);
  const after = boostSlots(settings, now);
  if (before.length === 0 && after.length === 0) return; // Boost-Belohnungen aus oder keine Stufe betroffen
  const [account] = await db.select().from(users).where(eq(users.discordId, discordId)).limit(1);

  const upgraded: { name: string; plan: string }[] = [];
  if (account && now > row.applied) {
    for (const pair of upgradePairs(before, after)) {
      const [server] = await db
        .select()
        .from(servers)
        .where(and(eq(servers.userId, account.id), eq(servers.kind, pair.from.kind), eq(servers.planId, pair.from.plan.id), inArray(servers.status, ['active', 'expiring']), isNotNull(servers.pteroServerId)))
        .orderBy(desc(servers.createdAt))
        .limit(1);
      if (server && (await upgradeServer(server, pair.to.plan))) upgraded.push({ name: server.name, plan: pair.to.plan.name });
    }
  }
  await audit({ userId: account?.id ?? null, actor: 'system', action: 'discord.boosts_changed', message: `Server-Boosts von Discord-Konto ${discordId}: ${row.applied} → ${now}${upgraded.length ? ` (${upgraded.length} Server hochgestuft)` : ''}` });

  const start = `${env.APP_URL}/de/start`;
  const link: Localized = account
    ? { de: ` Erstellen kannst du sie hier: ${start}`, en: ` You can create them here: ${env.APP_URL}/start` }
    : { de: ` Verknüpfe dafür dein Discord-Konto mit einem CraftingHosting.free-Account: ${env.APP_URL}/de/meine-server`, en: ` To use them, link your Discord account with a CraftingHosting.free account: ${env.APP_URL}/my-servers` };
  const up: Localized = upgraded.length
    ? {
        de: `\n⬆️ ${upgraded.map((u) => `Dein Server „${u.name}“ wurde automatisch auf **${u.plan}** hochgestuft`).join('; ')} – starte ihn einmal neu, damit die neuen Ressourcen gelten.`,
        en: `\n⬆️ ${upgraded.map((u) => `Your server “${u.name}” has been upgraded to **${u.plan}** automatically`).join('; ')} – restart it once so that the new resources apply.`,
      }
    : { de: '', en: '' };
  if (now > row.applied && after.length > 0) {
    return notify(discordId, settings, {
      de: `Danke für deinen Boost! Du boostest unseren Discord-Server jetzt **${now}×** – dafür bekommst du zusätzlich: **${slotsText(after, 'de')}**.${up.de}${link.de}\nSolange dein Boost läuft, kannst du diese Server nutzen und verlängern.`,
      en: `Thank you for boosting! You now boost our Discord server **${now}×** – for that you additionally get: **${slotsText(after, 'en')}**.${up.en}${link.en}\nAs long as your boost is active you can use and renew these servers.`,
    });
  }
  if (now < row.applied && before.length > 0) {
    return notify(
      discordId,
      settings,
      after.length > 0
        ? {
            de: `Du boostest unseren Discord-Server jetzt noch **${now}×** – dafür gilt: **${slotsText(after, 'de')}**. Server darüber hinaus laufen bis zum Ende ihrer Laufzeit weiter und lassen sich danach nicht mehr verlängern.`,
            en: `You now boost our Discord server **${now}×** – for that you get: **${slotsText(after, 'en')}**. Servers beyond that keep running until the end of their runtime and cannot be renewed afterwards.`,
          }
        : {
            de: 'Dein Boost ist beendet – danke für deine Unterstützung! Deine Boost-Server laufen bis zum Ende ihrer Laufzeit weiter. Verlängern kannst du sie, sobald du wieder boostest.',
            en: 'Your boost has ended – thank you for your support! Your boost servers keep running until the end of their runtime. You can renew them as soon as you boost again.',
          },
    );
  }
}

/* ------------------------------------------------------------ Ereignisse */

/** Boost-Meldung im Systemkanal: ein weiterer Boost dieses Mitglieds */
export async function onBoostMessage(discordId: string): Promise<void> {
  await db
    .insert(discordBoosts)
    .values({ discordId, premium: true, messages: 1 })
    .onConflictDoUpdate({ target: discordBoosts.discordId, set: { premium: true, messages: sql`${discordBoosts.messages} + 1`, updatedAt: new Date() } });
  await applyBoosts(discordId);
}

/** Mitglied boostet (noch) bzw. nicht mehr – aus GUILD_MEMBER_UPDATE oder dem regelmäßigen Abgleich */
export async function setPremium(discordId: string, premium: boolean): Promise<void> {
  const row = await boostRow(discordId);
  if (!row && !premium) return;
  if (row && row.premium === premium) return;
  if (premium) {
    await db.insert(discordBoosts).values({ discordId, premium: true, messages: 0 }).onConflictDoUpdate({ target: discordBoosts.discordId, set: { premium: true, updatedAt: new Date() } });
  } else {
    // Boost ganz beendet: Zählung beginnt beim nächsten Boost von vorn
    await db.update(discordBoosts).set({ premium: false, messages: 0, updatedAt: new Date() }).where(eq(discordBoosts.discordId, discordId));
  }
  await applyBoosts(discordId);
}

/** Anzahl von Hand setzen (null = wieder automatisch zählen) */
export async function setManualBoosts(discordId: string, manual: number | null): Promise<number> {
  await db
    .insert(discordBoosts)
    .values({ discordId, manual })
    .onConflictDoUpdate({ target: discordBoosts.discordId, set: { manual, updatedAt: new Date() } });
  await applyBoosts(discordId);
  return boostCount(await boostRow(discordId));
}

/**
 * Abgleich mit der Mitgliederliste: erkennt Booster von vor dem Start des Bots und beendete Boosts, die der Bot
 * verpasst hat (z. B. während eines Neustarts). Wendet außerdem offene Änderungen an.
 */
export async function syncBoosters(): Promise<{ boosters: number }> {
  if (env.BETA_MODE) return { boosters: 0 };
  const cfg = await discordConfig();
  if (!cfg.botReady || !cfg.settings.boostRewards.enabled) return { boosters: 0 };
  const premium = new Set<string>();
  let after = '0';
  for (let page = 0; page < 50; page++) {
    const list = await botRequest<(DiscordMember & { premium_since?: string | null })[]>('GET', `/guilds/${cfg.settings.guildId}/members?limit=1000&after=${after}`);
    for (const m of list) if (m.user && !m.user.bot && m.premium_since) premium.add(m.user.id);
    if (list.length < 1000) break;
    after = list[list.length - 1]!.user?.id ?? after;
  }
  const known = await db.select().from(discordBoosts);
  for (const id of premium) if (!known.find((k) => k.discordId === id)?.premium) await setPremium(id, true);
  for (const k of known) {
    if (k.premium && !premium.has(k.discordId)) await setPremium(k.discordId, false);
    else if (boostCount(k) !== k.applied) await applyBoosts(k.discordId);
  }
  return { boosters: premium.size };
}

/** Übersicht für den Admin-Bereich: alle Konten mit Boosts */
export async function boostOverview(): Promise<{ discordId: string; username: string | null; email: string | null; boosts: number; manual: boolean }[]> {
  const rows = await db.select().from(discordBoosts);
  const out = [];
  for (const r of rows) {
    const boosts = boostCount(r);
    if (boosts === 0 && r.manual === null) continue;
    const [account] = await db.select({ email: users.email, name: users.discordUsername }).from(users).where(eq(users.discordId, r.discordId)).limit(1);
    out.push({ discordId: r.discordId, username: account?.name ?? null, email: account?.email ?? null, boosts, manual: r.manual !== null });
  }
  return out.sort((a, b) => b.boosts - a.boosts).slice(0, 50);
}
