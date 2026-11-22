/**
 * Job: Power-Zustände aus Pterodactyl abgleichen.
 *  – aktualisiert power_state
 *  – öffnet/schließt Laufzeit-Sessions (aktive Laufzeit erfassen)
 *  – gleicht den Suspendierungsstatus ab (Datenbank ist die Quelle der Wahrheit)
 *  – startet Nacharbeiten nach abgeschlossener Installation
 */
import { and, eq, gt, inArray, isNotNull, or } from 'drizzle-orm';
import { db } from '../db/client';
import { servers, type Server } from '../db/schema';
import { pterodactyl, PterodactylError } from '../pterodactyl';
import { audit } from '../services/audit.service';
import { enforceBotFairUse } from '../services/bot-fair-use';
import { applyPowerState } from '../services/power-state';
import { getSettings } from '../services/settings.service';
import { runPostProvision } from '../services/provisioning.service';
import { requestSiteSoftware } from '../services/partner-software.service';
import { mapLimit, type JobDefinition } from './types';

/** Ausgeschaltete Server werden nur alle so viele Minuten abgefragt */
const OFFLINE_EVERY_MINUTES = 3;
/** Fester Platz je Server (0 … OFFLINE_EVERY_MINUTES-1), damit sich die Abfragen auf die Minuten verteilen */
const slotOf = (id: string) => {
  let h = 0;
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return h % OFFLINE_EVERY_MINUTES;
};

function endReasonFor(server: Server, now: Date) {
  if (server.status === 'expiring') return 'cycle' as const;
  if (server.pausedUntil && server.pausedUntil > now) {
    return server.pauseReason === 'weekly_offline' ? ('fair_use_weekly' as const) : ('fair_use_session' as const);
  }
  return 'detected' as const;
}

export const syncPowerStatesJob: JobDefinition = {
  name: 'sync-power-states',
  intervalMs: 60_000,
  leaseMs: 5 * 60_000,
  async run({ now, log }) {
    const recentlySuspended = new Date(now.getTime() - 2 * 60 * 60_000);
    const rows = await db
      .select()
      .from(servers)
      .where(
        and(
          isNotNull(servers.pteroIdentifier),
          or(
            inArray(servers.status, ['active', 'expiring']),
            and(eq(servers.status, 'suspended'), gt(servers.suspendedAt, recentlySuspended)),
          ),
        ),
      );

    const stats = { checked: 0, changed: 0, sessionsOpened: 0, sessionsClosed: 0, reconciled: 0, postProvisioned: 0, botFairUse: 0, errors: 0, skippedOffline: 0, deferred: 0 };
    const settings = await getSettings();
    const ptero = pterodactyl();

    // Anfragen sparen (das Panel begrenzt sie je Minute): Ausgeschaltete Server, die schon eine Weile aus sind, nur jede
    // dritte Minute abfragen – verteilt nach Server, damit die Last gleichmäßig bleibt. Ein Start über das Panel fällt so
    // spätestens nach drei Minuten auf. Alles andere (läuft, startet, stoppt, Installation, unbekannt, gerade gestoppt,
    // gesperrt, Nacharbeiten offen) weiter jede Minute.
    const minute = Math.floor(now.getTime() / 60_000);
    const due = rows.filter((s) => {
      const quiet =
        s.powerState === 'offline' &&
        s.status !== 'suspended' &&
        s.postProvisionDone &&
        !s.softwareJob &&
        // In einer Fair-Use-Pause darf ein Start über das Panel nicht unbemerkt bleiben
        !(s.pausedUntil && s.pausedUntil > now) &&
        (!s.powerStateAt || now.getTime() - s.powerStateAt.getTime() > 5 * 60_000);
      if (!quiet) return true;
      if ((minute + slotOf(s.id)) % OFFLINE_EVERY_MINUTES === 0) return true;
      stats.skippedOffline++;
      return false;
    });

    const { failed } = await mapLimit(due, 8, async (server) => {
      stats.checked++;
      let res;
      try {
        res = await ptero.getResources(server.pteroIdentifier!);
      } catch (err) {
        // Panel ausgelastet (429 bzw. zurückgestellt): Stand nicht verändern – „unbekannt“ würde weitere Abfragen auslösen
        if (err instanceof PterodactylError && err.status === 429) {
          stats.deferred++;
          return;
        }
        stats.errors++;
        if (err instanceof PterodactylError && err.status === 404) {
          log.warn({ serverId: server.id }, 'Server existiert in Pterodactyl nicht mehr');
        }
        if (server.powerState !== 'unknown') await applyPowerState(server, 'unknown', now);
        return;
      }

      // Suspendierungsstatus abgleichen
      if (server.status === 'suspended' && !res.isSuspended && server.pteroServerId) {
        await ptero.suspendServer(server.pteroServerId);
        stats.reconciled++;
        await audit({ serverId: server.id, userId: server.userId, actor: 'system', action: 'reconcile.suspend', message: 'Suspendierung im Panel nachgezogen' });
        return;
      }
      if ((server.status === 'active' || server.status === 'expiring') && res.isSuspended && server.pteroServerId) {
        await ptero.unsuspendServer(server.pteroServerId);
        stats.reconciled++;
        await audit({ serverId: server.id, userId: server.userId, actor: 'system', action: 'reconcile.unsuspend', message: 'Entsperrung im Panel nachgezogen' });
      }
      if (server.status === 'suspended') return;

      // Im Panel neu installiert (z. B. „Reinstall Server“ des Besitzers): Das Panel spielt dabei die Software der Grundlage
      // auf – die gewählte Software danach wieder einrichten, sonst liefe plötzlich etwas anderes
      // Erkennbar daran, dass der Server vorher schon fertig war (nicht „installing“/„unknown“ wie direkt nach dem Anlegen –
      // dort besteht der Auftrag ohnehin schon)
      const wasReady = server.powerState !== 'installing' && server.powerState !== 'unknown';
      // Hängt die Installation schon länger (z. B. Installationsskript fehlgeschlagen), ebenfalls nachsehen – gedrosselt
      const installingForMs = server.powerState === 'installing' && server.powerStateAt ? now.getTime() - server.powerStateAt.getTime() : 0;
      if (res.state === 'installing' && (wasReady || installingForMs > 3 * 60_000) && !server.softwareJob && !server.partnerId && server.kind === 'minecraft' && server.pteroServerId) {
        // Nur bei einer echten Neuinstallation: Auch eine Backup-Wiederherstellung, ein Umzug oder Wartung der Node
        // melden sich hier als „installing“ – die Application-API sagt, was wirklich läuft.
        let panel: Awaited<ReturnType<typeof ptero.getServer>>;
        try {
          panel = await ptero.getServer(server.pteroServerId);
        } catch {
          return; // Panel gerade nicht erreichbar: Zustand nicht ändern, der nächste Durchlauf entscheidet
        }
        // Mit dem mitgelieferten Egg spielt das Panel die gewählte Software bei einer Neuinstallation selbst auf. Ist eine
        // Installation fehlgeschlagen, übernimmt der Software-Job: einmal neu installieren, Wiederholungen, Nachricht.
        const rearm = panel?.status === 'install_failed' || (wasReady && panel?.status === 'installing' && !panel.environment?.SOFTWARE_STEPS);
        if (rearm && (await requestSiteSoftware(server, { onlyIfNone: true }))) {
          await audit({
            serverId: server.id,
            userId: server.userId,
            actor: 'system',
            action: 'server.software_rearmed',
            message: panel?.status === 'install_failed' ? `Installation im Panel fehlgeschlagen – ${server.serverType} ${server.version} wird erneut eingerichtet` : `Neuinstallation im Panel erkannt – ${server.serverType} ${server.version} wird danach wieder eingerichtet`,
          });
        }
      }

      // Start erst jetzt bemerkt (ausgeschaltete Server werden nur alle 3 Minuten abgefragt, z. B. Start über das Panel):
      // Laufzeit ab dem echten Start zählen – aus der Laufzeit, die das Panel meldet. Nie vor dem letzten bekannten
      // Zustandswechsel und höchstens 10 Minuten zurück (Schutz vor unplausiblen Werten).
      let startedAt: Date | undefined;
      if ((res.state === 'running' || res.state === 'starting') && server.powerState === 'offline' && res.uptimeMs > 0) {
        const earliest = Math.max(now.getTime() - 10 * 60_000, server.powerStateAt?.getTime() ?? 0);
        startedAt = new Date(Math.max(earliest, now.getTime() - res.uptimeMs));
      }
      const result = await applyPowerState(server, res.state, now, endReasonFor(server, now), startedAt);
      if (res.state !== server.powerState) stats.changed++;
      if (result.opened) stats.sessionsOpened++;
      if (result.closed) stats.sessionsClosed++;

      // Fair-Use-System für Discord-Bots: CPU-Dauerlast und Inaktivität (Bots laufen sonst durchgehend)
      if (server.kind === 'discord' && server.status === 'active' && server.postProvisionDone) {
        try {
          if (await enforceBotFairUse({ ...server, powerState: res.state }, res, now, settings.botFairUse)) stats.botFairUse++;
        } catch (err) {
          log.warn({ err, serverId: server.id }, 'Fair-Use-Prüfung für Discord-Bot fehlgeschlagen – nächster Versuch folgt');
        }
      }

      if (!server.postProvisionDone && res.state !== 'installing') {
        try {
          if (await runPostProvision({ ...server, powerState: res.state })) stats.postProvisioned++;
        } catch (err) {
          log.warn({ err, serverId: server.id }, 'Nacharbeiten nach Installation fehlgeschlagen – nächster Versuch folgt');
        }
      }
    });
    stats.errors += failed;
    return stats;
  },
};
