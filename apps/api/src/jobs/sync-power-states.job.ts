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

    const stats = { checked: 0, changed: 0, sessionsOpened: 0, sessionsClosed: 0, reconciled: 0, postProvisioned: 0, botFairUse: 0, errors: 0 };
    const settings = await getSettings();
    const ptero = pterodactyl();

    const { failed } = await mapLimit(rows, 8, async (server) => {
      stats.checked++;
      let res;
      try {
        res = await ptero.getResources(server.pteroIdentifier!);
      } catch (err) {
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
      if (res.state === 'installing' && wasReady && !server.softwareJob && !server.partnerId && server.kind === 'minecraft' && server.pteroServerId) {
        // Mit dem mitgelieferten Egg spielt das Panel die gewählte Software bei der Neuinstallation selbst auf
        const panelInstalls = !!(await ptero.getServer(server.pteroServerId).catch(() => null))?.environment?.SOFTWARE_STEPS;
        if (!panelInstalls && (await requestSiteSoftware(server, { onlyIfNone: true }))) {
          await audit({ serverId: server.id, userId: server.userId, actor: 'system', action: 'server.software_rearmed', message: `Neuinstallation im Panel erkannt – ${server.serverType} ${server.version} wird danach wieder eingerichtet` });
        }
      }

      const result = await applyPowerState(server, res.state, now, endReasonFor(server, now));
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
