/**
 * Job: Fair-Use-System durchsetzen – vollautomatisch, Nutzer bedienen ihren
 * Server ausschließlich im Pterodactyl-Panel.
 *  – Laufzeitlimit pro Session (z. B. 24 h) → Warnungen im Chat, dann Stopp + Pause
 *  – wöchentliche Offline-Zeit → rechtzeitiger automatischer Stopp
 *  – Starts im Panel während einer Pause werden rückgängig gemacht
 *  – Status erscheint zusätzlich in der Server-Beschreibung im Panel
 *
 * Idempotenz: Jede Entscheidung wird aus Fakten berechnet; Zustandswechsel
 * werden per bedingtem UPDATE "geclaimt"; Benachrichtigungen/Chat-Hinweise per Dedupe-Key.
 */
import { and, eq, inArray, isNotNull, isNull, lte, or } from 'drizzle-orm';
import { formatDuration, freeHostingConfig, type Locale } from '@chfree/shared';
import { affectedRows, db } from '../db/client';
import { servers, users, type Server } from '../db/schema';
import { pterodactyl } from '../pterodactyl';
import { audit } from '../services/audit.service';
import { notify } from '../services/notification.service';
import { fmtDateTime, minutesText, sayOnce, trySyncPanelDescription, warningStep } from '../services/panel';
import { computeRuntimeState, isOnline, loadWeekSessions } from '../services/runtime';
import { getSettings } from '../services/settings.service';
import { mapLimit, type JobDefinition } from './types';

const { fairUse: rules, cycle: cycleRules } = freeHostingConfig;
/** Warnstufen im Minecraft-Chat vor einem automatischen Stopp (Minuten) */
const CHAT_WARNINGS = [30, 10, 1];

const en = (l: Locale) => l === 'en';
const dt = fmtDateTime;
const dur = (seconds: number, l: Locale) => formatDuration(seconds, {}, l);

/** Alle Texte dieses Jobs in beiden Sprachen */
const t = {
  chatPauseViolation: (until: string) => (l: Locale) =>
    en(l) ? `Fair-use break until ${dt(until, l)} – the server is stopping now.` : `Fair-Use-Pause bis ${dt(until, l)} – der Server wird jetzt gestoppt.`,
  pauseViolationTitle: (l: Locale) => (en(l) ? 'Server stopped during a break' : 'Server während einer Pause gestoppt'),
  pauseViolationBody: (name: string, until: string) => (l: Locale) =>
    en(l)
      ? `“${name}” was started during a fair-use break and stopped automatically. You can start it again from ${dt(until, l)}.`
      : `„${name}“ wurde während einer Fair-Use-Pause gestartet und automatisch wieder gestoppt. Ein Start ist ab ${dt(until, l)} wieder möglich.`,
  chatWeeklyStop: (until: Date) => (l: Locale) =>
    en(l)
      ? `Weekly offline time begins – stopping now. Can be started again from ${dt(until, l)}.`
      : `Wöchentliche Offline-Zeit beginnt – Stopp jetzt. Wieder startbar ab ${dt(until, l)}.`,
  weeklyTitle: (l: Locale) => (en(l) ? 'Weekly offline time has started' : 'Wöchentliche Offline-Zeit hat begonnen'),
  weeklyBody: (name: string, until: Date) => (l: Locale) =>
    en(l)
      ? `To keep free hosting fair for everyone, every server has to be offline for ${rules.weeklyOfflineHours} hours per week. “${name}” was therefore stopped and can be started again in the panel from ${dt(until, l)}.`
      : `Damit kostenloses Hosting für alle fair bleibt, muss jeder Server pro Woche ${rules.weeklyOfflineHours} Stunden offline sein. „${name}“ wurde deshalb gestoppt und kann ab ${dt(until, l)} wieder im Panel gestartet werden.`,
  chatSessionStop: (until: Date) => (l: Locale) =>
    en(l)
      ? `${rules.maxSessionHours} hours of runtime reached – stopping now. Can be started again from ${dt(until, l)}.`
      : `${rules.maxSessionHours} Stunden Laufzeit erreicht – Stopp jetzt. Wieder startbar ab ${dt(until, l)}.`,
  sessionTitle: (l: Locale) => (en(l) ? 'Server paused automatically' : 'Server automatisch pausiert'),
  sessionBody: (name: string, until: Date) => (l: Locale) =>
    en(l)
      ? `“${name}” ran for ${rules.maxSessionHours} hours in a row and was stopped automatically. You can start it again in the panel from ${dt(until, l)}.`
      : `„${name}“ lief ${rules.maxSessionHours} Stunden am Stück und wurde automatisch gestoppt. Ab ${dt(until, l)} kannst du ihn im Panel wieder starten.`,
  chatAutoStop: (step: number, weekly: boolean) => (l: Locale) =>
    en(l)
      ? `Automatic stop in ${minutesText(step, l)} (fair use: ${weekly ? 'weekly offline time' : `max. ${rules.maxSessionHours} hours in a row`}).`
      : `Automatischer Stopp in ${minutesText(step, l)} (Fair-Use: ${weekly ? 'wöchentliche Offline-Zeit' : `max. ${rules.maxSessionHours} Stunden am Stück`}).`,
  sessionWarnTitle: (l: Locale) => (en(l) ? 'Automatic break coming up' : 'Automatische Pause in Kürze'),
  sessionWarnBody: (name: string, seconds: number) => (l: Locale) =>
    en(l)
      ? `“${name}” will reach the maximum runtime of ${rules.maxSessionHours} hours in ${dur(seconds, l)} and will then be stopped automatically.`
      : `„${name}“ erreicht in ${dur(seconds, l)} die maximale Laufzeit von ${rules.maxSessionHours} Stunden und wird dann automatisch gestoppt.`,
  weeklyWarnTitle: (l: Locale) => (en(l) ? 'Weekly offline time coming up' : 'Wöchentliche Offline-Zeit steht bevor'),
  weeklyWarnBody: (name: string, seconds: number, deadline: string) => (l: Locale) =>
    en(l)
      ? `“${name}” still has to be offline for ${dur(seconds, l)} this week. It will be stopped automatically by ${dt(deadline, l)} at the latest – you can also stop it yourself in the panel before then.`
      : `„${name}“ muss diese Woche noch ${dur(seconds, l)} offline sein. Spätestens ${dt(deadline, l)} wird er automatisch gestoppt – du kannst ihn auch vorher selbst im Panel stoppen.`,
};

async function stopServer(server: Server, now: Date) {
  if (!server.pteroIdentifier) return;
  const stuckStopping =
    server.powerState === 'stopping' && server.powerStateAt && now.getTime() - server.powerStateAt.getTime() > cycleRules.stopGraceSeconds * 1000;
  await pterodactyl().sendPowerSignal(server.pteroIdentifier, stuckStopping ? 'kill' : 'stop');
}

export const enforceFairUseJob: JobDefinition = {
  name: 'enforce-fair-use',
  intervalMs: 60_000,
  leaseMs: 5 * 60_000,
  async run({ now, log }) {
    const settings = await getSettings();
    const all = await db
      .select({ server: servers, user: users })
      .from(servers)
      .innerJoin(users, eq(users.id, servers.userId))
      .where(and(eq(servers.status, 'active'), or(inArray(servers.powerState, ['starting', 'running', 'stopping']), isNotNull(servers.pausedUntil))));
    // Produkte ohne Fair-Use-System (z. B. Discord-Bots im Dauerbetrieb) werden übersprungen – offene Pausen laufen aber noch aus
    const rows = all.filter(({ server }) => settings.products[server.kind].fairUse || server.pausedUntil !== null);

    const stats = { checked: 0, sessionLimit: 0, weeklyOffline: 0, pauseViolations: 0, warnings: 0, chat: 0, pausesCleared: 0 };

    await mapLimit(rows, 5, async ({ server, user }) => {
      stats.checked++;
      const sessions = await loadWeekSessions(server.id, now);
      const { fairUse, openSession } = computeRuntimeState(server, user, sessions, now, settings.products[server.kind].fairUse);

      // Abgelaufene Pause aufräumen (+ Panel-Beschreibung zurücksetzen)
      if (server.pausedUntil && server.pausedUntil <= now) {
        const res = await db
          .update(servers)
          .set({ pausedUntil: null, pauseReason: null, pausedAt: null })
          .where(and(eq(servers.id, server.id), lte(servers.pausedUntil, now)));
        if (affectedRows(res)) {
          stats.pausesCleared++;
          await trySyncPanelDescription(server.id);
        }
      }

      if (!isOnline(server.powerState)) return;

      // 1) Server läuft während einer aktiven Pause (z. B. im Panel gestartet)
      if (fairUse.isPaused) {
        const startedDuringPause = !!openSession && !!server.pausedAt && openSession.startedAt > server.pausedAt;
        if (startedDuringPause && openSession) {
          await sayOnce(server, `pause-violation:${openSession.id}`, t.chatPauseViolation(fairUse.pausedUntil!));
        }
        await stopServer(server, now);
        if (startedDuringPause && openSession) {
          stats.pauseViolations++;
          const created = await notify({
            userId: user.id,
            serverId: server.id,
            type: 'fair_use.pause_violation',
            title: t.pauseViolationTitle,
            body: t.pauseViolationBody(server.name, fairUse.pausedUntil!),
            dedupeKey: `pause-violation:${server.id}:${openSession.id}`,
          });
          if (created) {
            await audit({ userId: user.id, serverId: server.id, actor: 'system', action: 'fair_use.pause_violation', message: 'Start während Pause – Server gestoppt' });
          }
        }
        return;
      }

      // 2) Wöchentliche Offline-Zeit muss jetzt beginnen
      if (fairUse.mustGoOfflineForWeek) {
        const until = new Date(fairUse.weekEnd);
        const claim = await db
          .update(servers)
          .set({ pausedUntil: until, pauseReason: 'weekly_offline', pausedAt: now })
          .where(and(eq(servers.id, server.id), or(isNull(servers.pausedUntil), lte(servers.pausedUntil, now))));
        if (affectedRows(claim) === 1) {
          await sayOnce(server, `weekly-stop:${fairUse.weekStart}`, t.chatWeeklyStop(until));
          await stopServer(server, now);
          stats.weeklyOffline++;
          await trySyncPanelDescription(server.id);
          await audit({
            userId: user.id,
            serverId: server.id,
            actor: 'system',
            action: 'fair_use.weekly_offline',
            message: `Wöchentliche Offline-Zeit: gestoppt bis ${dt(until, 'de')}`,
          });
          await notify({
            userId: user.id,
            serverId: server.id,
            type: 'fair_use.weekly_offline',
            title: t.weeklyTitle,
            body: t.weeklyBody(server.name, until),
            dedupeKey: `weekly-offline:${server.id}:${fairUse.weekStart}`,
            email: true,
          });
        }
        return;
      }

      // 3) Laufzeitlimit der Session erreicht
      if (fairUse.sessionLimitReached && openSession) {
        const until = new Date(now.getTime() + rules.cooldownMinutes * 60_000);
        const claim = await db
          .update(servers)
          .set({ pausedUntil: until, pauseReason: 'max_session', pausedAt: now })
          .where(and(eq(servers.id, server.id), or(isNull(servers.pausedUntil), lte(servers.pausedUntil, now))));
        if (affectedRows(claim) === 1) {
          await sayOnce(server, `session-stop:${openSession.id}`, t.chatSessionStop(until));
          await stopServer(server, now);
          stats.sessionLimit++;
          await trySyncPanelDescription(server.id);
          await audit({
            userId: user.id,
            serverId: server.id,
            actor: 'system',
            action: 'fair_use.session_limit',
            message: `Maximale Laufzeit (${rules.maxSessionHours} h) erreicht – Pause bis ${dt(until, 'de')}`,
          });
          await notify({
            userId: user.id,
            serverId: server.id,
            type: 'fair_use.session_limit',
            title: t.sessionTitle,
            body: t.sessionBody(server.name, until),
            dedupeKey: `session-limit:${server.id}:${openSession.id}`,
          });
        }
        return;
      }

      // 4) Vorwarnungen – im Minecraft-Chat (für alle Spieler) und per Benachrichtigung
      if (fairUse.autoStopAt) {
        const remaining = Math.max(0, (new Date(fairUse.autoStopAt).getTime() - now.getTime()) / 1000);
        const step = warningStep(remaining, CHAT_WARNINGS);
        if (step !== null) {
          const weekly = fairUse.autoStopReason === 'weekly_offline';
          const anchor = fairUse.autoStopReason === 'weekly_offline' ? fairUse.weekStart : String(openSession?.id ?? 'x');
          if (await sayOnce(server, `autostop:${fairUse.autoStopReason}:${anchor}:${step}`, t.chatAutoStop(step, weekly))) {
            stats.chat++;
          }
        }
      }
      if (openSession && fairUse.sessionRemainingSeconds !== null && fairUse.sessionRemainingSeconds <= rules.sessionWarningMinutes * 60) {
        if (
          await notify({
            userId: user.id,
            serverId: server.id,
            type: 'fair_use.session_warning',
            title: t.sessionWarnTitle,
            body: t.sessionWarnBody(server.name, fairUse.sessionRemainingSeconds),
            dedupeKey: `session-warning:${server.id}:${openSession.id}`,
          })
        )
          stats.warnings++;
      }
      if (fairUse.weeklyOfflineDeadline) {
        const secondsToDeadline = (new Date(fairUse.weeklyOfflineDeadline).getTime() - now.getTime()) / 1000;
        if (secondsToDeadline <= rules.weeklyOfflineWarningHours * 3600) {
          if (
            await notify({
              userId: user.id,
              serverId: server.id,
              type: 'fair_use.weekly_warning',
              title: t.weeklyWarnTitle,
              body: t.weeklyWarnBody(server.name, fairUse.weeklyOfflineRemainingSeconds, fairUse.weeklyOfflineDeadline),
              dedupeKey: `weekly-warning:${server.id}:${fairUse.weekStart}`,
              email: true,
            })
          )
            stats.warnings++;
        }
      }
      log.debug({ serverId: server.id }, 'Fair-Use geprüft');
    });

    return stats;
  },
};
