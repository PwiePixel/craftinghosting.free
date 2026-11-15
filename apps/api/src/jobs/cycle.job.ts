/**
 * Job: 30-Tage-Lebenszyklus.
 *
 *  Ablauf nach Zyklusende (jeder Schritt ist wiederholbar):
 *   1. active → expiring   (atomar geclaimt, Benachrichtigung + E-Mail)
 *   2. Server herunterfahren (stop, nach Wartezeit kill)
 *   3. sobald offline: in Pterodactyl suspendieren → expiring → suspended
 *   4. Ruhezeit (Standard: 1 Ruhetag) → E-Mail „kann wieder reaktiviert werden“
 *   5. Nutzer reaktiviert auf der Website („Meine Server“) → neuer Zyklus
 *
 *  Vorher: Hinweise im Minecraft-Chat (60/10/1 Minuten), danach Status-Text im Panel.
 *
 *  Zusätzlich: Erinnerungen X Tage vor Ablauf.
 */
import { and, eq, gt, lte } from 'drizzle-orm';
import { capitalize, deleteAt as deleteAtFor, freeHostingConfig, reactivatableAt, restPeriodAfterText, restPeriodText, type Locale } from '@chfree/shared';
import { affectedRows, db } from '../db/client';
import { servers, type Server } from '../db/schema';
import { pterodactyl } from '../pterodactyl';
import { audit } from '../services/audit.service';
import { notify } from '../services/notification.service';
import { fmtDateTime, manageUrlShort, minutesText, sayOnce, trySyncPanelDescription, warningStep } from '../services/panel';
import { applyPowerState } from '../services/power-state';
import { hardDeleteServer } from '../services/server.service';
import { deletionsAllowed } from '../services/settings.service';
import { isOnline } from '../services/runtime';
import { mapLimit, type JobDefinition } from './types';

const { cycle: rules } = freeHostingConfig;
const DAY_MS = 24 * 60 * 60 * 1000;
const REST_MS = rules.reactivationCooldownMinutes * 60_000;
/** Zeitraum nach der Ruhezeit bis zur automatischen Löschung */
const DELETE_MS = rules.deleteAfterRestHours * 3_600_000;
const deleteAtOf = (server: Server) =>
  server.suspendedAt ? deleteAtFor(server.suspendedAt, rules.reactivationCooldownMinutes, rules.deleteAfterRestHours) : null;
const hasRest = REST_MS > 0;
/** „1 Ruhetag“ / „1 rest day“ */
const rest = (l: Locale) => restPeriodText(rules.reactivationCooldownMinutes, l);
/** „nach einem Ruhetag“ / „after a rest day“ */
const afterRest = (l: Locale) => restPeriodAfterText(rules.reactivationCooldownMinutes, l);

/** Alle Texte dieses Jobs in beiden Sprachen */
const t = {
  chatWarn: (step: number) => (l: Locale) =>
    l === 'en'
      ? `The ${rules.days} days of this server end in ${minutesText(step, l)}. It will then be stopped – renew ${hasRest ? `${afterRest(l)} ` : ''}at ${manageUrlShort(l)}`
      : `Die ${rules.days} Tage dieses Servers enden in ${minutesText(step, l)}. Danach wird er gestoppt – ${hasRest ? `${afterRest(l)} ` : ''}verlängern: ${manageUrlShort(l)}`,
  chatEnd: (l: Locale) =>
    l === 'en'
      ? `The ${rules.days} days are over – the server is stopping now. ${hasRest ? `${capitalize(afterRest(l))}, r` : 'R'}eactivate at ${manageUrlShort(l)}`
      : `Die ${rules.days} Tage sind abgelaufen – der Server wird jetzt gestoppt. ${hasRest ? `${capitalize(afterRest(l))} r` : 'R'}eaktivieren: ${manageUrlShort(l)}`,
  reminderTitle: (d: number) => (l: Locale) =>
    l === 'en'
      ? d === 1
        ? 'Your server cycle ends tomorrow'
        : `Your server cycle ends in ${d} days`
      : d === 1
        ? 'Dein Server-Zyklus endet morgen'
        : `Dein Server-Zyklus endet in ${d} Tagen`,
  reminderBody: (server: Server) => (l: Locale) =>
    l === 'en'
      ? `The current ${rules.days}-day cycle of “${server.name}” ends on ${fmtDateTime(server.cycleEndsAt, l)}. The server will then be taken offline and suspended – ${hasRest ? `${afterRest(l)} ` : ''}you can reactivate it with one click at ${manageUrlShort(l)}.`
      : `Der aktuelle ${rules.days}-Tage-Zyklus von „${server.name}“ endet am ${fmtDateTime(server.cycleEndsAt, l)}. Danach wird der Server offline genommen und suspendiert – ${hasRest ? `${afterRest(l)} ` : ''}kannst du ihn unter ${manageUrlShort(l)} mit einem Klick reaktivieren.`,
  expiredTitle: (l: Locale) => (l === 'en' ? `Your ${rules.days}-day cycle has ended` : `Dein ${rules.days}-Tage-Zyklus ist abgelaufen`),
  expiredBody: (server: Server) => (l: Locale) =>
    l === 'en'
      ? `The ${rules.days}-day cycle of “${server.name}” has ended. The server is being taken offline and will then be suspended. Your data is kept – ${hasRest ? `${afterRest(l)} ` : ''}you can reactivate it for another ${rules.days} days at ${manageUrlShort(l)}.`
      : `Der ${rules.days}-Tage-Zyklus von „${server.name}“ ist abgelaufen. Der Server wird jetzt offline genommen und anschließend suspendiert. Deine Daten bleiben erhalten – ${hasRest ? `${afterRest(l)} ` : ''}kannst du ihn unter ${manageUrlShort(l)} mit „Reaktivieren“ für weitere ${rules.days} Tage aktivieren.`,
  suspendedTitle: (l: Locale) =>
    l === 'en'
      ? hasRest
        ? `Server suspended – ${rest(l)}`
        : 'Server suspended – reactivate now'
      : hasRest
        ? `Server suspendiert – ${rest(l)}`
        : 'Server suspendiert – jetzt reaktivieren',
  suspendedBody: (server: Server, now: Date) => (l: Locale) => {
    const from = fmtDateTime(reactivatableAt(now, rules.reactivationCooldownMinutes), l);
    if (l === 'en') {
      return hasRest
        ? `“${server.name}” has been suspended after ${rules.days} days. Your world and files are kept. After the rest period you can reactivate it from ${from} at ${manageUrlShort(l)} with one click – we will let you know by email.`
        : `“${server.name}” has been suspended after its ${rules.days}-day cycle. Your world and files are kept. Click “Reactivate” at ${manageUrlShort(l)} to start a new cycle.`;
    }
    return hasRest
      ? `„${server.name}“ ist nach Ablauf der ${rules.days} Tage suspendiert. Deine Welt und Dateien bleiben erhalten. Nach der Ruhezeit kannst du ihn ab ${from} unter ${manageUrlShort(l)} mit einem Klick reaktivieren – wir sagen dir per E-Mail Bescheid.`
      : `„${server.name}“ ist nach Ablauf des ${rules.days}-Tage-Zyklus suspendiert. Deine Welt und Dateien bleiben erhalten. Mit einem Klick auf „Reaktivieren“ unter ${manageUrlShort(l)} startest du einen neuen Zyklus.`;
  },
  readyTitle: (l: Locale) => (l === 'en' ? 'Your server can be reactivated again' : 'Dein Server kann wieder reaktiviert werden'),
  readyBody: (server: Server) => (l: Locale) => {
    const until = deleteAtOf(server);
    const deadline = until ? fmtDateTime(until, l) : null;
    return l === 'en'
      ? `The rest period for “${server.name}” is over. You can now reactivate it for another ${rules.days} days with one click at ${manageUrlShort(l)} – your world is still there.${deadline ? ` Important: if you don't reactivate it by ${deadline}, the server and its world will be deleted automatically.` : ''}`
      : `Die Ruhezeit für „${server.name}“ ist vorbei. Unter ${manageUrlShort(l)} kannst du ihn jetzt mit einem Klick für weitere ${rules.days} Tage reaktivieren – deine Welt ist noch da.${deadline ? ` Wichtig: Ohne Reaktivierung bis ${deadline} wird der Server samt Welt automatisch gelöscht.` : ''}`;
  },
  deleteSoonTitle: (l: Locale) => (l === 'en' ? 'Your server will be deleted soon' : 'Dein Server wird bald gelöscht'),
  deleteSoonBody: (server: Server) => (l: Locale) => {
    const until = deleteAtOf(server);
    return l === 'en'
      ? `“${server.name}” has not been reactivated. It will be deleted automatically on ${until ? fmtDateTime(until, l) : '–'} – including its world and files. Reactivate it now with one click at ${manageUrlShort(l)}.`
      : `„${server.name}“ wurde noch nicht reaktiviert. Er wird am ${until ? fmtDateTime(until, l) : '–'} automatisch gelöscht – inklusive Welt und Dateien. Reaktiviere ihn jetzt mit einem Klick unter ${manageUrlShort(l)}.`;
  },
  deletedTitle: (l: Locale) => (l === 'en' ? 'Your server has been deleted' : 'Dein Server wurde gelöscht'),
  deletedBody: (server: Server) => (l: Locale) =>
    l === 'en'
      ? `“${server.name}” was not reactivated after the ${rules.days} days and the rest period, so it has been deleted automatically. You can create a new free server at any time.`
      : `„${server.name}“ wurde nach den ${rules.days} Tagen und der Ruhezeit nicht reaktiviert und deshalb automatisch gelöscht. Du kannst jederzeit einen neuen kostenlosen Server erstellen.`,
};

async function handleExpiring(server: Server, now: Date): Promise<'suspended' | 'stopping' | 'waiting'> {
  const ptero = pterodactyl();
  let state = server.powerState;

  if (server.pteroIdentifier) {
    try {
      const res = await ptero.getResources(server.pteroIdentifier);
      state = res.isSuspended ? 'offline' : res.state;
      await applyPowerState(server, state, now, 'cycle');
    } catch {
      // Panel/Node nicht erreichbar → nach Ablauf der Wartezeit trotzdem suspendieren
      state = 'unknown';
    }
  }

  const graceOver = !!server.expiringSince && now.getTime() - server.expiringSince.getTime() > rules.stopGraceSeconds * 1000;

  if (server.pteroIdentifier && (isOnline(state) || state === 'installing')) {
    if (state !== 'installing') {
      await sayOnce({ ...server, powerState: state }, `cycle-end:${server.cycleNumber}`, t.chatEnd);
      await ptero.sendPowerSignal(server.pteroIdentifier, graceOver ? 'kill' : 'stop').catch(() => {});
    }
    return 'stopping';
  }
  if (state === 'unknown' && !graceOver) return 'waiting';

  if (server.pteroServerId) await ptero.suspendServer(server.pteroServerId);
  const res = await db
    .update(servers)
    .set({ status: 'suspended', suspensionReason: 'cycle_expired', suspendedAt: now, powerState: 'offline', powerStateAt: now })
    .where(and(eq(servers.id, server.id), eq(servers.status, 'expiring')));
  if (affectedRows(res) === 1) {
    await trySyncPanelDescription(server.id);
    await audit({
      userId: server.userId,
      serverId: server.id,
      actor: 'system',
      action: 'cycle.suspended',
      message: `Zyklus ${server.cycleNumber} beendet – Server suspendiert`,
    });
    await notify({
      userId: server.userId,
      serverId: server.id,
      type: 'cycle.suspended',
      title: t.suspendedTitle,
      body: t.suspendedBody(server, now),
      dedupeKey: `cycle-suspended:${server.id}:${server.cycleNumber}`,
    });
  }
  return 'suspended';
}

export const cycleJob: JobDefinition = {
  name: 'cycle-lifecycle',
  intervalMs: 60_000,
  leaseMs: 5 * 60_000,
  async run({ now, log }) {
    const stats = { reminders: 0, chat: 0, expired: 0, stopping: 0, suspended: 0, reactivatable: 0, deleteReminders: 0, deleted: 0, errors: 0 };

    // 0) Hinweise im Minecraft-Chat kurz vor Zyklusende (60/10/1 Minuten)
    const endingSoon = await db
      .select()
      .from(servers)
      .where(and(eq(servers.status, 'active'), gt(servers.cycleEndsAt, now), lte(servers.cycleEndsAt, new Date(now.getTime() + 60 * 60_000))));
    for (const server of endingSoon) {
      const step = warningStep((server.cycleEndsAt.getTime() - now.getTime()) / 1000, [60, 10, 1]);
      if (step === null) continue;
      const sent = await sayOnce(server, `cycle-warn:${server.cycleNumber}:${step}`, t.chatWarn(step));
      if (sent) stats.chat++;
    }

    // 1) Erinnerungen
    const maxDays = Math.max(0, ...rules.reminderDaysBefore);
    if (maxDays > 0) {
      const soon = await db
        .select()
        .from(servers)
        .where(and(eq(servers.status, 'active'), gt(servers.cycleEndsAt, now), lte(servers.cycleEndsAt, new Date(now.getTime() + maxDays * DAY_MS))));
      for (const server of soon) {
        const remainingDays = (server.cycleEndsAt.getTime() - now.getTime()) / DAY_MS;
        // Nur die jeweils passendste Erinnerung (z. B. nicht 3 und 1 Tag gleichzeitig)
        const candidates = rules.reminderDaysBefore.filter((d) => remainingDays <= d);
        if (candidates.length === 0) continue;
        const d = Math.min(...candidates);
        const created = await notify({
          userId: server.userId,
          serverId: server.id,
          type: 'cycle.reminder',
          title: t.reminderTitle(d),
          body: t.reminderBody(server),
          dedupeKey: `cycle-reminder:${server.id}:${server.cycleNumber}:${d}`,
          email: true,
        });
        if (created) stats.reminders++;
      }
    }

    // 2) Abgelaufene Zyklen claimen: active → expiring
    const due = await db
      .select()
      .from(servers)
      .where(and(eq(servers.status, 'active'), lte(servers.cycleEndsAt, now)));
    for (const server of due) {
      const res = await db
        .update(servers)
        .set({ status: 'expiring', expiringSince: now })
        .where(and(eq(servers.id, server.id), eq(servers.status, 'active'), lte(servers.cycleEndsAt, now)));
      if (affectedRows(res) !== 1) continue;
      stats.expired++;
      await audit({
        userId: server.userId,
        serverId: server.id,
        actor: 'system',
        action: 'cycle.expired',
        message: `Zyklus ${server.cycleNumber} abgelaufen – Server wird offline genommen`,
      });
      await notify({
        userId: server.userId,
        serverId: server.id,
        type: 'cycle.expired',
        title: t.expiredTitle,
        body: t.expiredBody(server),
        dedupeKey: `cycle-expired:${server.id}:${server.cycleNumber}`,
        email: true,
      });
    }

    // 3) Laufende Abschaltungen weiterführen
    const expiring = await db.select().from(servers).where(eq(servers.status, 'expiring'));
    await mapLimit(expiring, 5, async (server) => {
      try {
        const result = await handleExpiring(server, now);
        if (result === 'stopping') stats.stopping++;
        if (result === 'suspended') stats.suspended++;
      } catch (err) {
        stats.errors++;
        log.warn({ err, serverId: server.id }, 'Abschaltung nach Zyklusende fehlgeschlagen – nächster Versuch folgt');
      }
    });

    // 4) Ruhezeit vorbei → einmalig Bescheid geben (E-Mail). Nur kürzlich abgelaufene Ruhezeiten,
    //    damit z. B. nach einem Update keine alten Server nachträglich angeschrieben werden.
    if (hasRest) {
      const ready = await db
        .select()
        .from(servers)
        .where(
          and(
            eq(servers.status, 'suspended'),
            eq(servers.suspensionReason, 'cycle_expired'),
            lte(servers.suspendedAt, new Date(now.getTime() - REST_MS)),
            gt(servers.suspendedAt, new Date(now.getTime() - REST_MS - 2 * DAY_MS)),
          ),
        );
      for (const server of ready) {
        const created = await notify({
          userId: server.userId,
          serverId: server.id,
          type: 'cycle.reactivatable',
          title: t.readyTitle,
          body: t.readyBody(server),
          dedupeKey: `cycle-reactivatable:${server.id}:${server.cycleNumber}`,
          email: true,
        });
        if (created) {
          stats.reactivatable++;
          await trySyncPanelDescription(server.id);
        }
      }
    }

    // 5) Nicht reaktivierte Server: Erinnerung vor der Löschung, dann automatisch löschen.
    //    Während einer Wartung (und 24 h danach) wird nichts gelöscht.
    if (DELETE_MS > 0) {
      const expired = await db
        .select()
        .from(servers)
        .where(and(eq(servers.status, 'suspended'), eq(servers.suspensionReason, 'cycle_expired'), lte(servers.suspendedAt, new Date(now.getTime() - REST_MS))));
      const allowed = await deletionsAllowed(now);
      for (const server of expired) {
        const at = deleteAtOf(server);
        if (!at) continue;
        const msLeft = at.getTime() - now.getTime();
        if (msLeft > 0 && msLeft <= rules.deleteReminderHours * 3_600_000) {
          if (
            await notify({
              userId: server.userId,
              serverId: server.id,
              type: 'cycle.delete_soon',
              title: t.deleteSoonTitle,
              body: t.deleteSoonBody(server),
              dedupeKey: `cycle-delete-soon:${server.id}:${server.cycleNumber}`,
              email: true,
            })
          )
            stats.deleteReminders++;
        }
        if (msLeft > 0 || !allowed) continue;
        try {
          await hardDeleteServer(server);
          stats.deleted++;
          await audit({
            userId: server.userId,
            serverId: server.id,
            actor: 'system',
            action: 'cycle.deleted',
            message: `Server „${server.name}“ nach Ablauf der Frist ohne Reaktivierung gelöscht`,
          });
          await notify({
            userId: server.userId,
            serverId: server.id,
            type: 'cycle.deleted',
            title: t.deletedTitle,
            body: t.deletedBody(server),
            dedupeKey: `cycle-deleted:${server.id}`,
            email: true,
          });
        } catch (err) {
          stats.errors++;
          log.warn({ err, serverId: server.id }, 'Automatisches Löschen fehlgeschlagen – nächster Versuch folgt');
        }
      }
    }

    return stats;
  },
};
