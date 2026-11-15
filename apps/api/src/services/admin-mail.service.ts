/**
 * E-Mails aus dem Admin-Bereich:
 *  – Erinnerung an alle, deren Server noch auf die Discord-Verbindung wartet (mit Frist – danach wird die Anfrage gelöscht)
 *  – Nachricht an ausgewählte Nutzer
 *  – Abuse-Mails von Hand und die Übersicht aller Abuse-Mails
 * Versendet wird über die Benachrichtigungen (Outbox): Die Nachricht erscheint auch unter „Meine Server“,
 * die E-Mail verschickt der Worker – Fehler stehen im Reiter „E-Mails“.
 */
import { and, desc, eq, inArray, isNotNull, like, lt, ne, or } from 'drizzle-orm';
import { formatDateTime, freeHostingConfig, type AdminAbuseDTO, type AdminDiscordWaitingDTO, type Locale, type Localized } from '@chfree/shared';
import { db } from '../db/client';
import { notifications, servers, users, type User } from '../db/schema';
import { uuid } from '../lib/crypto';
import { ApiError, L } from '../lib/errors';
import { mapLimit } from '../jobs/types';
import { getDiscordState } from '../discord/store';
import { ABUSE_REASONS, abuseReasonLabel } from './abuse-reasons';
import { serverAction } from './admin.service';
import { audit } from './audit.service';
import { notify } from './notification.service';
import { pendingReasonFor } from './server.service';
import { getSettings, resolveBrand } from './settings.service';

const DAY_MS = 86_400_000;
const date = (d: Date, l: Locale) => formatDateTime(d, freeHostingConfig.fairUse.timezone, l);

/* ------------------------------------------------------------ Erinnerung: Discord-Verbindung */

type Waiting = { user: User; servers: { id: string; name: string; deadline: Date | null }[]; reason: 'discord_not_linked' | 'discord_not_member' };

/** Accounts mit Panel-Konto, deren offene Anfrage nur noch an der Discord-Verbindung hängt */
async function discordWaiting(): Promise<Waiting[]> {
  const rows = await db
    .select({ s: servers, u: users })
    .from(servers)
    .innerJoin(users, eq(users.id, servers.userId))
    .where(and(eq(servers.status, 'pending'), isNotNull(users.emailVerifiedAt), isNotNull(users.pteroUserId), eq(users.status, 'active')))
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

export async function listDiscordWaiting(): Promise<AdminDiscordWaitingDTO> {
  return {
    users: (await discordWaiting()).map((w) => ({
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
export async function sendDiscordReminders(admin: User, days: number, ip?: string): Promise<{ sent: number; skipped: number }> {
  const waiting = await discordWaiting();
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
    reasons: ABUSE_REASONS.map((r) => ({ id: r.id, label: r.label })),
    flagged: flagged.map(({ s, email }) => ({ id: s.id, name: s.name, ownerEmail: email, reason: abuseReasonLabel(s.abuseReason), at: s.abuseAt!.toISOString(), status: s.status })),
    mails: rows.map(({ n, email, server }) => ({
      id: n.id,
      createdAt: n.createdAt.toISOString(),
      userEmail: email,
      type: n.type,
      manual: n.type.startsWith('abuse.'),
      title: n.title,
      body: n.body,
      emailStatus: n.emailStatus,
      emailLastError: n.emailLastError,
      serverName: server ?? null,
    })),
  };
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
}

/** Adresse des Discord-Servers für den Hinweis „öffne ein Ticket“ */
async function discordLink(): Promise<string> {
  const settings = await getSettings();
  const invite = settings.discord.enabled ? (await getDiscordState().catch(() => null))?.inviteCode : null;
  return invite ? `https://discord.gg/${invite}` : resolveBrand(settings).discordUrl;
}

/** Betreff und Text einer Abuse-Mail – genau so, wie sie verschickt wird (auch für die Vorschau im Admin-Bereich) */
function composeAbuse(reasonId: string, noteRaw: Localized, serverName: string | null, suspended: number, discord: string): { title: Localized; body: Localized } {
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
      serverName ? (l === 'en' ? 'The server is marked as “Abuse” under “My servers” until this has been resolved.' : 'Der Server ist unter „Meine Server“ als „Abuse“ markiert, bis das geklärt ist.') : '',
      l === 'en' ? `To resolve this, please open a ticket on our Discord server: ${discord}` : `Um das zu klären, öffne bitte ein Ticket auf unserem Discord-Server: ${discord}`,
    ]
      .filter(Boolean)
      .join('\n');
  return { title: reason.title, body: { de: part('de'), en: part('en') } };
}

async function abuseTarget(input: AbuseInput): Promise<{ user: User | null; server: { id: string; name: string } | null; toSuspend: string[] }> {
  const [user] = await db.select().from(users).where(eq(users.email, input.email.trim().toLowerCase())).limit(1);
  if (!user) return { user: null, server: null, toSuspend: [] };
  const owned = await db.select().from(servers).where(and(eq(servers.userId, user.id), ne(servers.status, 'deleted')));
  const server = input.serverId ? (owned.find((s) => s.id === input.serverId) ?? null) : null;
  if (input.serverId && !server) throw new ApiError(404, 'server_not_found', L('Dieser Server gehört nicht zu diesem Nutzer.', 'This server does not belong to this user.'));
  // Sperren: nur den betroffenen Server – ohne Auswahl alle laufenden Server des Nutzers
  const candidates = server ? [server] : owned;
  const toSuspend = input.suspend ? candidates.filter((s) => s.status === 'active' || s.status === 'expiring').map((s) => s.id) : [];
  return { user, server: server ? { id: server.id, name: server.name } : null, toSuspend };
}

/** Vorschau der Abuse-Mail in beiden Sprachen */
export async function previewAbuse(input: AbuseInput): Promise<{ title: Localized; body: Localized; locale: Locale | null }> {
  const target = await abuseTarget(input).catch(() => ({ user: null, server: null, toSuspend: [] as string[] }));
  // Ohne bekannten Nutzer zeigt die Vorschau den Text so, als würde ein Server gesperrt
  const suspended = input.suspend ? Math.max(1, target.toSuspend.length) : 0;
  return { ...composeAbuse(input.reason, input.note, target.server?.name ?? null, suspended, await discordLink()), locale: target.user?.locale ?? null };
}

/**
 * Abuse-Mail von Hand: Grund + optionaler eigener Text. Ist ein Server ausgewählt, wird er unter „Meine Server“
 * als Abuse markiert; auf Wunsch wird er (bzw. ohne Auswahl alle Server des Nutzers) gesperrt.
 */
export async function sendAbuseMail(admin: User, input: AbuseInput, ip?: string): Promise<{ suspended: number }> {
  const reason = ABUSE_REASONS.find((r) => r.id === input.reason);
  if (!reason) throw new ApiError(400, 'validation_error', L('Unbekannter Grund.', 'Unknown reason.'));
  if (reason.id === 'other' && !clean(input.note).de) throw new ApiError(400, 'validation_error', L('Bitte einen eigenen Text angeben.', 'Please enter your own text.'));
  const { user, server, toSuspend } = await abuseTarget(input);
  if (!user) throw new ApiError(404, 'user_not_found', L('Zu dieser E-Mail-Adresse gibt es keinen Account.', 'There is no account for this email address.'));

  // Erst sperren und markieren, dann schreiben – so stimmt der Text der Mail
  let suspended = 0;
  for (const id of toSuspend) {
    await serverAction(admin, id, 'suspend', ip).then(
      () => suspended++,
      () => {},
    );
  }
  if (server) await db.update(servers).set({ abuseAt: new Date(), abuseReason: reason.id }).where(eq(servers.id, server.id));
  const mail = composeAbuse(reason.id, input.note, server?.name ?? null, suspended, await discordLink());
  await notify({ userId: user.id, serverId: server?.id ?? null, type: `abuse.${reason.id}`, title: mail.title, body: mail.body, dedupeKey: `abuse:${uuid()}`, email: true });
  await audit({
    userId: user.id,
    serverId: server?.id ?? null,
    actor: 'admin',
    action: 'admin.abuse_mail',
    message: `Abuse-Mail „${reason.label}“ an ${user.email}${server ? ` zu Server „${server.name}“ (als Abuse markiert)` : ''}${suspended ? ` – ${suspended} Server gesperrt` : ''} (durch ${admin.email})`,
    ip,
  });
  return { suspended };
}

/** Abuse-Markierung eines Servers aufheben (z. B. nachdem das Ticket geklärt ist) */
export async function clearAbuseFlag(admin: User, serverId: string, ip?: string): Promise<void> {
  const [server] = await db.select().from(servers).where(eq(servers.id, serverId)).limit(1);
  if (!server || !server.abuseAt) throw new ApiError(404, 'not_found', L('Dieser Server ist nicht als Abuse markiert.', 'This server is not marked as abuse.'));
  await db.update(servers).set({ abuseAt: null, abuseReason: null }).where(eq(servers.id, serverId));
  await audit({ userId: server.userId, serverId, actor: 'admin', action: 'admin.abuse_cleared', message: `Abuse-Markierung von Server „${server.name}“ aufgehoben (durch ${admin.email})`, ip });
}
