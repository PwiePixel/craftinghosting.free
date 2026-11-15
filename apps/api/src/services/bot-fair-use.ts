/**
 * Fair-Use-System für Discord-Bots.
 *
 * Discord-Bots dürfen durchgehend online sein – es gibt kein Laufzeitlimit und keine Pflicht-Offline-Zeit.
 * Damit die geteilte Bot-Node trotzdem für alle schnell bleibt, gelten stattdessen drei Regeln
 * (Werte im Admin-Bereich einstellbar, Texte stehen in den Nutzungsbedingungen für Discord-Bots):
 *
 *  1. CPU-Dauerlast   – liegt die CPU-Last länger als X Minuten am Stück über Y % des Paket-Limits,
 *                       gibt es zur Halbzeit eine Vorwarnung per E-Mail; hält die Last an, wird der Bot
 *                       gestoppt und pausiert (Start erst nach der Pause wieder möglich).
 *  2. Verwarnungen    – jeder automatische Stopp zählt als Verwarnung. Ab N Verwarnungen in M Tagen
 *                       wird der Bot gesperrt (Freigabe nur durch das Team).
 *  3. Inaktivität     – ist der Bot N Tage am Stück offline, wird sein Platz freigegeben: Die Laufzeit
 *                       endet vorzeitig; reaktiviert wird wie nach den 30 Tagen unter „Meine Server“.
 *
 * Aufgerufen vom Job „sync-power-states“ (jede Minute) mit den Ressourcen aus dem Panel.
 * Idempotent: Zustandswechsel per bedingtem UPDATE, Benachrichtigungen per Dedupe-Key.
 */
import { and, count, eq, gte, isNull } from 'drizzle-orm';
import { formatDateTime, freeHostingConfig, type BotFairUseSettings, type Locale } from '@chfree/shared';
import { affectedRows, db } from '../db/client';
import { auditLogs, servers, type Server } from '../db/schema';
import { pterodactyl, type PteroResources } from '../pterodactyl';
import { audit } from './audit.service';
import { notify } from './notification.service';
import { manageUrlShort, trySyncPanelDescription } from './panel';

const MINUTE = 60_000;
const DAY = 86_400_000;
const STRIKE_ACTION = 'fair_use.bot_cpu_stop';
const tz = freeHostingConfig.fairUse.timezone;
const dt = (d: Date, l: Locale) => formatDateTime(d, tz, l);
const en = (l: Locale) => l === 'en';

/** Verwarnungen (automatische Stopps wegen CPU-Dauerlast) im Zeitfenster */
export async function botStrikes(serverId: string, rules: BotFairUseSettings, now = new Date()): Promise<number> {
  const since = new Date(now.getTime() - rules.strikeWindowDays * DAY);
  const [row] = await db
    .select({ n: count() })
    .from(auditLogs)
    .where(and(eq(auditLogs.serverId, serverId), eq(auditLogs.action, STRIKE_ACTION), gte(auditLogs.createdAt, since)));
  return Number(row?.n ?? 0);
}

/** @returns true, wenn eine Maßnahme ergriffen wurde (Vorwarnung, Stopp, Sperre, Freigabe) */
export async function enforceBotFairUse(server: Server, res: PteroResources, now: Date, rules: BotFairUseSettings): Promise<boolean> {
  if (!rules.enabled || server.kind !== 'discord' || server.status !== 'active') return false;
  const acted = await checkCpuLoad(server, res, now, rules);
  return (await checkInactivity(server, now, rules)) || acted;
}

/* ------------------------------------------------------------ 1 + 2: CPU-Dauerlast */

async function checkCpuLoad(server: Server, res: PteroResources, now: Date, rules: BotFairUseSettings): Promise<boolean> {
  const limit = (server.cpuPercent * rules.cpuThresholdPercent) / 100;
  const overloaded = res.state === 'running' && res.cpuAbsolute >= limit;

  if (!overloaded) {
    // Last wieder normal → Zähler zurücksetzen
    if (server.overloadSince) await db.update(servers).set({ overloadSince: null }).where(eq(servers.id, server.id));
    return false;
  }
  if (!server.overloadSince) {
    await db.update(servers).set({ overloadSince: now }).where(and(eq(servers.id, server.id), isNull(servers.overloadSince)));
    return false;
  }

  const since = server.overloadSince;
  const minutes = (now.getTime() - since.getTime()) / MINUTE;
  const stopAt = new Date(since.getTime() + rules.cpuWindowMinutes * MINUTE);

  // Vorwarnung zur Halbzeit
  if (minutes < rules.cpuWindowMinutes) {
    if (minutes < rules.cpuWindowMinutes / 2) return false;
    return notify({
      userId: server.userId,
      serverId: server.id,
      type: 'fair_use.bot_cpu_warning',
      title: (l) => (en(l) ? 'Your Discord bot is using a lot of CPU' : 'Dein Discord-Bot braucht sehr viel CPU'),
      body: (l) =>
        en(l)
          ? `“${server.name}” has been running at more than ${rules.cpuThresholdPercent} % of its CPU limit for a while. Free bots share one node – if the load stays this high until ${dt(stopAt, l)}, the bot will be stopped automatically and paused for ${rules.cooldownMinutes} minutes. Please check your code for endless loops or very frequent requests.`
          : `„${server.name}“ läuft seit einiger Zeit mit mehr als ${rules.cpuThresholdPercent} % seines CPU-Limits. Kostenlose Bots teilen sich eine Node – bleibt die Last bis ${dt(stopAt, l)} so hoch, wird der Bot automatisch gestoppt und pausiert ${rules.cooldownMinutes} Minuten. Bitte prüfe deinen Code auf Endlosschleifen oder sehr häufige Abfragen.`,
      dedupeKey: `bot-cpu-warning:${server.id}:${since.getTime()}`,
      email: true,
    });
  }

  // Dauerlast erreicht → stoppen und pausieren (bedingtes UPDATE = genau einmal)
  const until = new Date(now.getTime() + rules.cooldownMinutes * MINUTE);
  const claim = await db
    .update(servers)
    .set({ pausedUntil: until, pauseReason: 'cpu_overload', pausedAt: now, overloadSince: null })
    .where(and(eq(servers.id, server.id), eq(servers.status, 'active'), eq(servers.overloadSince, since)));
  if (affectedRows(claim) !== 1) return false;

  if (server.pteroIdentifier) await pterodactyl().sendPowerSignal(server.pteroIdentifier, 'stop').catch(() => {});
  await audit({
    userId: server.userId,
    serverId: server.id,
    actor: 'system',
    action: STRIKE_ACTION,
    message: `Discord-Bot wegen CPU-Dauerlast gestoppt (über ${rules.cpuThresholdPercent} % für ${rules.cpuWindowMinutes} min) – Pause bis ${until.toISOString()}`,
    meta: { cpuAbsolute: res.cpuAbsolute, limit: server.cpuPercent },
  });
  const strikes = await botStrikes(server.id, rules, now);

  // Zu viele Verwarnungen → Sperre durch das System
  if (rules.maxStrikes > 0 && strikes >= rules.maxStrikes) {
    const suspended = await db
      .update(servers)
      .set({ status: 'suspended', suspensionReason: 'abuse', suspendedAt: now, expiringSince: null, pausedUntil: null, pauseReason: null, pausedAt: null })
      .where(and(eq(servers.id, server.id), eq(servers.status, 'active')));
    if (affectedRows(suspended) === 1) {
      if (server.pteroServerId) await pterodactyl().suspendServer(server.pteroServerId).catch(() => {});
      await audit({
        userId: server.userId,
        serverId: server.id,
        actor: 'system',
        action: 'fair_use.bot_suspended',
        message: `Discord-Bot gesperrt: ${strikes} Stopps wegen CPU-Dauerlast in ${rules.strikeWindowDays} Tagen`,
      });
      await notify({
        userId: server.userId,
        serverId: server.id,
        type: 'fair_use.bot_suspended',
        title: (l) => (en(l) ? 'Your Discord bot has been suspended' : 'Dein Discord-Bot wurde gesperrt'),
        body: (l) =>
          en(l)
            ? `“${server.name}” was stopped ${strikes} times within ${rules.strikeWindowDays} days because of sustained CPU load and has therefore been suspended (fair-use system for Discord bots). Your files are kept. Please contact support on Discord so we can lift the suspension together.`
            : `„${server.name}“ wurde innerhalb von ${rules.strikeWindowDays} Tagen ${strikes}-mal wegen CPU-Dauerlast gestoppt und deshalb gesperrt (Fair-Use-System für Discord-Bots). Deine Dateien bleiben erhalten. Bitte melde dich beim Support im Discord, damit wir die Sperre gemeinsam aufheben können.`,
        dedupeKey: `bot-suspended:${server.id}:${now.getTime()}`,
        email: true,
      });
      await trySyncPanelDescription(server.id);
      return true;
    }
  }

  await notify({
    userId: server.userId,
    serverId: server.id,
    type: 'fair_use.bot_cpu_stop',
    title: (l) => (en(l) ? 'Discord bot paused: sustained CPU load' : 'Discord-Bot pausiert: CPU-Dauerlast'),
    body: (l) => {
      const left = rules.maxStrikes > 0 ? Math.max(0, rules.maxStrikes - strikes) : null;
      return en(l)
        ? `“${server.name}” ran above ${rules.cpuThresholdPercent} % of its CPU limit for ${rules.cpuWindowMinutes} minutes in a row and was stopped automatically. You can start it again in the panel from ${dt(until, l)}.${left !== null ? ` This is warning ${strikes} of ${rules.maxStrikes} within ${rules.strikeWindowDays} days – ${left === 0 ? 'the next one leads to a suspension' : `after ${rules.maxStrikes} the bot is suspended`}.` : ''}`
        : `„${server.name}“ lief ${rules.cpuWindowMinutes} Minuten am Stück über ${rules.cpuThresholdPercent} % seines CPU-Limits und wurde automatisch gestoppt. Ab ${dt(until, l)} kannst du ihn im Panel wieder starten.${left !== null ? ` Das ist Verwarnung ${strikes} von ${rules.maxStrikes} innerhalb von ${rules.strikeWindowDays} Tagen – ${left === 0 ? 'bei der nächsten wird der Bot gesperrt' : `bei ${rules.maxStrikes} wird der Bot gesperrt`}.` : ''}`;
    },
    dedupeKey: `bot-cpu-stop:${server.id}:${since.getTime()}`,
    email: true,
  });
  await trySyncPanelDescription(server.id);
  return true;
}

/* ------------------------------------------------------------ 3: Inaktivität */

async function checkInactivity(server: Server, now: Date, rules: BotFairUseSettings): Promise<boolean> {
  if (rules.inactiveDays <= 0 || server.powerState !== 'offline' || !server.powerStateAt) return false;
  // Während einer Fair-Use-Pause kann der Bot nicht laufen – das zählt nicht als Inaktivität
  if (server.pausedUntil && server.pausedUntil > now) return false;
  const offlineMs = now.getTime() - server.powerStateAt.getTime();
  const releaseAt = new Date(server.powerStateAt.getTime() + rules.inactiveDays * DAY);
  // Läuft die normale Laufzeit ohnehin vorher ab, greift der 30-Tage-Zyklus
  if (releaseAt >= server.cycleEndsAt) return false;

  if (offlineMs >= rules.inactiveDays * DAY) {
    // Platz freigeben: Laufzeit endet jetzt – der Zyklus-Job übernimmt (Suspendierung, Ruhezeit, Reaktivierung, Löschung)
    const res = await db
      .update(servers)
      .set({ cycleEndsAt: now })
      .where(and(eq(servers.id, server.id), eq(servers.status, 'active'), eq(servers.powerState, 'offline'), eq(servers.powerStateAt, server.powerStateAt)));
    if (affectedRows(res) !== 1) return false;
    await audit({
      userId: server.userId,
      serverId: server.id,
      actor: 'system',
      action: 'fair_use.bot_inactive',
      message: `Discord-Bot ${rules.inactiveDays} Tage am Stück offline – Platz freigegeben (Laufzeit vorzeitig beendet)`,
    });
    await notify({
      userId: server.userId,
      serverId: server.id,
      type: 'fair_use.bot_inactive',
      title: (l) => (en(l) ? 'Your Discord bot slot has been released' : 'Der Platz deines Discord-Bots wurde freigegeben'),
      body: (l) =>
        en(l)
          ? `“${server.name}” was offline for ${rules.inactiveDays} days in a row. To keep free slots available for active bots, its runtime has ended early. Your files are kept for now – you can reactivate the bot at ${manageUrlShort(l)} just like after the regular ${freeHostingConfig.cycle.days} days.`
          : `„${server.name}“ war ${rules.inactiveDays} Tage am Stück offline. Damit freie Plätze für aktive Bots bleiben, wurde die Laufzeit vorzeitig beendet. Deine Dateien bleiben vorerst erhalten – du kannst den Bot unter ${manageUrlShort(l)} reaktivieren, genau wie nach den regulären ${freeHostingConfig.cycle.days} Tagen.`,
      dedupeKey: `bot-inactive:${server.id}:${server.powerStateAt.getTime()}`,
      email: true,
    });
    return true;
  }

  if (rules.inactiveWarningDays > 0 && offlineMs >= (rules.inactiveDays - rules.inactiveWarningDays) * DAY) {
    return notify({
      userId: server.userId,
      serverId: server.id,
      type: 'fair_use.bot_inactive_warning',
      title: (l) => (en(l) ? 'Your Discord bot is offline' : 'Dein Discord-Bot ist offline'),
      body: (l) =>
        en(l)
          ? `“${server.name}” has been offline for several days. Free slots are meant for bots that are actually running: if the bot is not started by ${dt(releaseAt, l)}, its slot will be released (the runtime ends early, files are kept and you can reactivate). Just start the bot in the panel to keep your slot.`
          : `„${server.name}“ ist seit mehreren Tagen offline. Kostenlose Plätze sind für Bots gedacht, die auch laufen: Wird der Bot nicht bis ${dt(releaseAt, l)} gestartet, wird sein Platz freigegeben (die Laufzeit endet vorzeitig, Dateien bleiben erhalten und du kannst reaktivieren). Starte den Bot einfach im Panel, um deinen Platz zu behalten.`,
      dedupeKey: `bot-inactive-warning:${server.id}:${server.powerStateAt.getTime()}`,
      email: true,
    });
  }
  return false;
}
