/**
 * E-Mails aus dem Admin-Bereich:
 *  – Erinnerung an alle, deren Server noch auf die Discord-Verbindung wartet (mit Frist – danach wird die Anfrage gelöscht)
 *  – Nachricht an ausgewählte Nutzer
 *  – Abuse-Mails von Hand und die Übersicht aller Abuse-Mails
 * Versendet wird über die Benachrichtigungen (Outbox): Die Nachricht erscheint auch unter „Meine Server“,
 * die E-Mail verschickt der Worker – Fehler stehen im Reiter „E-Mails“.
 */
import { identityConfirmedSql } from './identity';
import { and, desc, eq, inArray, isNotNull, isNull, like, lt, ne, notExists, or, sql } from 'drizzle-orm';
import { formatDateTime, freeHostingConfig, type WarningSanction, type AdminAbuseDTO, type AdminDiscordWaitingDTO, type AdminPanelWaitingDTO, type Locale, type Localized } from '@chfree/shared';
import { affectedRows, db } from '../db/client';
import { notifications, partners, servers, users, type User } from '../db/schema';
import { isAdmin } from '../plugins/auth';
import { deleteAccount } from './account.service';
import { uuid } from '../lib/crypto';
import { ApiError, Errors, L } from '../lib/errors';
import { mapLimit } from '../jobs/types';
import { getDiscordState } from '../discord/store';
import { ABUSE_REASONS, abuseReasonLabel } from './abuse-reasons';
import { serverAction } from './admin.service';
import { audit } from './audit.service';
import { notify } from './notification.service';
import { pendingReasonFor } from './server.service';
import { getSettings, resolveBrand } from './settings.service';
import { issueWarning, listWarnings, nextWarningEffect, restoreReactivationWindow, warningParagraph } from './warnings.service';

const DAY_MS = 86_400_000;
const date = (d: Date, l: Locale) => formatDateTime(d, freeHostingConfig.fairUse.timezone, l);

/* ------------------------------------------------------------ Erinnerung: Discord-Verbindung */

type Waiting = { user: User; servers: { id: string; name: string; deadline: Date | null }[]; reason: 'discord_not_linked' | 'discord_not_member' };

/** Accounts, deren offene Anfrage an der Discord-Verbindung hängt (Konto nicht verknüpft oder kein Mitglied) */
async function discordWaiting(): Promise<Waiting[]> {
  const rows = await db
    .select({ s: servers, u: users })
    .from(servers)
    .innerJoin(users, eq(users.id, servers.userId))
    .where(and(eq(servers.status, 'pending'), eq(users.status, 'active')))
    .limit(2000);
  const byUser = new Map<string, Waiting>();
  for (const { s, u } of rows) {
    const entry = byUser.get(u.id) ?? { user: u, servers: [], reason: 'discord_not_linked' as const };
    entry.servers.push({ id: s.id, name: s.name, deadline: s.pendingDeadlineAt });
    byUser.set(u.id, entry);
  }
  const out: Waiting[] = [];
  await mapLimit([...byUser.values()], 5, async (w) => {
    const reason = await pendingReasonFor(w.user, { cached: true });
    if (reason === 'discord_not_linked' || reason === 'discord_not_member') out.push({ ...w, reason });
  });
  return out.sort((a, b) => a.user.email.localeCompare(b.user.email));
}

/** Wann jeder dieser Nutzer zuletzt eine Erinnerung dieser Art bekommen hat */
async function lastReminders(type: string, userIds: string[]): Promise<Map<string, Date>> {
  const out = new Map<string, Date>();
  if (userIds.length === 0) return out;
  const rows = await db
    .select({ userId: notifications.userId, at: sql<number>`max(${notifications.createdAt})` })
    .from(notifications)
    .where(and(eq(notifications.type, type), inArray(notifications.userId, userIds)))
    .groupBy(notifications.userId);
  for (const r of rows) if (r.at) out.set(r.userId, new Date(Number(r.at)));
  return out;
}

export async function listDiscordWaiting(): Promise<AdminDiscordWaitingDTO> {
  const waiting = await discordWaiting();
  const last = await lastReminders('admin.discord_reminder', waiting.map((w) => w.user.id));
  return {
    users: waiting.map((w) => ({
      lastRemindedAt: last.get(w.user.id)?.toISOString() ?? null,
      userId: w.user.id,
      email: w.user.email,
      servers: w.servers.map((s) => s.name),
      reason: w.reason,
      // Die früheste Frist dieses Accounts (null = noch keine Erinnerung verschickt)
      deadline: w.servers.map((s) => s.deadline).filter((d): d is Date => d !== null).sort((a, b) => a.getTime() - b.getTime())[0]?.toISOString() ?? null,
    })),
  };
}

/**
 * Schickt allen Wartenden eine Erinnerung und setzt die Frist: Wird das Discord-Konto nicht innerhalb von `days`
 * Tagen verbunden, löscht das System die Anfrage. Eine schon laufende Frist bleibt bestehen (die Mail nennt das Datum).
 * Je Account höchstens eine Erinnerung pro Tag.
 */
export async function sendDiscordReminders(admin: User, days: number, ip?: string, userIds?: string[]): Promise<{ sent: number; skipped: number }> {
  // Nur die ausgewählten Nutzer (ohne Auswahl: alle Wartenden)
  const waiting = (await discordWaiting()).filter((w) => !userIds || userIds.includes(w.user.id));
  const now = new Date();
  let sent = 0;
  for (const w of waiting) {
    const existing = w.servers.map((s) => s.deadline).filter((d): d is Date => d !== null && d > now).sort((a, b) => a.getTime() - b.getTime())[0];
    const deadline = existing ?? new Date(now.getTime() + days * DAY_MS);
    await db.update(servers).set({ pendingDeadlineAt: deadline }).where(and(inArray(servers.id, w.servers.map((s) => s.id)), eq(servers.status, 'pending')));
    const names = w.servers.map((s) => `„${s.name}“`).join(', ');
    const namesEn = w.servers.map((s) => `“${s.name}”`).join(', ');
    const created = await notify({
      userId: w.user.id,
      type: 'admin.discord_reminder',
      title: L('Verbinde dein Discord-Konto – sonst verfällt dein Server', 'Connect your Discord account – otherwise your server expires'),
      body: (l) =>
        l === 'en'
          ? `Your server ${namesEn} has been requested but is still waiting for the Discord connection.\n${
              w.reason === 'discord_not_member'
                ? 'Your Discord account is linked, but you are not a member of our Discord server. Join it and click “Check again” under “My servers”.'
                : 'Connect your Discord account under “My servers” – this also adds you to our Discord server, and your server is created immediately.'
            }\nIf this does not happen by ${date(deadline, 'en')}, your request is deleted automatically and you have to request the server again.`
          : `Dein Server ${names} ist beantragt, wartet aber noch auf die Discord-Verbindung.\n${
              w.reason === 'discord_not_member'
                ? 'Dein Discord-Konto ist verknüpft, du bist aber kein Mitglied unseres Discord-Servers. Tritt bei und klicke unter „Meine Server“ auf „Erneut prüfen“.'
                : 'Verbinde dein Discord-Konto unter „Meine Server“ – dabei trittst du auch unserem Discord-Server bei, und dein Server wird sofort erstellt.'
            }\nPassiert das nicht bis zum ${date(deadline, 'de')}, wird deine Anfrage automatisch gelöscht und du musst den Server neu beantragen.`,
      dedupeKey: `discord-reminder:${w.user.id}:${now.toISOString().slice(0, 10)}`,
      email: true,
    });
    if (created) sent++;
  }
  await audit({ actor: 'admin', action: 'admin.discord_reminder', message: `Erinnerung „Discord verbinden“ an ${sent} Nutzer geschickt (Frist ${days} Tage; ${waiting.length - sent} heute schon erinnert) (durch ${admin.email})`, ip });
  return { sent, skipped: waiting.length - sent };
}

/** Job: offene Anfragen löschen, deren Frist abgelaufen ist und die weiter auf die Discord-Verbindung warten */
export async function expireDiscordWaiting(now = new Date()): Promise<number> {
  const rows = await db
    .select({ s: servers, u: users })
    .from(servers)
    .innerJoin(users, eq(users.id, servers.userId))
    .where(and(eq(servers.status, 'pending'), isNotNull(servers.pendingDeadlineAt), lt(servers.pendingDeadlineAt, now)))
    .limit(500);
  let deleted = 0;
  for (const { s, u } of rows) {
    const reason = await pendingReasonFor(u);
    // Nur löschen, wenn es wirklich (noch) an Discord liegt – nicht, wenn Discord gerade nicht erreichbar ist
    if (reason !== 'discord_not_linked' && reason !== 'discord_not_member') continue;
    await db.delete(servers).where(and(eq(servers.id, s.id), eq(servers.status, 'pending')));
    deleted++;
    await audit({ userId: u.id, actor: 'system', action: 'server.request_expired', message: `Anfrage „${s.name}“ gelöscht: Discord-Konto wurde trotz Erinnerung nicht verbunden` });
    await notify({
      userId: u.id,
      type: 'server.request_expired',
      title: L(`Deine Anfrage für „${s.name}“ wurde gelöscht`, `Your request for “${s.name}” has been deleted`),
      body: L(
        'Die Frist für die Discord-Verbindung ist abgelaufen, deshalb haben wir deine Anfrage gelöscht. Du kannst jederzeit einen neuen Server beantragen – verbinde dafür am besten zuerst dein Discord-Konto unter „Meine Server“.',
        'The deadline for connecting Discord has passed, so we deleted your request. You can request a new server at any time – ideally connect your Discord account under “My servers” first.',
      ),
      dedupeKey: `request-expired:${s.id}`,
      email: true,
    });
  }
  return deleted;
}

/* ------------------------------------------------------------ Erinnerung: Panel-Zugang einrichten */

/**
 * Konten, die bestätigt sind (Discord verknüpft oder E-Mail bestätigt), aber noch keinen Panel-Zugang eingerichtet haben.
 * Ausgenommen: Admins, Partner-Konten und gesperrte Konten.
 */
async function panelWaiting(): Promise<{ user: User; servers: string[] }[]> {
  const rows = await db
    .select()
    .from(users)
    .where(and(isNull(users.pteroUserId), eq(users.status, 'active'), identityConfirmedSql(), notExists(db.select({ id: partners.id }).from(partners).where(eq(partners.userId, users.id)))))
    .orderBy(users.createdAt)
    .limit(2000);
  const list = rows.filter((u) => !isAdmin(u));
  const requested = list.length
    ? await db
        .select({ userId: servers.userId, name: servers.name })
        .from(servers)
        .where(and(inArray(servers.userId, list.map((u) => u.id)), inArray(servers.status, ['pending', 'waitlist'])))
    : [];
  return list.map((user) => ({ user, servers: requested.filter((r) => r.userId === user.id).map((r) => r.name) }));
}

export async function listPanelWaiting(): Promise<AdminPanelWaitingDTO> {
  const waiting = await panelWaiting();
  const last = await lastReminders('admin.panel_reminder', waiting.map((w) => w.user.id));
  return {
    users: waiting.map((w) => ({
      userId: w.user.id,
      email: w.user.email,
      createdAt: w.user.createdAt.toISOString(),
      servers: w.servers,
      deadline: w.user.panelDeadlineAt?.toISOString() ?? null,
      lastRemindedAt: last.get(w.user.id)?.toISOString() ?? null,
    })),
  };
}

/**
 * Erinnerung „Richte deinen Panel-Zugang ein“ an die ausgewählten Konten. Setzt die Frist: Ist bis dahin kein
 * Panel-Konto eingerichtet, löscht das System das Konto (Job cleanup). Eine schon laufende Frist bleibt bestehen.
 * Je Konto höchstens eine Erinnerung pro Tag.
 */
export async function sendPanelReminders(admin: User, days: number, userIds: string[] | undefined, ip?: string): Promise<{ sent: number; skipped: number }> {
  const waiting = (await panelWaiting()).filter((w) => !userIds || userIds.includes(w.user.id));
  const now = new Date();
  let sent = 0;
  for (const { user, servers: requested } of waiting) {
    const deadline = user.panelDeadlineAt && user.panelDeadlineAt > now ? user.panelDeadlineAt : new Date(now.getTime() + days * DAY_MS);
    await db.update(users).set({ panelDeadlineAt: deadline }).where(and(eq(users.id, user.id), isNull(users.pteroUserId)));
    const named = requested.length ? requested.map((n) => `„${n}“`).join(', ') : null;
    const namedEn = requested.length ? requested.map((n) => `“${n}”`).join(', ') : null;
    const created = await notify({
      userId: user.id,
      type: 'admin.panel_reminder',
      title: L('Richte deinen Panel-Zugang ein – sonst wird dein Konto gelöscht', 'Set up your panel access – otherwise your account will be deleted'),
      body: (l) =>
        l === 'en'
          ? `You created an account on CraftingHosting.free but have not set up your panel access yet.${namedEn ? ` Your server ${namedEn} is waiting for it.` : ''}
Sign in and choose a panel password under “My servers” – it only takes a minute, and your server is created right after.
If this does not happen by ${date(deadline, 'en')}, your account will be deleted automatically. You can register again at any time.`
          : `Du hast ein Konto bei CraftingHosting.free angelegt, deinen Panel-Zugang aber noch nicht eingerichtet.${named ? ` Darauf wartet dein Server ${named}.` : ''}
Melde dich an und lege unter „Meine Server“ dein Panel-Passwort fest – das dauert eine Minute, danach wird dein Server sofort erstellt.
Passiert das nicht bis zum ${date(deadline, 'de')}, wird dein Konto automatisch gelöscht. Du kannst dich jederzeit neu registrieren.`,
      dedupeKey: `panel-reminder:${user.id}:${now.toISOString().slice(0, 10)}`,
      email: true,
    });
    if (created) sent++;
  }
  await audit({ actor: 'admin', action: 'admin.panel_reminder', message: `Erinnerung „Panel-Zugang einrichten“ an ${sent} Nutzer geschickt (Frist ${days} Tage; ${waiting.length - sent} heute schon erinnert) (durch ${admin.email})`, ip });
  return { sent, skipped: waiting.length - sent };
}

/** Job: Konten löschen, deren Frist für den Panel-Zugang abgelaufen ist und die ihn weiterhin nicht haben */
export async function expirePanelWaiting(now = new Date()): Promise<number> {
  const rows = await db
    .select()
    .from(users)
    .where(and(isNotNull(users.panelDeadlineAt), lt(users.panelDeadlineAt, now), isNull(users.pteroUserId), eq(users.status, 'active')))
    .limit(200);
  let deleted = 0;
  for (const user of rows) {
    if (isAdmin(user)) continue;
    const [partner] = await db.select({ id: partners.id }).from(partners).where(eq(partners.userId, user.id)).limit(1);
    if (partner) continue;
    // Sicherheitshalber: kein Konto löschen, dem ein im Panel angelegter Server gehört
    const [panelServer] = await db.select({ id: servers.id }).from(servers).where(and(eq(servers.userId, user.id), isNotNull(servers.pteroServerId), ne(servers.status, 'deleted'))).limit(1);
    if (panelServer) continue;
    // Erneut prüfen: Hat das Konto gerade eben doch noch den Panel-Zugang eingerichtet?
    const [fresh] = await db.select({ ptero: users.pteroUserId, deadline: users.panelDeadlineAt }).from(users).where(eq(users.id, user.id)).limit(1);
    if (!fresh || fresh.ptero !== null || !fresh.deadline || fresh.deadline >= now) continue;
    try {
      await deleteAccount(user, {});
      deleted++;
      await audit({ actor: 'system', action: 'account.panel_deadline_expired', message: `Konto ${user.email} gelöscht: Panel-Zugang trotz Erinnerung nicht eingerichtet` });
    } catch {
      // z. B. offener Abuse-Fall – das Konto bleibt dann bestehen
    }
  }
  return deleted;
}

/* ------------------------------------------------------------ Nachricht an ausgewählte Nutzer */

const clean = (t: Localized): Localized => {
  const de = t.de.trim();
  const en = t.en.trim();
  return { de: de || en, en: en || de };
};

/** Schickt eine Nachricht an bestimmte Nutzer (E-Mail-Adressen). Unbekannte Adressen werden zurückgemeldet. */
export async function sendAdminMessage(admin: User, input: { emails: string[]; subject: Localized; body: Localized }, ip?: string): Promise<{ sent: number; unknown: string[] }> {
  const emails = [...new Set(input.emails.map((e) => e.trim().toLowerCase()).filter(Boolean))];
  const subject = clean(input.subject);
  const body = clean(input.body);
  if (!subject.de || !body.de) throw new ApiError(400, 'validation_error', L('Betreff und Text dürfen nicht leer sein.', 'Subject and text must not be empty.'));
  const found = emails.length ? await db.select().from(users).where(inArray(users.email, emails)) : [];
  const unknown = emails.filter((e) => !found.some((u) => u.email === e));
  const batch = uuid();
  for (const u of found) {
    await notify({ userId: u.id, type: 'admin.message', title: subject, body, dedupeKey: `admin-message:${batch}:${u.id}`, email: true });
  }
  await audit({ actor: 'admin', action: 'admin.message_sent', message: `Nachricht „${subject.de.slice(0, 80)}“ an ${found.length} Nutzer geschickt (durch ${admin.email})`, ip });
  return { sent: found.length, unknown };
}

/* ------------------------------------------------------------ Abuse */

/** Automatisch verschickte Meldungen, die ebenfalls in den Abuse-Bereich gehören */
const AUTO_ABUSE_TYPES = ['fair_use.bot_cpu_stop', 'fair_use.bot_suspended', 'fair_use.pause_violation'];

export async function listAbuse(): Promise<AdminAbuseDTO> {
  const rows = await db
    .select({ n: notifications, email: users.email, server: servers.name })
    .from(notifications)
    .innerJoin(users, eq(users.id, notifications.userId))
    .leftJoin(servers, eq(servers.id, notifications.serverId))
    .where(or(like(notifications.type, 'abuse.%'), inArray(notifications.type, AUTO_ABUSE_TYPES)))
    .orderBy(desc(notifications.createdAt))
    .limit(200);
  const flagged = await db
    .select({ s: servers, email: users.email })
    .from(servers)
    .innerJoin(users, eq(users.id, servers.userId))
    .where(and(isNotNull(servers.abuseAt), ne(servers.status, 'deleted')))
    .orderBy(desc(servers.abuseAt))
    .limit(200);
  return {
    warnings: await listWarnings(),
    reasons: ABUSE_REASONS.map((r) => ({ id: r.id, label: r.label })),
    flagged: flagged.map(({ s, email }) => ({ id: s.id, name: s.name, ownerEmail: email, reason: abuseReasonLabel(s.abuseReason), source: s.abuseSource ?? ('system' as const), at: s.abuseAt!.toISOString(), status: s.status })),
    mails: rows.map(({ n, email, server }) => ({
      id: n.id,
      createdAt: n.createdAt.toISOString(),
      userEmail: email,
      type: n.type,
      // Ohne ausdrückliche Angabe (ältere Einträge) gilt: vom System
      manual: n.abuseSource === 'manual',
      title: n.title,
      body: n.body,
      emailStatus: n.emailStatus,
      emailLastError: n.emailLastError,
      serverName: server ?? null,
    })),
  };
}

/** Nachträglich festhalten, ob ein Verstoß vom System oder von Hand festgestellt wurde */
export async function setAbuseSource(admin: User, id: string, source: 'system' | 'manual', ip?: string): Promise<void> {
  const [n] = await db.select().from(notifications).where(eq(notifications.id, id)).limit(1);
  if (!n || !(n.type.startsWith('abuse.') || AUTO_ABUSE_TYPES.includes(n.type))) throw Errors.notFound(L('Eintrag nicht gefunden.', 'Entry not found.'));
  await db.update(notifications).set({ abuseSource: source }).where(eq(notifications.id, id));
  // Der markierte Server zeigt dieselbe Angabe – auch dem Nutzer unter „Meine Server“
  if (n.serverId) await db.update(servers).set({ abuseSource: source }).where(and(eq(servers.id, n.serverId), isNotNull(servers.abuseAt)));
  await audit({ userId: n.userId, serverId: n.serverId, actor: 'admin', action: 'admin.abuse_source', message: `Abuse-Meldung „${n.title.slice(0, 80)}“ als „${source === 'system' ? 'vom System' : 'von Hand'}“ gekennzeichnet (durch ${admin.email})`, ip });
}

/** Dasselbe für einen markierten Server: gilt auch für die zugehörigen Meldungen seit der Markierung */
export async function setServerAbuseSource(admin: User, serverId: string, source: 'system' | 'manual', ip?: string): Promise<void> {
  const [s] = await db.select().from(servers).where(and(eq(servers.id, serverId), isNotNull(servers.abuseAt))).limit(1);
  if (!s) throw Errors.notFound(L('Dieser Server ist nicht als Abuse markiert.', 'This server is not flagged as abuse.'));
  await db.update(servers).set({ abuseSource: source }).where(eq(servers.id, serverId));
  await db.update(notifications).set({ abuseSource: source }).where(and(eq(notifications.serverId, serverId), like(notifications.type, 'abuse.%')));
  await audit({ userId: s.userId, serverId, actor: 'admin', action: 'admin.abuse_source', message: `Abuse-Markierung von „${s.name}“ als „${source === 'system' ? 'vom System' : 'von Hand'}“ gekennzeichnet (durch ${admin.email})`, ip });
}

/** Server eines Nutzers zur Auswahl im Abuse-Formular */
export async function listAbuseServers(email: string): Promise<{ id: string; name: string; kind: string; status: string; flagged: boolean }[]> {
  const [user] = await db.select({ id: users.id }).from(users).where(eq(users.email, email.trim().toLowerCase())).limit(1);
  if (!user) return [];
  const rows = await db
    .select()
    .from(servers)
    .where(and(eq(servers.userId, user.id), inArray(servers.status, ['provisioning', 'provisioning_failed', 'active', 'expiring', 'suspended'])))
    .orderBy(desc(servers.createdAt));
  return rows.map((s) => ({ id: s.id, name: s.name, kind: s.kind, status: s.status, flagged: s.abuseAt !== null }));
}

export interface AbuseInput {
  email: string;
  reason: string;
  note: Localized;
  suspend: boolean;
  /** Betroffener Server (leer = kein bestimmter) */
  serverId?: string | null;
  /** Wer den Verstoß festgestellt hat: das System (Standard) oder das Team von Hand */
  source?: 'system' | 'manual';
  /** Zählt die Nachricht als Verwarnung? (Standard: ja – „nein“ = nur ein Hinweis) */
  warning?: boolean;
}

/** Adresse des Discord-Servers für den Hinweis „öffne ein Ticket“ */
async function discordLink(): Promise<string> {
  const settings = await getSettings();
  const invite = settings.discord.enabled ? (await getDiscordState().catch(() => null))?.inviteCode : null;
  return invite ? `https://discord.gg/${invite}` : resolveBrand(settings).discordUrl;
}

/** Betreff und Text einer Abuse-Mail – genau so, wie sie verschickt wird (auch für die Vorschau im Admin-Bereich) */
function composeAbuse(reasonId: string, noteRaw: Localized, serverName: string | null, suspended: number, discord: string, warning: Localized | null = null, flaggedAll = false): { title: Localized; body: Localized } {
  const reason = ABUSE_REASONS.find((r) => r.id === reasonId);
  if (!reason) throw new ApiError(400, 'validation_error', L('Unbekannter Grund.', 'Unknown reason.'));
  const note = clean(noteRaw);
  const part = (l: Locale) =>
    [
      reason.text[l],
      serverName ? (l === 'en' ? `The affected server is “${serverName}”.` : `Betroffen ist dein Server „${serverName}“.`) : '',
      note[l],
      suspended > 0
        ? l === 'en'
          ? `We have suspended ${serverName || suspended === 1 ? 'the server' : 'your servers'} for now.`
          : `Wir haben ${serverName || suspended === 1 ? 'den Server' : 'deine Server'} vorerst gesperrt.`
        : l === 'en'
          ? 'Please stop this immediately. In case of repeated violations we suspend or delete the server or the account.'
          : 'Bitte stelle das umgehend ab. Bei wiederholten Verstößen sperren oder löschen wir den Server bzw. den Account.',
      serverName ? (l === 'en' ? 'The server is marked as “Abuse” under “My servers” until this has been resolved. Until then it cannot be deleted.' : 'Der Server ist unter „Meine Server“ als „Abuse“ markiert, bis das geklärt ist. So lange lässt er sich nicht löschen.') : '',
      flaggedAll ? (l === 'en' ? 'The suspended servers are marked as “Abuse” under “My servers” until this has been resolved. Until then they cannot be deleted.' : 'Die gesperrten Server sind unter „Meine Server“ als „Abuse“ markiert, bis das geklärt ist. So lange lassen sie sich nicht löschen.') : '',
      // Verwarnungs-System: die wievielte Verwarnung das ist und was daraus folgt
      warning ? warning[l] : '',
      l === 'en' ? `To resolve this, please open a ticket on our Discord server: ${discord}` : `Um das zu klären, öffne bitte ein Ticket auf unserem Discord-Server: ${discord}`,
    ]
      .filter(Boolean)
      .join('\n');
  return { title: reason.title, body: { de: part('de'), en: part('en') } };
}

async function abuseTarget(input: AbuseInput): Promise<{ user: User | null; server: { id: string; name: string } | null; toSuspend: string[]; toKeep: string[] }> {
  const [user] = await db.select().from(users).where(eq(users.email, input.email.trim().toLowerCase())).limit(1);
  if (!user) return { user: null, server: null, toSuspend: [], toKeep: [] };
  const owned = await db.select().from(servers).where(and(eq(servers.userId, user.id), ne(servers.status, 'deleted')));
  const server = input.serverId ? (owned.find((s) => s.id === input.serverId) ?? null) : null;
  if (input.serverId && !server) throw new ApiError(404, 'server_not_found', L('Dieser Server gehört nicht zu diesem Nutzer.', 'This server does not belong to this user.'));
  // Sperren: nur den betroffenen Server – ohne Auswahl alle laufenden Server des Nutzers
  const candidates = server ? [server] : owned;
  const toSuspend = input.suspend ? candidates.filter((s) => s.status === 'active' || s.status === 'expiring').map((s) => s.id) : [];
  // Schon wegen einer Auszeit gesperrt: Diese Server sollen NICHT von selbst wieder frei werden, wenn das Team sperrt
  const toKeep = input.suspend ? candidates.filter((s) => s.status === 'suspended' && s.suspensionReason === 'warning').map((s) => s.id) : [];
  return { user, server: server ? { id: server.id, name: server.name } : null, toSuspend, toKeep };
}

/** Vorschau der Abuse-Mail in beiden Sprachen */
export async function previewAbuse(input: AbuseInput): Promise<{ title: Localized; body: Localized; locale: Locale | null; warning: { count: number; sanction: WarningSanction } | null }> {
  const target = await abuseTarget(input).catch(() => ({ user: null, server: null, toSuspend: [] as string[], toKeep: [] as string[] }));
  // Ohne bekannten Nutzer zeigt die Vorschau den Text so, als würde ein Server gesperrt
  const suspended = input.suspend ? (target.user ? target.toSuspend.length + target.toKeep.length : 1) : 0;
  // Ohne bekannten Nutzer: so, als wäre es die erste Verwarnung
  const effect = input.warning === false ? null : target.user ? await nextWarningEffect(target.user) : { count: 1, sanction: 'none' as const };
  return { ...composeAbuse(input.reason, input.note, target.server?.name ?? null, suspended, await discordLink(), effect ? warningParagraph(effect, date) : null), locale: target.user?.locale ?? null, warning: effect };
}

/**
 * Abuse-Mail von Hand: Grund + optionaler eigener Text. Ist ein Server ausgewählt, wird er unter „Meine Server“
 * als Abuse markiert; auf Wunsch wird er (bzw. ohne Auswahl alle Server des Nutzers) gesperrt.
 */
export async function sendAbuseMail(admin: User, input: AbuseInput, ip?: string): Promise<{ suspended: number; warning: { count: number; sanction: WarningSanction; until: string | null } | null }> {
  const reason = ABUSE_REASONS.find((r) => r.id === input.reason);
  if (!reason) throw new ApiError(400, 'validation_error', L('Unbekannter Grund.', 'Unknown reason.'));
  if (reason.id === 'other' && !clean(input.note).de) throw new ApiError(400, 'validation_error', L('Bitte einen eigenen Text angeben.', 'Please enter your own text.'));
  const { user, server, toSuspend, toKeep } = await abuseTarget(input);
  if (!user) throw new ApiError(404, 'user_not_found', L('Zu dieser E-Mail-Adresse gibt es keinen Account.', 'There is no account for this email address.'));

  // Erst sperren und markieren, dann schreiben – so stimmt der Text der Mail
  let suspended = 0;
  for (const id of toSuspend) {
    await serverAction(admin, id, 'suspend', ip).then(
      () => suspended++,
      () => {},
    );
  }
  if (toKeep.length) {
    suspended += affectedRows(await db.update(servers).set({ suspensionReason: 'admin' }).where(and(inArray(servers.id, toKeep), eq(servers.status, 'suspended'), eq(servers.suspensionReason, 'warning'))));
  }
  // Markieren: den ausgewählten Server – ohne Auswahl alle, die mit dieser Nachricht gesperrt wurden. Markierte Server
  // lassen sich vom Nutzer nicht löschen, bis das Team die Markierung aufhebt.
  const flagged = server ? [server.id] : [...toSuspend, ...toKeep];
  if (flagged.length) await db.update(servers).set({ abuseAt: new Date(), abuseReason: reason.id, abuseSource: input.source ?? 'system' }).where(inArray(servers.id, flagged));
  const dedupeKey = `abuse:${uuid()}`;
  // Verwarnung eintragen und die Folge (Auszeit, Ban) anwenden – die Nachricht nennt dann genau, was passiert ist
  const warned = input.warning === false ? null : await issueWarning(user, { reason: reason.id, note: clean(input.note).de, server, notificationKey: dedupeKey, by: admin.email });
  const mail = composeAbuse(reason.id, input.note, server?.name ?? null, suspended, await discordLink(), warned ? warningParagraph(warned, date) : null, !server && flagged.length > 0);
  await notify({ userId: user.id, serverId: server?.id ?? null, type: `abuse.${reason.id}`, title: mail.title, body: mail.body, dedupeKey, email: true });
  // Festhalten, ob das System oder das Team den Verstoß festgestellt hat (im Abuse-Bereich nachträglich änderbar)
  await db.update(notifications).set({ abuseSource: input.source ?? 'system' }).where(eq(notifications.dedupeKey, dedupeKey));
  await audit({
    userId: user.id,
    serverId: server?.id ?? null,
    actor: 'admin',
    action: 'admin.abuse_mail',
    message: `Abuse-Mail „${reason.label}“ an ${user.email}${server ? ` zu Server „${server.name}“ (als Abuse markiert)` : ''}${suspended ? ` – ${suspended} Server gesperrt` : ''}${warned ? ` – ${warned.count}. Verwarnung${warned.sanction === 'timeout' ? ', Auszeit' : warned.sanction === 'ban' ? ', Ban' : ''}` : ' – ohne Verwarnung'} (durch ${admin.email})`,
    ip,
  });
  return { suspended, warning: warned ? { count: warned.count, sanction: warned.sanction, until: warned.until?.toISOString() ?? null } : null };
}

/** Abuse-Markierung eines Servers aufheben (z. B. nachdem das Ticket geklärt ist) */
export async function clearAbuseFlag(admin: User, serverId: string, ip?: string): Promise<void> {
  const [server] = await db.select().from(servers).where(eq(servers.id, serverId)).limit(1);
  if (!server || !server.abuseAt) throw new ApiError(404, 'not_found', L('Dieser Server ist nicht als Abuse markiert.', 'This server is not marked as abuse.'));
  // War der Server inzwischen abgelaufen, beginnt die Frist zum Reaktivieren jetzt neu (markiert wurde er nicht automatisch
  // gelöscht) – vor dem Aufheben, damit der Zyklus-Job nicht dazwischen die alte Frist sieht
  await restoreReactivationWindow({ serverId });
  await db.update(servers).set({ abuseAt: null, abuseReason: null, abuseSource: null }).where(eq(servers.id, serverId));
  await audit({ userId: server.userId, serverId, actor: 'admin', action: 'admin.abuse_cleared', message: `Abuse-Markierung von Server „${server.name}“ aufgehoben (durch ${admin.email})`, ip });
}
