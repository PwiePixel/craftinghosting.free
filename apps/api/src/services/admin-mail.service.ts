/**
 * E-Mails aus dem Admin-Bereich:
 *  – Erinnerung an alle, deren Server noch auf die Discord-Verbindung wartet (mit Frist – danach wird die Anfrage gelöscht)
 *  – Nachricht an ausgewählte Nutzer
 *  – Abuse-Mails von Hand und die Übersicht aller Abuse-Mails
 * Versendet wird über die Benachrichtigungen (Outbox): Die Nachricht erscheint auch unter „Meine Server“,
 * die E-Mail verschickt der Worker – Fehler stehen im Reiter „E-Mails“.
 */
import { and, desc, eq, inArray, isNotNull, like, lt, or } from 'drizzle-orm';
import { formatDateTime, freeHostingConfig, type AdminAbuseDTO, type AdminDiscordWaitingDTO, type Locale, type Localized } from '@chfree/shared';
import { db } from '../db/client';
import { notifications, servers, users, type User } from '../db/schema';
import { uuid } from '../lib/crypto';
import { ApiError, L } from '../lib/errors';
import { mapLimit } from '../jobs/types';
import { serverAction } from './admin.service';
import { audit } from './audit.service';
import { notify } from './notification.service';
import { pendingReasonFor } from './server.service';

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

/** Gründe für eine Abuse-Mail – Text in beiden Sprachen, der Empfänger bekommt seine Sprache */
const ABUSE_REASONS: { id: string; label: string; title: Localized; text: Localized }[] = [
  {
    id: 'resources',
    label: 'Übermäßige Auslastung (CPU, RAM, Netzwerk)',
    title: { de: 'Hinweis: Dein Server belastet unsere Systeme zu stark', en: 'Notice: your server puts too much load on our systems' },
    text: {
      de: 'Uns ist aufgefallen, dass dein Server unsere Systeme dauerhaft über das faire Maß hinaus belastet. Die Ressourcen werden zwischen allen Nutzern geteilt.',
      en: 'We noticed that your server permanently puts more load on our systems than is fair. Resources are shared between all users.',
    },
  },
  {
    id: 'mining',
    label: 'Krypto-Mining',
    title: { de: 'Verstoß gegen die Regeln: Krypto-Mining', en: 'Rule violation: crypto mining' },
    text: { de: 'Auf deinem Server wurde Krypto-Mining festgestellt. Das ist auf CraftingHosting.free nicht erlaubt.', en: 'Crypto mining was detected on your server. This is not allowed on CraftingHosting.free.' },
  },
  {
    id: 'attacks',
    label: 'Angriffe, Spam, Portscans',
    title: { de: 'Verstoß gegen die Regeln: Angriffe oder Spam', en: 'Rule violation: attacks or spam' },
    text: {
      de: 'Von deinem Server gingen Angriffe, Spam oder Portscans aus. Das ist auf CraftingHosting.free nicht erlaubt.',
      en: 'Attacks, spam or port scans originated from your server. This is not allowed on CraftingHosting.free.',
    },
  },
  {
    id: 'content',
    label: 'Verbotene Inhalte',
    title: { de: 'Verstoß gegen die Regeln: unzulässige Inhalte', en: 'Rule violation: prohibited content' },
    text: { de: 'Auf deinem Server liegen Inhalte, die nach unseren Regeln nicht erlaubt sind.', en: 'Your server hosts content that is not allowed under our rules.' },
  },
  {
    id: 'multi',
    label: 'Mehrfach-Accounts',
    title: { de: 'Verstoß gegen die Regeln: mehrere Accounts', en: 'Rule violation: multiple accounts' },
    text: { de: 'Wir haben Hinweise darauf, dass du mehrere Accounts nutzt, um die Grenzen des kostenlosen Angebots zu umgehen.', en: 'We have indications that you use several accounts to get around the limits of the free offer.' },
  },
  {
    id: 'other',
    label: 'Sonstiger Verstoß (eigener Text)',
    title: { de: 'Hinweis zu einem Verstoß gegen unsere Regeln', en: 'Notice about a violation of our rules' },
    text: { de: '', en: '' },
  },
];

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
  return {
    reasons: ABUSE_REASONS.map((r) => ({ id: r.id, label: r.label })),
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

/** Abuse-Mail von Hand: Grund + optionaler eigener Text; auf Wunsch werden die Server des Nutzers gesperrt */
export async function sendAbuseMail(admin: User, input: { email: string; reason: string; note: Localized; suspend: boolean }, ip?: string): Promise<{ suspended: number }> {
  const reason = ABUSE_REASONS.find((r) => r.id === input.reason);
  if (!reason) throw new ApiError(400, 'validation_error', L('Unbekannter Grund.', 'Unknown reason.'));
  const note = clean(input.note);
  if (reason.id === 'other' && !note.de) throw new ApiError(400, 'validation_error', L('Bitte einen eigenen Text angeben.', 'Please enter your own text.'));
  const [user] = await db.select().from(users).where(eq(users.email, input.email.trim().toLowerCase())).limit(1);
  if (!user) throw new ApiError(404, 'user_not_found', L('Zu dieser E-Mail-Adresse gibt es keinen Account.', 'There is no account for this email address.'));

  // Erst sperren, dann schreiben – so stimmt der Text der Mail
  let suspended = 0;
  if (input.suspend) {
    const active = await db.select({ id: servers.id }).from(servers).where(and(eq(servers.userId, user.id), inArray(servers.status, ['active', 'expiring'])));
    for (const s of active) {
      await serverAction(admin, s.id, 'suspend', ip).then(
        () => suspended++,
        () => {},
      );
    }
  }
  const part = (l: Locale) =>
    [
      reason.text[l],
      note[l],
      suspended > 0
        ? l === 'en'
          ? `We have suspended your ${suspended === 1 ? 'server' : 'servers'} for now.`
          : `Wir haben ${suspended === 1 ? 'deinen Server' : 'deine Server'} vorerst gesperrt.`
        : l === 'en'
          ? 'Please stop this immediately. In case of repeated violations we suspend or delete the server or the account.'
          : 'Bitte stelle das umgehend ab. Bei wiederholten Verstößen sperren oder löschen wir den Server bzw. den Account.',
      l === 'en' ? 'If you believe this is a mistake, please contact our support.' : 'Wenn du glaubst, dass ein Irrtum vorliegt, melde dich bitte bei unserem Support.',
    ]
      .filter(Boolean)
      .join('\n');
  await notify({ userId: user.id, type: `abuse.${reason.id}`, title: reason.title, body: part, dedupeKey: `abuse:${uuid()}`, email: true });
  await audit({ userId: user.id, actor: 'admin', action: 'admin.abuse_mail', message: `Abuse-Mail „${reason.label}“ an ${user.email}${suspended ? ` – ${suspended} Server gesperrt` : ''} (durch ${admin.email})`, ip });
  return { suspended };
}
