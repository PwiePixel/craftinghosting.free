/**
 * Verwarnungs-System.
 *
 * Jede Abuse-Nachricht des Teams zählt als eine Verwarnung (abwählbar); das Team kann Verwarnungen auch ohne
 * Abuse-Nachricht vergeben und wieder zurücknehmen. Verwarnungen verfallen nach `warningRules.expireDays` Tagen.
 *  – ab der 2. aktiven Verwarnung: alle Dienste des Nutzers für 48 Stunden offline („Auszeit“)
 *  – bei der 4.: Konto dauerhaft gesperrt (Ban), Server gesperrt und nach 14 Tagen gelöscht; E-Mail-Adresse und
 *    Discord-Konto bleiben gesperrt – auch für eine Neuanmeldung
 *
 * Admins und die Konten von API-Partnern werden nie automatisch gesperrt (dort zählt die Verwarnung nur mit).
 */
import { and, desc, eq, gt, inArray, isNotNull, isNull, lte, ne, or } from 'drizzle-orm';
import { cycleRulesFor, freeHostingConfig, sanctionFor, warningRules, type AdminWarningsDTO, type Localized, type WarningSanction, type WarningStatusDTO } from '@chfree/shared';
import { affectedRows, db } from '../db/client';
import { bannedIdentities, partners, servers, userWarnings, users, warningCarry, type Server, type User, type UserWarning } from '../db/schema';
import { uuid } from '../lib/crypto';
import { ApiError, Errors, L } from '../lib/errors';
import { isAdmin } from '../plugins/auth';
import { pterodactyl } from '../pterodactyl';
import { ABUSE_REASONS } from './abuse-reasons';
import { audit } from './audit.service';
import { notify } from './notification.service';
import { trySyncPanelDescription } from './panel';
import { closeOpenSession } from './power-state';
import { discordHash, emailHashes, fmtSanctionDate, inTimeout } from './sanction-gate';
import { hardDeleteServer } from './server.service';
import { destroyAllSessions } from './session.service';
import { invalidatePublicSite } from './settings.service';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/* ------------------------------------------------------------ Lesen */

/** Aktive Verwarnungen: nicht zurückgenommen und noch nicht verfallen */
export async function activeWarnings(userId: string, now = new Date()): Promise<UserWarning[]> {
  return db
    .select()
    .from(userWarnings)
    .where(and(eq(userWarnings.userId, userId), isNull(userWarnings.revokedAt), gt(userWarnings.expiresAt, now)))
    .orderBy(desc(userWarnings.createdAt));
}

/* ------------------------------------------------------------ Übertrag über das Löschen eines Kontos hinweg */

/**
 * Vor dem Löschen eines Kontos: aktive Verwarnungen als Fingerabdruck von E-Mail-Adresse und Discord-Konto aufheben.
 * Gespeichert werden nur Fingerabdruck, Grund und Daten – keine Adresse, kein Text.
 */
export async function carryWarnings(user: Pick<User, 'id' | 'email' | 'discordId'>, now = new Date()): Promise<number> {
  const rows = await activeWarnings(user.id, now);
  for (const w of rows) {
    const groupId = uuid();
    const base = { groupId, reason: w.reason, serverName: w.serverName, warnedAt: w.createdAt, expiresAt: w.expiresAt };
    for (const hash of emailHashes(user.email)) await db.insert(warningCarry).values({ id: uuid(), kind: 'email', hash, ...base });
    if (user.discordId) await db.insert(warningCarry).values({ id: uuid(), kind: 'discord', hash: discordHash(user.discordId), ...base });
  }
  return rows.length;
}

/** Aufgehobene Verwarnungen auf dieses Konto übertragen (gleiche E-Mail-Adresse oder gleiches Discord-Konto) */
async function restoreCarried(user: Pick<User, 'id' | 'email' | 'discordId'>, now = new Date()): Promise<void> {
  const match = or(and(eq(warningCarry.kind, 'email'), inArray(warningCarry.hash, emailHashes(user.email))), ...(user.discordId ? [and(eq(warningCarry.kind, 'discord'), eq(warningCarry.hash, discordHash(user.discordId)))] : []));
  const rows = await db.select().from(warningCarry).where(match).limit(50);
  if (rows.length === 0) return;
  const groups = new Map(rows.map((r) => [r.groupId, r]));
  for (const [groupId, r] of groups) {
    // Erst entfernen, dann eintragen: Zwei gleichzeitige Aufrufe übertragen dieselbe Verwarnung so nie doppelt
    const removed = await db.delete(warningCarry).where(eq(warningCarry.groupId, groupId));
    if (affectedRows(removed) === 0 || r.expiresAt <= now) continue;
    // Schutz gegen Doppelzählung: Trägt das Konto genau diese Verwarnung schon (z. B. weil das Löschen des Kontos
    // abgebrochen wurde), wird sie nicht noch einmal eingetragen
    const [same] = await db.select({ id: userWarnings.id }).from(userWarnings).where(and(eq(userWarnings.userId, user.id), eq(userWarnings.createdAt, r.warnedAt), eq(userWarnings.reason, r.reason))).limit(1);
    if (same) continue;
    await db.insert(userWarnings).values({ id: uuid(), userId: user.id, serverId: null, serverName: r.serverName, reason: r.reason, note: 'Übernommen aus einem früheren, gelöschten Konto', createdBy: 'system', createdAt: r.warnedAt, expiresAt: r.expiresAt });
  }
}

/** Titel einer Verwarnung in beiden Sprachen (Grund der Abuse-Nachricht bzw. „Verwarnung durch das Team“) */
export function warningTitle(reason: string): Localized {
  return ABUSE_REASONS.find((r) => r.id === reason)?.title ?? { de: 'Verwarnung durch das Team', en: 'Warning from the team' };
}

/** Stand für den Nutzer („Meine Server“) */
export async function warningStatus(user: Pick<User, 'id' | 'email' | 'discordId' | 'suspendedUntil'>, now = new Date()): Promise<WarningStatusDTO> {
  await restoreCarried(user, now);
  const rows = await activeWarnings(user.id, now);
  return {
    active: rows.length,
    timeoutFrom: warningRules.timeoutFrom,
    banAt: warningRules.banAt,
    timeoutHours: warningRules.timeoutHours,
    expireDays: warningRules.expireDays,
    suspendedUntil: user.suspendedUntil && user.suspendedUntil > now ? user.suspendedUntil.toISOString() : null,
    items: rows.map((w) => ({ id: w.id, at: w.createdAt.toISOString(), expiresAt: w.expiresAt.toISOString(), reason: warningTitle(w.reason), serverName: w.serverName })),
  };
}

/** Was die nächste Verwarnung für diesen Nutzer auslösen würde (für die Vorschau der Abuse-Nachricht) */
export async function nextWarningEffect(user: User, now = new Date()): Promise<{ count: number; sanction: WarningSanction }> {
  await restoreCarried(user, now);
  const count = (await activeWarnings(user.id, now)).length + 1;
  return { count, sanction: (await sanctionable(user)) ? sanctionFor(count) : 'none' };
}

/** Admins und Konten von API-Partnern werden nie automatisch gesperrt */
async function sanctionable(user: Pick<User, 'id' | 'role' | 'email'>): Promise<boolean> {
  if (isAdmin(user)) return false;
  const [partner] = await db.select({ id: partners.id }).from(partners).where(eq(partners.userId, user.id)).limit(1);
  return !partner;
}

/* ------------------------------------------------------------ Sperren und Entsperren von Servern */

/** Server wegen einer Auszeit bzw. eines Bans sperren (läuft er, stoppt ihn das Panel beim Sperren) */
async function suspendServers(userId: string, reason: 'warning' | 'ban', now: Date): Promise<number> {
  const owned = await db
    .select()
    .from(servers)
    .where(and(eq(servers.userId, userId), isNull(servers.partnerId), inArray(servers.status, ['active', 'expiring'])));
  let n = 0;
  for (const server of owned) {
    const res = await db
      .update(servers)
      .set({ status: 'suspended', suspensionReason: reason, suspendedAt: now, expiringSince: null, powerState: 'offline', powerStateAt: now })
      .where(and(eq(servers.id, server.id), inArray(servers.status, ['active', 'expiring'])));
    if (affectedRows(res) !== 1) continue;
    n++;
    // Das Panel stoppt den Server beim Sperren: die laufende Laufzeit-Sitzung jetzt schließen – sonst zählten die
    // 48 Stunden nach der Freigabe als Laufzeit am Stück
    await closeOpenSession(server.id, now, 'detected').catch(() => {});
    // Schlägt das hier fehl, zieht der Power-Abgleich die Sperre im Panel nach
    if (server.pteroServerId) await pterodactyl().suspendServer(server.pteroServerId).catch(() => {});
    await trySyncPanelDescription(server.id).catch(() => {});
  }
  // Ein Ban ersetzt eine laufende Auszeit: Diese Server bleiben gesperrt, wenn die 48 Stunden vorbei sind
  if (reason === 'ban') await db.update(servers).set({ suspensionReason: 'ban' }).where(and(eq(servers.userId, userId), eq(servers.status, 'suspended'), eq(servers.suspensionReason, 'warning')));
  return n;
}

/** Sperre wieder aufheben. Ist die Laufzeit des Servers inzwischen abgelaufen, gilt ab jetzt die normale „abgelaufen“-Sperre. */
async function releaseServers(userId: string, reason: 'warning' | 'ban', now: Date): Promise<number> {
  const held = await db
    .select()
    .from(servers)
    .where(and(eq(servers.userId, userId), eq(servers.status, 'suspended'), eq(servers.suspensionReason, reason)));
  let n = 0;
  for (const server of held) {
    const guard = and(eq(servers.id, server.id), eq(servers.status, 'suspended'), eq(servers.suspensionReason, reason));
    if (server.cycleEndsAt <= now) {
      // Bleibt im Panel gesperrt – der Nutzer kann ihn wie jeden abgelaufenen Server reaktivieren
      await db.update(servers).set({ suspensionReason: 'cycle_expired', suspendedAt: now }).where(guard);
    } else {
      if (affectedRows(await db.update(servers).set({ status: 'active', suspensionReason: null, suspendedAt: null, expiringSince: null }).where(guard)) !== 1) continue;
      if (server.pteroServerId) await pterodactyl().unsuspendServer(server.pteroServerId).catch(() => {});
      n++;
    }
    await trySyncPanelDescription(server.id).catch(() => {});
  }
  return n;
}

/**
 * Abgelaufene Server (wegen des 30-Tage-Zyklus gesperrt) konnten während einer Auszeit, eines Bans oder mit
 * Abuse-Markierung nicht reaktiviert werden. Danach beginnt die Frist bis zur automatischen Löschung neu:
 * sofort reaktivierbar, falls die Ruhezeit schon vorbei war, und die volle Löschfrist ab jetzt.
 */
export async function restoreReactivationWindow(where: { userId?: string; serverId?: string }, now = new Date()): Promise<void> {
  const cond = where.serverId ? eq(servers.id, where.serverId) : eq(servers.userId, where.userId ?? '');
  const rows = await db
    .select()
    .from(servers)
    .where(and(cond, eq(servers.status, 'suspended'), eq(servers.suspensionReason, 'cycle_expired')));
  for (const server of rows) {
    const rest = cycleRulesFor(server.kind, freeHostingConfig.cycle).reactivationCooldownMinutes * 60_000;
    const earliest = new Date(now.getTime() - rest);
    if (server.suspendedAt && server.suspendedAt >= earliest) continue; // Ruhezeit läuft ohnehin noch
    await db.update(servers).set({ suspendedAt: earliest }).where(and(eq(servers.id, server.id), eq(servers.status, 'suspended'), eq(servers.suspensionReason, 'cycle_expired')));
    await trySyncPanelDescription(server.id).catch(() => {});
  }
}

/* ------------------------------------------------------------ Sanktionen */

export interface SanctionResult {
  /** Zahl aktiver Verwarnungen einschließlich der neuen */
  count: number;
  sanction: WarningSanction;
  /** Auszeit bis bzw. Löschung der Server am */
  until: Date | null;
}

async function startTimeout(user: User, now: Date): Promise<Date> {
  const until = new Date(now.getTime() + warningRules.timeoutHours * HOUR);
  await db.update(users).set({ suspendedUntil: until }).where(eq(users.id, user.id));
  const n = await suspendServers(user.id, 'warning', now);
  await audit({ userId: user.id, actor: 'system', action: 'warning.timeout', message: `Auszeit für ${user.email}: alle Dienste bis ${until.toISOString()} offline (${n} Server gesperrt)` });
  return until;
}

async function startBan(user: User, now: Date): Promise<Date> {
  const deleteAt = new Date(now.getTime() + warningRules.banDeleteDays * DAY);
  await db.update(users).set({ status: 'locked', bannedAt: now, banDeleteAt: deleteAt, suspendedUntil: null, panelDeadlineAt: null }).where(eq(users.id, user.id));
  await destroyAllSessions(user.id);
  const identities = [...emailHashes(user.email).map((hash) => ({ kind: 'email' as const, hash })), ...(user.discordId ? [{ kind: 'discord' as const, hash: discordHash(user.discordId) }] : [])];
  for (const identity of identities) await db.insert(bannedIdentities).values({ id: uuid(), ...identity, userId: user.id }).onConflictDoNothing();
  const n = await suspendServers(user.id, 'ban', now);
  invalidatePublicSite();
  await audit({ userId: user.id, actor: 'system', action: 'warning.ban', message: `Konto ${user.email} dauerhaft gesperrt (${warningRules.banAt}. Verwarnung) – ${n} Server gesperrt, Löschung am ${deleteAt.toISOString()}` });
  return deleteAt;
}

/**
 * Verwarnung eintragen und die Folge anwenden (Auszeit bzw. Ban). Die Benachrichtigung des Nutzers schickt der Aufrufer
 * (die Abuse-Nachricht selbst bzw. eine eigene Nachricht) – mit dem Ergebnis dieser Funktion.
 */
export async function issueWarning(
  user: User,
  input: { reason: string; note?: string | null; server?: Pick<Server, 'id' | 'name'> | null; notificationKey?: string | null; by: string },
  now = new Date(),
): Promise<SanctionResult> {
  // Verwarnungen aus einem früheren, gelöschten Konto derselben Person zählen mit
  await restoreCarried(user, now);
  await db.insert(userWarnings).values({
    id: uuid(),
    userId: user.id,
    serverId: input.server?.id ?? null,
    serverName: input.server?.name ?? null,
    reason: input.reason,
    note: input.note?.trim().slice(0, 2000) || null,
    notificationKey: input.notificationKey ?? null,
    createdBy: input.by,
    createdAt: now,
    expiresAt: new Date(now.getTime() + warningRules.expireDays * DAY),
  });
  const count = (await activeWarnings(user.id, now)).length;
  await audit({ userId: user.id, serverId: input.server?.id ?? null, actor: 'admin', action: 'warning.issued', message: `${count}. Verwarnung für ${user.email} (durch ${input.by})` });
  if (!(await sanctionable(user)) || user.bannedAt) return { count, sanction: 'none', until: null };
  const sanction = sanctionFor(count);
  if (sanction === 'ban') return { count, sanction, until: await startBan(user, now) };
  if (sanction === 'timeout') return { count, sanction, until: await startTimeout(user, now) };
  return { count, sanction, until: null };
}

/** Absatz für die Nachricht an den Nutzer: die wievielte Verwarnung es ist und was daraus folgt */
export function warningParagraph(result: { count: number; sanction: WarningSanction; until?: Date | null }, fmt: (d: Date, locale: 'de' | 'en') => string): Localized {
  const r = warningRules;
  const expiry = { de: `Verwarnungen verfallen nach ${r.expireDays} Tagen.`, en: `Warnings expire after ${r.expireDays} days.` };
  if (result.sanction === 'ban') {
    const date = result.until ? { de: ` am ${fmt(result.until, 'de')}`, en: ` on ${fmt(result.until, 'en')}` } : { de: ` nach ${r.banDeleteDays} Tagen`, en: ` after ${r.banDeleteDays} days` };
    return {
      de: `Das ist deine ${result.count}. Verwarnung. Dein Konto ist damit dauerhaft für CraftingHosting.free gesperrt. Deine Server sind gesperrt und werden${date.de} samt Daten gelöscht. Wenn du das für einen Irrtum hältst, öffne bitte vorher ein Ticket.`,
      en: `This is your warning no. ${result.count}. Your account is now permanently banned from CraftingHosting.free. Your servers are suspended and will be deleted including their data${date.en}. If you think this is a mistake, please open a ticket before then.`,
    };
  }
  if (result.sanction === 'timeout') {
    const date = result.until ? { de: ` bis ${fmt(result.until, 'de')}`, en: ` until ${fmt(result.until, 'en')}` } : { de: ` für ${r.timeoutHours} Stunden`, en: ` for ${r.timeoutHours} hours` };
    return {
      de: `Das ist deine ${result.count}. Verwarnung. Alle deine Dienste sind deshalb${date.de} offline; danach kannst du sie wieder starten. Bei der ${r.banAt}. Verwarnung wird dein Konto dauerhaft gesperrt. ${expiry.de}`,
      en: `This is your warning no. ${result.count}. All your services are therefore offline${date.en}; after that you can start them again. With warning no. ${r.banAt} your account will be banned permanently. ${expiry.en}`,
    };
  }
  return {
    de: `Das ist deine ${result.count}. Verwarnung. Ab der ${r.timeoutFrom}. Verwarnung gehen alle deine Dienste für ${r.timeoutHours} Stunden offline, bei der ${r.banAt}. wird dein Konto dauerhaft gesperrt. ${expiry.de}`,
    en: `This is your warning no. ${result.count}. From warning no. ${r.timeoutFrom} on, all your services go offline for ${r.timeoutHours} hours; with no. ${r.banAt} your account is banned permanently. ${expiry.en}`,
  };
}

/* ------------------------------------------------------------ Aktionen des Teams */

const fmtDate = fmtSanctionDate;

async function userByEmail(email: string): Promise<User> {
  const [user] = await db.select().from(users).where(eq(users.email, email.trim().toLowerCase())).limit(1);
  if (!user) throw new ApiError(404, 'user_not_found', L('Zu dieser E-Mail-Adresse gibt es keinen Account.', 'There is no account for this email address.'));
  return user;
}

/** Verwarnung ohne Abuse-Nachricht (z. B. nach einem Ticket): Der Nutzer bekommt eine eigene Nachricht. */
export async function warnManually(admin: User, input: { email: string; note: Localized }, ip?: string): Promise<SanctionResult> {
  const user = await userByEmail(input.email);
  const note = { de: input.note.de.trim(), en: input.note.en.trim() || input.note.de.trim() };
  if (!note.de) throw new ApiError(400, 'validation_error', L('Bitte einen Grund angeben.', 'Please give a reason.'));
  const key = `abuse:warning:${uuid()}`;
  const result = await issueWarning(user, { reason: 'manual', note: note.de, notificationKey: key, by: admin.email });
  const extra = warningParagraph(result, fmtDate);
  await notify({
    userId: user.id,
    type: 'abuse.warning',
    title: { de: 'Verwarnung wegen eines Verstoßes gegen unsere Regeln', en: 'Warning for a violation of our rules' },
    body: { de: `${note.de}\n\n${extra.de}`, en: `${note.en}\n\n${extra.en}` },
    dedupeKey: key,
    email: true,
  });
  await audit({ userId: user.id, actor: 'admin', action: 'admin.warning_manual', message: `Verwarnung von Hand für ${user.email} (durch ${admin.email})`, ip });
  return result;
}

/** Verwarnung zurücknehmen. Eine laufende Auszeit bzw. ein Ban wird dadurch NICHT aufgehoben – dafür gibt es eigene Aktionen. */
export async function revokeWarning(admin: User, id: string, ip?: string): Promise<void> {
  const [w] = await db.select().from(userWarnings).where(eq(userWarnings.id, id)).limit(1);
  if (!w || w.revokedAt) throw Errors.notFound(L('Verwarnung nicht gefunden.', 'Warning not found.'));
  await db.update(userWarnings).set({ revokedAt: new Date(), revokedBy: admin.email }).where(eq(userWarnings.id, id));
  await audit({ userId: w.userId, serverId: w.serverId, actor: 'admin', action: 'admin.warning_revoked', message: `Verwarnung vom ${w.createdAt.toISOString().slice(0, 10)} zurückgenommen (durch ${admin.email})`, ip });
}

/** Auszeit beenden (vom Team vorzeitig oder vom Job nach Ablauf) */
export async function endTimeout(userId: string, by: string | null, now = new Date()): Promise<number> {
  // Erst die Frist abgelaufener Server neu setzen, dann freigeben – solange suspendedUntil steht, hält der Zyklus-Job still.
  // Nur, wenn wirklich eine Auszeit läuft (sonst würden Fristen ohne Grund verlängert)
  const [current] = await db.select({ until: users.suspendedUntil }).from(users).where(eq(users.id, userId)).limit(1);
  if (!current?.until) return 0;
  await restoreReactivationWindow({ userId }, now);
  const res = await db.update(users).set({ suspendedUntil: null }).where(and(eq(users.id, userId), isNotNull(users.suspendedUntil)));
  if (affectedRows(res) !== 1) return 0;
  const n = await releaseServers(userId, 'warning', now);
  await audit({ userId, actor: by ? 'admin' : 'system', action: 'warning.timeout_ended', message: by ? `Auszeit vorzeitig beendet (durch ${by}) – ${n} Server entsperrt` : `Auszeit abgelaufen – ${n} Server entsperrt` });
  await notify({
    userId,
    type: 'warning.timeout_ended',
    title: { de: 'Deine Dienste sind wieder freigegeben', en: 'Your services are available again' },
    body: {
      de: 'Die Auszeit nach deiner Verwarnung ist vorbei. Du kannst deine Server wieder starten. Bitte halte dich an unsere Regeln – bei weiteren Verstößen folgen längere Sperren bis hin zur dauerhaften Sperre des Kontos.',
      en: 'The time-out after your warning is over. You can start your servers again. Please follow our rules – further violations lead to longer suspensions up to a permanent ban of the account.',
    },
    dedupeKey: `warning:timeout-ended:${userId}:${now.getTime()}`,
    email: true,
  });
  return n;
}

/**
 * Jedes gebannte Konto hat eigene Einträge auf der Sperrliste – auch für Fingerabdrücke, die es mit einem anderen
 * teilt. Früher war ein Fingerabdruck nur einmal erlaubt; fehlende Einträge werden hier (beim Start, idempotent)
 * nachgetragen, damit das Aufheben eines Bans nie die Sperre eines anderen Kontos mitnimmt.
 */
export async function ensureBanFingerprints(): Promise<number> {
  const banned = await db.select().from(users).where(isNotNull(users.bannedAt));
  let added = 0;
  for (const user of banned) {
    const identities = [...emailHashes(user.email).map((hash) => ({ kind: 'email' as const, hash })), ...(user.discordId ? [{ kind: 'discord' as const, hash: discordHash(user.discordId) }] : [])];
    for (const identity of identities) added += affectedRows(await db.insert(bannedIdentities).values({ id: uuid(), ...identity, userId: user.id }).onConflictDoNothing());
  }
  return added;
}

/** Ban aufheben: Konto und Server wieder freigeben, E-Mail-Adresse und Discord-Konto von der Sperrliste nehmen */
export async function liftBan(admin: User, userId: string, ip?: string): Promise<void> {
  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!user || !user.bannedAt) throw Errors.notFound(L('Dieses Konto ist nicht gebannt.', 'This account is not banned.'));
  const now = new Date();
  await restoreReactivationWindow({ userId }, now);
  await db.update(users).set({ status: 'active', bannedAt: null, banDeleteAt: null, panelDeadlineAt: null }).where(eq(users.id, userId));
  // Jedes gebannte Konto hat eigene Einträge (auch bei gemeinsamem Fingerabdruck) – hier gehen nur die dieses Kontos
  await db.delete(bannedIdentities).where(eq(bannedIdentities.userId, userId));
  const n = await releaseServers(userId, 'ban', now);
  invalidatePublicSite();
  await audit({ userId, actor: 'admin', action: 'admin.ban_lifted', message: `Ban von ${user.email} aufgehoben – ${n} Server entsperrt (durch ${admin.email})`, ip });
  await notify({
    userId,
    type: 'warning.ban_lifted',
    title: { de: 'Dein Konto ist wieder freigegeben', en: 'Your account has been reinstated' },
    body: { de: 'Die dauerhafte Sperre deines Kontos wurde aufgehoben. Du kannst dich wieder anmelden und deine Server nutzen.', en: 'The permanent ban of your account has been lifted. You can sign in and use your servers again.' },
    dedupeKey: `warning:ban-lifted:${userId}:${now.getTime()}`,
    email: true,
  });
}

/* ------------------------------------------------------------ Schranken für den Nutzer */

/**
 * Das eigene Konto lässt sich nicht löschen, solange ein Abuse-Fall offen ist (Server mit Abuse-Markierung oder
 * Abuse-Sperre) oder eine Auszeit läuft – sonst ließen sich Verwarnungen und die Löschsperre einfach umgehen.
 */
export async function assertAccountDeletable(user: Pick<User, 'id' | 'suspendedUntil'>, now = new Date()): Promise<void> {
  const blocked = () =>
    Errors.conflict(
      'abuse_locked',
      L(
        'Zu deinem Konto liegt eine offene Abuse-Meldung bzw. eine laufende Sperre vor. Es lässt sich erst löschen, wenn das geklärt ist – öffne dazu bitte ein Ticket auf unserem Discord-Server.',
        'There is an open abuse report or a running suspension for your account. It can only be deleted once this has been resolved – please open a ticket on our Discord server.',
      ),
    );
  if (inTimeout(user, now)) throw blocked();
  const owned = await db
    .select({ abuseAt: servers.abuseAt, status: servers.status, suspensionReason: servers.suspensionReason })
    .from(servers)
    .where(and(eq(servers.userId, user.id), ne(servers.status, 'deleted')));
  if (owned.some((s) => s.abuseAt || (s.status === 'suspended' && (s.suspensionReason === 'abuse' || s.suspensionReason === 'warning' || s.suspensionReason === 'ban')))) throw blocked();
}

/* ------------------------------------------------------------ Admin-Übersicht */

export async function listWarnings(now = new Date()): Promise<AdminWarningsDTO> {
  const rows = await db
    .select({ w: userWarnings, email: users.email, suspendedUntil: users.suspendedUntil, bannedAt: users.bannedAt, banDeleteAt: users.banDeleteAt })
    .from(userWarnings)
    .innerJoin(users, eq(users.id, userWarnings.userId))
    .orderBy(desc(userWarnings.createdAt))
    .limit(500);
  const byUser = new Map<string, AdminWarningsDTO['users'][number]>();
  for (const { w, email, suspendedUntil, bannedAt, banDeleteAt } of rows) {
    const state = w.revokedAt ? ('revoked' as const) : w.expiresAt <= now ? ('expired' as const) : ('active' as const);
    const entry = byUser.get(w.userId) ?? {
      userId: w.userId,
      email,
      active: 0,
      suspendedUntil: suspendedUntil && suspendedUntil > now ? suspendedUntil.toISOString() : null,
      bannedAt: bannedAt?.toISOString() ?? null,
      banDeleteAt: banDeleteAt?.toISOString() ?? null,
      items: [],
    };
    if (state === 'active') entry.active++;
    entry.items.push({ id: w.id, at: w.createdAt.toISOString(), expiresAt: w.expiresAt.toISOString(), reason: ABUSE_REASONS.find((r) => r.id === w.reason)?.label ?? 'Verwarnung von Hand', note: w.note, serverName: w.serverName, by: w.createdBy, state });
    byUser.set(w.userId, entry);
  }
  // Gesperrte und gebannte zuerst, dann nach Zahl der aktiven Verwarnungen
  const rank = (u: AdminWarningsDTO['users'][number]) => (u.bannedAt ? 2 : u.suspendedUntil ? 1 : 0);
  return { rules: { ...warningRules }, users: [...byUser.values()].sort((a, b) => rank(b) - rank(a) || b.active - a.active) };
}

/* ------------------------------------------------------------ Hintergrund-Job */

/** Läuft jede Minute: beendet abgelaufene Auszeiten und löscht die Server gebannter Konten nach Ablauf der Frist */
export async function runSanctions(now = new Date()) {
  const stats = { timeoutsEnded: 0, serversReleased: 0, bannedServersDeleted: 0, failed: 0 };
  const expired = await db
    .select({ id: users.id })
    .from(users)
    .where(and(isNotNull(users.suspendedUntil), lte(users.suspendedUntil, now), isNull(users.bannedAt)))
    .limit(100);
  for (const { id } of expired) {
    try {
      stats.serversReleased += await endTimeout(id, null, now);
      stats.timeoutsEnded++;
    } catch {
      stats.failed++;
    }
  }
  await db.delete(warningCarry).where(lte(warningCarry.expiresAt, now));
  const due = await db
    .select({ id: users.id, email: users.email })
    .from(users)
    .where(and(isNotNull(users.bannedAt), isNotNull(users.banDeleteAt), lte(users.banDeleteAt, now)))
    .limit(20);
  for (const user of due) {
    const owned = await db
      .select()
      .from(servers)
      .where(and(eq(servers.userId, user.id), ne(servers.status, 'deleted')))
      .limit(10);
    let left = owned.length;
    for (const server of owned) {
      try {
        await hardDeleteServer(server);
        await audit({ userId: user.id, serverId: server.id, actor: 'system', action: 'warning.ban_server_deleted', message: `Server „${server.name}“ des gebannten Kontos ${user.email} gelöscht (${warningRules.banDeleteDays} Tage nach dem Ban)` });
        stats.bannedServersDeleted++;
        left--;
      } catch {
        stats.failed++; // Panel gerade nicht erreichbar – beim nächsten Lauf
      }
    }
    if (left === 0 && owned.length < 10) await db.update(users).set({ banDeleteAt: null }).where(eq(users.id, user.id));
  }
  return stats;
}
