/**
 * Alles, was Nutzer direkt im Pterodactyl-Panel sehen – in ihrer Sprache:
 *  – Server-Beschreibung mit Status (aktiv bis …, Pause bis …, abgelaufen)
 *  – In-Game-/Konsolen-Hinweise per `say` (genau einmal dank dedupe_marks)
 */
import { eq } from 'drizzle-orm';
import { deleteAt, formatDate, formatDateTime, freeHostingConfig, localePath, reactivatableAt, restPeriodText, type Locale } from '@chfree/shared';
import { env, panelPublicUrl } from '../env';
import { affectedRows, db } from '../db/client';
import { dedupeMarks, servers, type Server } from '../db/schema';
import { resolveText, type LText } from '../lib/text';
import { pterodactyl } from '../pterodactyl';
import { getUserLocale } from './locale.service';
import { isOnline } from './runtime';
import { getSettings } from './settings.service';

const { fairUse, brand } = { fairUse: freeHostingConfig.fairUse, brand: freeHostingConfig.brand };
const tz = fairUse.timezone;

/** Kurzform der Verwaltungsseite für Texte im Panel/Chat, z. B. „craftinghosting.free/meine-server“. */
export function manageUrlShort(locale: Locale = 'de'): string {
  return `${new URL(env.APP_URL).host}${localePath(locale, 'myServers')}`;
}

/** Vollständige URL der Verwaltungsseite */
export function manageUrl(locale: Locale = 'de'): string {
  return `${env.APP_URL}${localePath(locale, 'myServers')}`;
}

export function panelServerUrl(server: Pick<Server, 'pteroIdentifier'>): string | null {
  return server.pteroIdentifier ? `${panelPublicUrl}/server/${server.pteroIdentifier}` : null;
}

/** Datum/Uhrzeit in der Sprache des Nutzers (Zeitzone aus der Konfiguration) */
export const fmtDateTime = (d: Date | string, locale: Locale) => formatDateTime(d, tz, locale);
export const fmtDate = (d: Date | string, locale: Locale) => formatDate(d, tz, locale);

/** Beschreibung nach Ablauf der 30 Tage – während der Ruhezeit mit Zeitpunkt der Reaktivierung. */
function expiredDescription(server: Server, now: Date, l: Locale): string {
  const { days, reactivationCooldownMinutes } = freeHostingConfig.cycle;
  const base = l === 'en' ? `${brand.productName} · ${days} days expired` : `${brand.productName} · ${days} Tage abgelaufen`;
  if (reactivationCooldownMinutes > 0 && server.suspendedAt) {
    const until = reactivatableAt(server.suspendedAt, reactivationCooldownMinutes);
    if (until > now) {
      const rest = restPeriodText(reactivationCooldownMinutes, l);
      return l === 'en'
        ? `${base} · ${rest} – reactivate from ${fmtDateTime(until, l)} at ${manageUrlShort(l)}`
        : `${base} · ${rest} – reaktivierbar ab ${fmtDateTime(until, l)} auf ${manageUrlShort(l)}`;
    }
  }
  const del = server.suspendedAt ? deleteAt(server.suspendedAt, reactivationCooldownMinutes, freeHostingConfig.cycle.deleteAfterRestHours) : null;
  if (del) {
    return l === 'en'
      ? `${base} – reactivate by ${fmtDateTime(del, l)} at ${manageUrlShort(l)}, otherwise it will be deleted`
      : `${base} – bis ${fmtDateTime(del, l)} auf ${manageUrlShort(l)} reaktivieren, sonst wird er gelöscht`;
  }
  return l === 'en' ? `${base} – reactivate at ${manageUrlShort(l)}` : `${base} – reaktivieren auf ${manageUrlShort(l)}`;
}

/** Beschreibung, die im Panel unter dem Servernamen erscheint. */
export function desiredPanelDescription(server: Server, now: Date, l: Locale = 'de', fairUseEnabled = true): string {
  const prefix = brand.productName;
  const en = l === 'en';
  switch (server.status) {
    case 'expiring':
    case 'suspended':
      if (server.suspensionReason && server.suspensionReason !== 'cycle_expired') {
        return en ? `${prefix} · Suspended – please contact support` : `${prefix} · Gesperrt – bitte Support kontaktieren`;
      }
      return expiredDescription(server, now, l);
    case 'active':
      if (server.pausedUntil && server.pausedUntil > now) {
        const weekly = server.pauseReason === 'weekly_offline';
        const why = en
          ? weekly
            ? 'weekly offline time'
            : `max. ${fairUse.maxSessionHours} h in a row`
          : weekly
            ? 'wöchentliche Offline-Zeit'
            : `max. ${fairUse.maxSessionHours} h am Stück`;
        return en
          ? `${prefix} · Fair-use break until ${fmtDateTime(server.pausedUntil, l)} (${why})`
          : `${prefix} · Fair-Use-Pause bis ${fmtDateTime(server.pausedUntil, l)} (${why})`;
      }
      if (!fairUseEnabled) return en ? `${prefix} · active until ${fmtDate(server.cycleEndsAt, l)}` : `${prefix} · aktiv bis ${fmtDate(server.cycleEndsAt, l)}`;
      return en
        ? `${prefix} · active until ${fmtDate(server.cycleEndsAt, l)} · max. ${fairUse.maxSessionHours} h in a row, ${fairUse.weeklyOfflineHours} h/week offline`
        : `${prefix} · aktiv bis ${fmtDate(server.cycleEndsAt, l)} · max. ${fairUse.maxSessionHours} h am Stück, ${fairUse.weeklyOfflineHours} h/Woche offline`;
    default:
      return en ? `${prefix} · being set up` : `${prefix} · wird eingerichtet`;
  }
}

/** Setzt die Beschreibung im Panel, falls sie sich geändert hat (Sprache des Besitzers). */
export async function syncPanelDescription(server: Server, now = new Date()): Promise<boolean> {
  if (!server.pteroServerId) return false;
  const locale = await getUserLocale(server.userId);
  const fairUseEnabled = (await getSettings()).products[server.kind].fairUse;
  const desired = desiredPanelDescription(server, now, locale, fairUseEnabled).slice(0, 255);
  if (desired === server.panelDescription) return false;
  await pterodactyl().updateServerDescription(server.pteroServerId, desired);
  await db.update(servers).set({ panelDescription: desired }).where(eq(servers.id, server.id));
  return true;
}

/** Wie syncPanelDescription, aber Fehler werden nur geloggt (für Aufrufe direkt nach Aktionen). */
export async function trySyncPanelDescription(serverId: string): Promise<void> {
  try {
    const [server] = await db.select().from(servers).where(eq(servers.id, serverId)).limit(1);
    if (server) await syncPanelDescription(server);
  } catch (err) {
    console.warn('[panel] Beschreibung konnte nicht aktualisiert werden – Worker versucht es erneut', (err as Error).message);
  }
}

/**
 * Schickt einen Hinweis in Konsole und Minecraft-Chat – pro Schlüssel genau einmal,
 * in der Sprache des Server-Besitzers. Nur wenn der Server läuft (sonst sieht ihn niemand).
 */
export async function sayOnce(server: Server, key: string, message: LText): Promise<boolean> {
  // `say` ist ein Minecraft-Befehl – Discord-Bots bekommen Hinweise per E-Mail und in der Panel-Beschreibung
  if (server.kind !== 'minecraft') return false;
  if (!server.pteroIdentifier || !isOnline(server.powerState)) return false;
  const res = await db.insert(dedupeMarks).values({ key: `say:${server.id}:${key}`.slice(0, 191) }).onConflictDoNothing();
  if (affectedRows(res) !== 1) return false;
  const locale = await getUserLocale(server.userId);
  const text = `[${brand.productName}] ${resolveText(message, locale)}`.replace(/[\r\n]+/g, ' ').slice(0, 250);
  try {
    await pterodactyl().sendCommand(server.pteroIdentifier, `say ${text}`);
    return true;
  } catch (err) {
    console.warn('[panel] Hinweis konnte nicht gesendet werden', (err as Error).message);
    return false;
  }
}

/** Kleinste passende Warnstufe (z. B. 30/10/1 Minuten) für die verbleibende Zeit. */
export function warningStep(remainingSeconds: number, stepsMinutes: number[]): number | null {
  const candidates = stepsMinutes.filter((m) => remainingSeconds <= m * 60);
  return candidates.length ? Math.min(...candidates) : null;
}

export function minutesText(m: number, locale: Locale = 'de'): string {
  if (locale === 'en') return m === 1 ? '1 minute' : `${m} minutes`;
  return m === 1 ? '1 Minute' : `${m} Minuten`;
}
