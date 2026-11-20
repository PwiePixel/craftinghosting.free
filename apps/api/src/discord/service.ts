/**
 * Discord-Anbindung, soweit sie ohne Dauerverbindung auskommt (läuft in API und Worker):
 * Konto verknüpfen (OAuth), Mitgliedschaft prüfen, Customer-Rolle, Einladungslink, Einrichtung.
 * Befehle, Buttons, Willkommensnachricht und Tickets stehen in bot.ts (braucht die Gateway-Verbindung).
 */
import { and, asc, eq, exists, inArray, isNotNull, isNull, lt, ne, or, sql } from 'drizzle-orm';
import { localePath, snowflakeDate, type AdminDiscordDTO, type DiscordSettings, type DiscordSetupStep, type Locale } from '@chfree/shared';
import { affectedRows, db, isUniqueViolation } from '../db/client';
import { servers, users, type User } from '../db/schema';
import { env } from '../env';
import { decryptField, encryptField, signToken, verifySignedToken } from '../lib/crypto';
import { audit } from '../services/audit.service';
import { getSettings, invalidatePublicSite } from '../services/settings.service';
import { buildCommands } from './commands';
import {
  CHANNEL,
  DISCORD_CODES,
  DiscordApiError,
  discordErrorText,
  discordRequest,
  userDisplayName,
  type DiscordChannel,
  type DiscordGuild,
  type DiscordInvite,
  type DiscordMember,
  type DiscordRequest,
  type DiscordUser,
} from './rest';
import { getDiscordSecrets, getDiscordState, patchDiscordState } from './store';
import { assertIdentityFree, isBannedIdentity } from '../services/sanction-gate';

/** Server in diesen Zuständen machen ihren Besitzer zum „Customer“ */
const CUSTOMER_STATUSES = ['provisioning', 'provisioning_failed', 'active', 'expiring', 'suspended'] as const;

export interface DiscordConfig {
  settings: DiscordSettings;
  botToken: string | null;
  clientSecret: string | null;
  /** Bot kann arbeiten: eingeschaltet, Token und Server-ID vorhanden */
  botReady: boolean;
  /** Verknüpfen ist möglich: zusätzlich Client-ID und Client-Secret vorhanden */
  linkReady: boolean;
}

export async function discordConfig(): Promise<DiscordConfig> {
  const [site, secrets] = await Promise.all([getSettings(), getDiscordSecrets()]);
  const s = site.discord;
  const botReady = s.enabled && !!secrets.botToken && !!s.guildId;
  return { settings: s, ...secrets, botReady, linkReady: botReady && !!s.clientId && !!secrets.clientSecret };
}

/** Anfrage mit dem Bot-Token */
export async function botRequest<T = unknown>(method: string, path: string, opts: Omit<DiscordRequest, 'botToken' | 'bearer'> = {}): Promise<T> {
  const { botToken } = await getDiscordSecrets();
  if (!botToken) throw new Error('Es ist kein Bot-Token hinterlegt.');
  return discordRequest<T>(method, path, { ...opts, botToken });
}

/* ------------------------------------------------------------ Verknüpfen (OAuth) */

const STATE_PURPOSE = 'discord-oauth';
const STATE_TTL_MS = 15 * 60_000;

export const discordRedirectUri = () => `${env.APP_URL}/api/v1/discord/callback`;

/**
 * Wer die Verbindung gestartet hat: ein angemeldeter Account (`chat` = aus dem Support-Chat heraus)
 * oder – ohne Anmeldung – eine Unterhaltung im Support-Chat.
 */
export type OAuthSubject =
  | { kind: 'user'; id: string; chat: boolean; back?: 'myServers' | 'account' }
  | { kind: 'chat'; id: string }
  /** Registrierung bzw. Anmeldung über Discord – `id` ist eine Zufallszahl, die an ein Cookie dieses Browsers gebunden ist */
  | { kind: 'signup'; id: string }
  | { kind: 'login'; id: string }
  /** Ein-Klick-Beitritt aus der E-Mail: nur für das Discord-Konto, das mit dem Account `id` schon verknüpft ist */
  | { kind: 'join'; id: string };

/** Adresse, auf der Discord nach der Zustimmung fragt. Der Zustand ist an den Account bzw. die Unterhaltung gebunden. */
export async function discordAuthorizeUrl(subject: OAuthSubject, lang: Locale): Promise<string | null> {
  const cfg = await discordConfig();
  if (!cfg.linkReady) return null;
  const kind = subject.kind === 'user' ? 'u' : subject.kind === 'chat' ? 'c' : subject.kind === 'signup' ? 's' : subject.kind === 'join' ? 'j' : 'l';
  // Letztes Feld: 1 = aus dem Chat, 2 = zurück zur Konto-Seite, 0 = zurück zu „Meine Server“
  const value = [kind, subject.id, Date.now() + STATE_TTL_MS, lang, subject.kind === 'user' && subject.chat ? 1 : subject.kind === 'user' && subject.back === 'account' ? 2 : 0].join(':');
  // Jede Verbindung – Registrierung, Anmeldung, Verknüpfen, Support-Chat – fügt das Konto unserem Discord-Server hinzu.
  // Bei der Anmeldung fragt Discord nur dann nach der Erlaubnis „Servern beitreten“, wenn sie noch nicht erteilt wurde.
  const join = true;
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: cfg.settings.clientId,
    // guilds.join: Der Bot darf das Konto dem Discord-Server hinzufügen – so ist Verknüpfen = Beitreten.
    // Aus dem Chat heraus immer, weil die Übergabe an das Team die Mitgliedschaft voraussetzt.
    scope: join ? 'identify guilds.join' : 'identify',
    redirect_uri: discordRedirectUri(),
    state: signToken(value, STATE_PURPOSE),
    // Bei der Anmeldung fragt Discord nicht jedes Mal erneut nach der Zustimmung (nur, wenn „Servern beitreten“ noch fehlt)
    prompt: subject.kind === 'login' ? 'none' : 'consent',
  });
  return `https://discord.com/oauth2/authorize?${params.toString()}`;
}

export type LinkResult = 'linked' | 'linked_not_member' | 'joined' | 'wrong_account' | 'state' | 'taken' | 'too_new' | 'bot_account' | 'unavailable' | 'failed' | 'email_taken' | 'locked' | 'no_account';

/** Sprache aus dem Zustand – auch wenn die Prüfung fehlschlägt, soll die Meldung in der richtigen Sprache kommen */
export function langFromState(state: string | undefined): Locale {
  return state?.split('.')[0]?.split(':')[3] === 'en' ? 'en' : 'de';
}

/** Prüft Signatur und Ablauf des Zustands. null = ungültig oder abgelaufen. */
export function parseDiscordState(state: string): (OAuthSubject & { lang: Locale }) | null {
  const [kind, id, expires, lang, chat] = verifySignedToken(state, STATE_PURPOSE)?.split(':') ?? [];
  if (!id || Number(expires) < Date.now()) return null;
  const locale: Locale = lang === 'en' ? 'en' : 'de';
  if (kind === 'u') return { kind: 'user', id, chat: chat === '1', back: chat === '2' ? 'account' : 'myServers', lang: locale };
  if (kind === 'c') return { kind: 'chat', id, lang: locale };
  if (kind === 's') return { kind: 'signup', id, lang: locale };
  if (kind === 'l') return { kind: 'login', id, lang: locale };
  if (kind === 'j') return { kind: 'join', id, lang: locale };
  return null;
}

type Exchange = { ok: true; discordUser: DiscordUser; member: boolean } | { ok: false; reason: 'too_new' | 'bot_account' | 'unavailable' | 'failed' };

/**
 * Löst den Code von Discord ein, prüft das Konto und lässt es – wenn erlaubt – dem Server beitreten.
 * Das Zugriffstoken wird nur dafür benutzt und nicht gespeichert.
 */
export async function exchangeDiscordCode(code: string, before?: (discordUser: DiscordUser) => Promise<LinkResult | null>): Promise<Exchange | { ok: false; reason: LinkResult }> {
  const cfg = await discordConfig();
  if (!cfg.linkReady) return { ok: false, reason: 'unavailable' };
  let discordUser: DiscordUser;
  let accessToken: string;
  let refreshToken: string | null;
  let scope: string;
  try {
    const token = await discordRequest<{ access_token: string; refresh_token?: string; scope?: string }>('POST', '/oauth2/token', {
      form: { client_id: cfg.settings.clientId, client_secret: cfg.clientSecret!, grant_type: 'authorization_code', code, redirect_uri: discordRedirectUri() },
    });
    accessToken = token.access_token;
    refreshToken = token.refresh_token ?? null;
    scope = token.scope ?? '';
    discordUser = await discordRequest<DiscordUser>('GET', '/users/@me', { bearer: accessToken });
  } catch {
    return { ok: false, reason: 'failed' };
  }
  if (discordUser.bot) return { ok: false, reason: 'bot_account' };
  // Frisch angelegte Konten sind das typische Werkzeug für Mehrfach-Anmeldungen
  if (cfg.settings.minAccountAgeDays > 0 && Date.now() - snowflakeDate(discordUser.id).getTime() < cfg.settings.minAccountAgeDays * 86_400_000) return { ok: false, reason: 'too_new' };
  // Schritt des Aufrufers (z. B. im Account speichern) – bricht ab, wenn das Konto schon vergeben ist
  const stop = await before?.(discordUser);
  if (stop) return { ok: false, reason: stop };

  // Dem Server beitreten lassen (201 = hinzugefügt, 204 = war schon Mitglied)
  let member = false;
  let retry = false;
  let banned = false;
  if (scope.split(' ').includes('guilds.join')) {
    const added = await addToGuild(discordUser.id, accessToken, cfg);
    member = added.ok;
    // Klappt es gerade nicht (z. B. fehlt dem Bot eine Berechtigung), versucht es der Job discord-join später erneut
    retry = !added.ok && !added.permanent;
    banned = !added.ok && !!added.banned;
  }
  if (!member) member = (await fetchDiscordMember(discordUser.id).catch(() => null)) !== null;
  await rememberJoinState(discordUser.id, member, retry ? refreshToken : null, banned);
  return { ok: true, discordUser, member };
}

/** Zweiter Schritt der Verknüpfung mit einem Account: Code einlösen, Konto prüfen, speichern, dem Server beitreten lassen */
export async function linkDiscordAccount(user: User, code: string, ip?: string): Promise<LinkResult> {
  const result = await exchangeDiscordCode(code, async (discordUser) => {
    const [other] = await db.select({ id: users.id }).from(users).where(and(eq(users.discordId, discordUser.id), ne(users.id, user.id))).limit(1);
    if (other) return 'taken';
    // Ein gebanntes Discord-Konto lässt sich mit keinem (neuen) Konto verknüpfen
    if (await isBannedIdentity({ discordId: discordUser.id })) return 'locked';
    // Verwarnungs-System: Ein anderes Discord-Konto verknüpfen geht nicht, solange eine Verwarnung oder Abuse-Meldung besteht
    if (user.discordId && user.discordId !== discordUser.id && (await assertIdentityFree(user).then(() => false, () => true))) return 'locked';
    try {
      await db
        .update(users)
        .set({ discordId: discordUser.id, discordUsername: discordUser.username.slice(0, 64), discordLinkedAt: new Date(), discordCustomerRole: false, discordSyncAt: null })
        .where(eq(users.id, user.id));
    } catch (err) {
      if (isUniqueViolation(err)) return 'taken';
      throw err;
    }
    await audit({ userId: user.id, actor: 'user', action: 'discord.linked', message: `Discord-Konto ${userDisplayName(discordUser)} (${discordUser.id}) verknüpft`, ip });
    return null;
  });
  if (!result.ok) return result.reason;
  return result.member ? 'linked' : 'linked_not_member';
}

/* ------------------------------------------------------------ Ein-Klick-Beitritt per E-Mail */

const JOIN_LINK_PURPOSE = 'discord-join-link';
const JOIN_LINK_TTL_MS = 30 * 86_400_000;

/**
 * Link für die E-Mail an Konten, die verknüpft, aber nicht auf unserem Server sind (z. B. vor dem automatischen Beitritt
 * verknüpft): Ein Klick führt ohne Anmeldung zu Discord, die Zustimmung „Servern beitreten“ genügt. Der Link taugt nur
 * für das Discord-Konto, das schon mit dem Account verknüpft ist – er kann keine neue Verknüpfung anlegen.
 */
export function discordJoinLink(userId: string, lang: Locale): string {
  const token = signToken(`${userId}:${Date.now() + JOIN_LINK_TTL_MS}`, JOIN_LINK_PURPOSE);
  return `${env.APP_URL}/api/v1/discord/join?t=${encodeURIComponent(token)}&lang=${lang}`;
}

/** Account-ID aus einem Beitrittslink (null = ungültig oder abgelaufen) */
export function parseDiscordJoinLink(token: string): string | null {
  const [userId, expires] = verifySignedToken(token, JOIN_LINK_PURPOSE)?.split(':') ?? [];
  return userId && Number(expires) > Date.now() ? userId : null;
}

/** Rückweg des Ein-Klick-Beitritts: Code einlösen, prüfen, dass es das verknüpfte Discord-Konto ist, beitreten lassen */
export async function joinWithExistingLink(userId: string, code: string): Promise<{ result: LinkResult; user: User | null }> {
  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!user || user.status !== 'active') return { result: 'locked', user: null };
  if (!user.discordId) return { result: 'state', user };
  const result = await exchangeDiscordCode(code, async (discordUser) => (discordUser.id === user.discordId ? null : 'wrong_account'));
  if (!result.ok) return { result: result.reason, user };
  if (result.member) await audit({ userId: user.id, actor: 'user', action: 'discord.joined', message: 'Über den Beitrittslink dem Discord-Server beigetreten' });
  return { result: result.member ? 'joined' : 'linked_not_member', user };
}

/**
 * Verbindung aus dem Support-Chat ohne Website-Account: Das Discord-Konto wird nicht mit einem Account verknüpft,
 * sondern nur für die Übergabe an das Team festgestellt (und dem Server hinzugefügt).
 */
export async function connectDiscordForChat(code: string): Promise<{ ok: true; discordUser: DiscordUser; member: boolean } | { ok: false; reason: LinkResult }> {
  return exchangeDiscordCode(code);
}

/** Löst die Verknüpfung (und nimmt die Customer-Rolle). */
export async function unlinkDiscordAccount(user: User, ip?: string): Promise<void> {
  if (!user.discordId) return;
  const cfg = await discordConfig();
  if (cfg.botReady && cfg.settings.customerRoleId) {
    await botRequest('DELETE', `/guilds/${cfg.settings.guildId}/members/${user.discordId}/roles/${cfg.settings.customerRoleId}`, { reason: 'Verknüpfung gelöst' }).catch(() => {});
  }
  await db
    .update(users)
    .set({ discordId: null, discordUsername: null, discordLinkedAt: null, discordCustomerRole: false, discordSyncAt: null, discordJoinToken: null, discordJoinedAt: null, discordJoinCheckedAt: null, discordJoinBlockedAt: null })
    .where(eq(users.id, user.id));
  await audit({ userId: user.id, actor: 'user', action: 'discord.unlinked', message: 'Discord-Verknüpfung gelöst', ip });
}

/** Vor dem Löschen eines Accounts: Customer-Rolle auf dem Discord-Server entfernen (ohne Fehler, wenn Discord nicht erreichbar ist) */
export async function releaseDiscordFor(userId: string): Promise<void> {
  const [row] = await db.select({ discordId: users.discordId }).from(users).where(eq(users.id, userId)).limit(1);
  const cfg = await discordConfig();
  if (!row?.discordId || !cfg.botReady || !cfg.settings.customerRoleId) return;
  await botRequest('DELETE', `/guilds/${cfg.settings.guildId}/members/${row.discordId}/roles/${cfg.settings.customerRoleId}`, { reason: 'Account gelöscht' }).catch(() => {});
}

/* ------------------------------------------------------------ Automatischer Beitritt */

type JoinResult = { ok: true } | { ok: false; reason: string; /** Neuer Versuch zwecklos (gebannt, Token ungültig) */ permanent: boolean; banned?: boolean };

/** Text für den Admin-Bereich, wenn das Hinzufügen scheitert */
function joinErrorText(err: unknown): string {
  if (err instanceof DiscordApiError && (err.code === DISCORD_CODES.missingPermissions || err.code === DISCORD_CODES.missingAccess || err.status === 403)) {
    return `Dem Bot fehlt die Berechtigung „Einladung erstellen“ (${err.message}). Discord verlangt sie, damit der Bot Mitglieder hinzufügen darf – in den Servereinstellungen der Rolle des Bots geben.`;
  }
  return discordErrorText(err);
}

/**
 * Fügt ein Discord-Konto mit seinem Zugriffstoken (Berechtigung „Servern beitreten“) unserem Server hinzu.
 * Fehler, die am Bot liegen, landen im Admin-Bereich (Discord → „Automatischer Beitritt“).
 */
async function addToGuild(discordId: string, accessToken: string, cfg: DiscordConfig): Promise<JoinResult> {
  try {
    await botRequest('PUT', `/guilds/${cfg.settings.guildId}/members/${discordId}`, { json: { access_token: accessToken } });
    const state = await getDiscordState();
    if (state.joinError) await patchDiscordState({ joinError: null }).catch(() => {});
    return { ok: true };
  } catch (err) {
    // Am Konto selbst: auf unserem Server gebannt (40007), Token ungültig/zurückgezogen (50025), schon auf 100 Servern (30001)
    const code = err instanceof DiscordApiError ? err.code : null;
    if (code === 40007) return { ok: false, reason: 'Das Discord-Konto ist auf unserem Server gebannt.', permanent: true, banned: true };
    // Nur 50025 betrifft das Token des Nutzers – ein 401 heißt hier: Discord lehnt das Bot-Token ab (Fehler beim Bot, neuer Versuch)
    if (code === 50025) return { ok: false, reason: 'Discord hat den Zugriff zurückgezogen.', permanent: true };
    if (code === 30001) return { ok: false, reason: 'Das Discord-Konto ist schon auf der Höchstzahl an Servern.', permanent: false };
    const reason = joinErrorText(err);
    console.warn(`[discord] Konto ${discordId} konnte nicht hinzugefügt werden: ${reason}`);
    await patchDiscordState({ joinError: { at: new Date().toISOString(), message: reason } }).catch(() => {});
    return { ok: false, reason, permanent: false };
  }
}

/**
 * Stand des Beitritts nach einer Verbindung über Discord merken. Das Refresh-Token bleibt nur gespeichert, solange
 * der Beitritt noch aussteht (für neue Versuche des Jobs discord-join) – danach wird es gelöscht.
 */
async function rememberJoinState(discordId: string, member: boolean, refreshToken: string | null, banned = false): Promise<void> {
  const now = new Date();
  await db
    .update(users)
    .set(
      member
        ? { discordJoinedAt: now, discordJoinToken: null, discordJoinCheckedAt: now, discordJoinBlockedAt: null }
        : { discordJoinedAt: null, discordJoinToken: refreshToken ? encryptField(refreshToken) : null, discordJoinCheckedAt: now, ...(banned ? { discordJoinBlockedAt: now } : {}) },
    )
    .where(eq(users.discordId, discordId));
}

/** Neues Zugriffstoken über das Refresh-Token (Discord tauscht dabei auch das Refresh-Token aus) */
async function refreshDiscordGrant(refreshToken: string, cfg: DiscordConfig): Promise<{ accessToken: string; refreshToken: string | null; scope: string } | 'revoked' | 'failed'> {
  try {
    const t = await discordRequest<{ access_token: string; refresh_token?: string; scope?: string }>('POST', '/oauth2/token', {
      form: { client_id: cfg.settings.clientId, client_secret: cfg.clientSecret!, grant_type: 'refresh_token', refresh_token: refreshToken },
    });
    return { accessToken: t.access_token, refreshToken: t.refresh_token ?? null, scope: t.scope ?? '' };
  } catch (err) {
    // 400 invalid_grant: Erlaubnis zurückgezogen oder Token abgelaufen. 401 invalid_client (falsches Client-Secret) liegt
    // bei uns – das Token bleibt dann für einen neuen Versuch erhalten.
    return err instanceof DiscordApiError && err.status === 400 ? 'revoked' : 'failed';
  }
}

/**
 * Job discord-join: Verknüpfte Konten, die (noch) nicht auf unserem Server sind, automatisch hinzufügen.
 *  – Schon Mitglied → gemerkt, nichts weiter.
 *  – Beitritt steht aus und die Erlaubnis liegt vor → mit dem Refresh-Token hinzufügen (neuer Versuch alle 30 Minuten).
 *  – Ohne Erlaubnis (Konto vor dieser Funktion oder ohne „Servern beitreten“ verknüpft) → „muss einmal neu verbinden“.
 *    Diese Konten prüft der Job alle 12 Stunden erneut (vielleicht sind sie inzwischen selbst beigetreten).
 * Wer den Server später selbst verlässt, wird nicht wieder hinzugefügt – erst bei der nächsten Verbindung über Discord.
 */
export async function runDiscordAutoJoin(
  now = new Date(),
  limit = 100,
  /** Für jedes Konto, das jetzt (wieder) auf dem Server ist – z. B. um wartende Server sofort zu erstellen */
  onMember?: (userId: string) => Promise<void>,
): Promise<{ checked: number; members: number; joined: number; failed: number; needsRelink: number }> {
  const out = { checked: 0, members: 0, joined: 0, failed: 0, needsRelink: 0 };
  const cfg = await discordConfig();
  if (!cfg.botReady || !cfg.linkReady) return out;
  const retryWithToken = new Date(now.getTime() - 30 * 60_000);
  const recheck = new Date(now.getTime() - 12 * 3_600_000);
  const rows = await db
    .select({ id: users.id, discordId: users.discordId, token: users.discordJoinToken, checkedAt: users.discordJoinCheckedAt })
    .from(users)
    .where(
      and(
        isNotNull(users.discordId),
        eq(users.status, 'active'),
        isNull(users.discordJoinedAt),
        isNull(users.discordJoinBlockedAt),
        or(isNull(users.discordJoinCheckedAt), and(isNotNull(users.discordJoinToken), lt(users.discordJoinCheckedAt, retryWithToken)), lt(users.discordJoinCheckedAt, recheck)),
      ),
    )
    .orderBy(asc(users.discordJoinCheckedAt))
    .limit(limit);
  for (const row of rows) {
    const discordId = row.discordId!;
    // Nur ändern, solange das Konto noch mit demselben Discord-Konto verknüpft ist
    const same = and(eq(users.id, row.id), eq(users.discordId, discordId));
    // Zeile beanspruchen: Läuft gleichzeitig ein zweiter Durchgang (Job und „Jetzt prüfen“, API und Worker), bearbeitet
    // nur einer das Konto – sonst verbrauchten beide dasselbe Refresh-Token (Discord tauscht es bei jeder Nutzung aus)
    const claimedAt = new Date();
    const claim = await db
      .update(users)
      .set({ discordJoinCheckedAt: claimedAt })
      .where(
        and(
          same,
          isNull(users.discordJoinedAt),
          row.checkedAt ? eq(users.discordJoinCheckedAt, row.checkedAt) : isNull(users.discordJoinCheckedAt),
          row.token ? eq(users.discordJoinToken, row.token) : isNull(users.discordJoinToken),
        ),
      );
    if (affectedRows(claim) !== 1) continue;
    out.checked++;
    // Alle weiteren Änderungen nur, solange niemand anderes das Konto inzwischen bearbeitet hat
    const mine = and(same, eq(users.discordJoinCheckedAt, claimedAt));
    let member: boolean;
    try {
      member = (await fetchDiscordMember(discordId)) !== null;
    } catch {
      // Mitgliedschaft unbekannt (Discord gestört): alten Stand wiederherstellen – das Konto gilt weiter als „noch nicht
      // geprüft“ bzw. bleibt, wie es war, und landet nicht fälschlich bei „muss einmal klicken“
      out.failed++;
      await db.update(users).set({ discordJoinCheckedAt: row.checkedAt }).where(mine);
      continue;
    }
    if (member) {
      out.members++;
      await db.update(users).set({ discordJoinedAt: new Date(), discordJoinToken: null }).where(mine);
      await onMember?.(row.id).catch(() => {});
      continue;
    }
    const stored = row.token ? decryptField(row.token) : null;
    if (!stored) {
      out.needsRelink++;
      continue;
    }
    const grant = await refreshDiscordGrant(stored, cfg);
    if (grant === 'failed') {
      out.failed++;
      continue;
    }
    if (grant === 'revoked' || !grant.scope.split(' ').includes('guilds.join')) {
      out.needsRelink++;
      await db.update(users).set({ discordJoinToken: null }).where(and(mine, eq(users.discordJoinToken, row.token!)));
      continue;
    }
    // Das alte Refresh-Token ist jetzt verbraucht – das neue sofort sichern, bevor das Hinzufügen versucht wird
    const fresh = grant.refreshToken ? encryptField(grant.refreshToken) : null;
    await db.update(users).set({ discordJoinToken: fresh }).where(and(mine, eq(users.discordJoinToken, row.token!)));
    const added = await addToGuild(discordId, grant.accessToken, cfg);
    if (added.ok) {
      out.joined++;
      await db.update(users).set({ discordJoinedAt: new Date(), discordJoinToken: null }).where(mine);
      await audit({ userId: row.id, actor: 'system', action: 'discord.auto_joined', message: 'Automatisch dem Discord-Server hinzugefügt' });
      await onMember?.(row.id).catch(() => {});
    } else {
      out.failed++;
      if (added.permanent) {
        out.needsRelink += added.banned ? 0 : 1;
        await db
          .update(users)
          .set({ discordJoinToken: null, ...(added.banned ? { discordJoinBlockedAt: new Date() } : {}) })
          .where(mine);
      }
    }
  }
  return out;
}

/** Überblick für den Admin-Bereich */
export async function discordJoinStats(): Promise<AdminDiscordDTO['join']> {
  const [row] = await db
    .select({
      members: sql<number>`sum(case when ${users.discordJoinedAt} is not null then 1 else 0 end)`,
      pending: sql<number>`sum(case when ${users.discordJoinedAt} is null and ${users.discordJoinToken} is not null then 1 else 0 end)`,
      needsRelink: sql<number>`sum(case when ${users.discordJoinedAt} is null and ${users.discordJoinToken} is null and ${users.discordJoinCheckedAt} is not null and ${users.discordJoinBlockedAt} is null then 1 else 0 end)`,
      unchecked: sql<number>`sum(case when ${users.discordJoinCheckedAt} is null and ${users.discordJoinedAt} is null then 1 else 0 end)`,
    })
    .from(users)
    .where(and(isNotNull(users.discordId), eq(users.status, 'active')));
  const state = await getDiscordState();
  return {
    members: Number(row?.members ?? 0),
    pending: Number(row?.pending ?? 0),
    needsRelink: Number(row?.needsRelink ?? 0),
    unchecked: Number(row?.unchecked ?? 0),
    error: state.joinError,
  };
}

/* ------------------------------------------------------------ Mitgliedschaft */

/** Mitglied des Discord-Servers (null = kein Mitglied) */
export async function fetchDiscordMember(discordId: string): Promise<DiscordMember | null> {
  const { settings } = await discordConfig();
  try {
    return await botRequest<DiscordMember>('GET', `/guilds/${settings.guildId}/members/${discordId}`);
  } catch (err) {
    if (err instanceof DiscordApiError && (err.status === 404 || err.code === DISCORD_CODES.unknownMember)) return null;
    throw err;
  }
}

const memberCache = new Map<string, { at: number; member: boolean }>();

export type DiscordGate = { ok: true } | { ok: false; reason: 'not_linked' | 'not_member' | 'unavailable' };

/**
 * Darf dieser Account kostenlose Server bekommen? Gilt nur, wenn die Pflicht eingeschaltet UND die Anbindung
 * vollständig eingerichtet ist – eine halb eingerichtete Anbindung sperrt niemanden aus.
 */
export async function discordGate(user: Pick<User, 'discordId'>, opts: { cached?: boolean } = {}): Promise<DiscordGate> {
  const cfg = await discordConfig();
  if (!cfg.settings.required || !cfg.linkReady) return { ok: true };
  if (!user.discordId) return { ok: false, reason: 'not_linked' };
  // Nur für die Anzeige („Meine Server“ lädt sich während der Einrichtung alle paar Sekunden neu):
  // ein bis zu 60 Sekunden alter Stand genügt und schont das Anfrage-Kontingent bei Discord
  const known = memberCache.get(user.discordId);
  if (opts.cached && known && Date.now() - known.at < 60_000) return known.member ? { ok: true } : { ok: false, reason: 'not_member' };
  try {
    const member = (await fetchDiscordMember(user.discordId)) !== null;
    if (memberCache.size > 5000) memberCache.clear();
    memberCache.set(user.discordId, { at: Date.now(), member });
    return member ? { ok: true } : { ok: false, reason: 'not_member' };
  } catch {
    // Discord nicht erreichbar: lieber kurz warten lassen als die Prüfung zu umgehen
    return { ok: false, reason: 'unavailable' };
  }
}

/* ------------------------------------------------------------ Customer-Rolle */

const hasServer = (userId: typeof users.id) =>
  exists(
    db
      .select({ one: sql`1` })
      .from(servers)
      .where(and(eq(servers.userId, userId), inArray(servers.status, [...CUSTOMER_STATUSES]))),
  );

/** Setzt bzw. entfernt die Customer-Rolle für einen Account. @returns true, wenn Discord die Änderung bestätigt hat */
async function applyCustomerRole(user: Pick<User, 'id' | 'discordId'>, desired: boolean, cfg: DiscordConfig): Promise<boolean> {
  if (!user.discordId) return false;
  const path = `/guilds/${cfg.settings.guildId}/members/${user.discordId}/roles/${cfg.settings.customerRoleId}`;
  let applied = desired;
  let ok = true;
  try {
    await botRequest(desired ? 'PUT' : 'DELETE', path, { reason: desired ? 'Hat einen Server bei CraftingHosting.free' : 'Hat keinen Server mehr' });
  } catch (err) {
    if (err instanceof DiscordApiError && err.code === DISCORD_CODES.unknownMember) applied = false; // nicht (mehr) auf dem Server – keine Rolle
    else {
      ok = false;
      // Sichtbar machen, warum es nicht klappt (häufig: Bot-Rolle steht unter der Customer-Rolle) – im Protokoll und im Admin-Bereich
      const reason = discordErrorText(err);
      console.warn(`[discord] Customer-Rolle konnte nicht ${desired ? 'vergeben' : 'entfernt'} werden: ${reason}`);
      await patchDiscordState({ roleError: { at: new Date().toISOString(), message: reason } }).catch(() => {});
    }
  }
  // discordSyncAt merkt nur FEHLVERSUCHE (nächster Versuch frühestens nach 30 Minuten). Nach einem Erfolg wird es geleert,
  // damit eine spätere Änderung – z. B. der erste Server nach dem Verknüpfen – beim nächsten Abgleich sofort greift.
  await db
    .update(users)
    .set(ok ? { discordCustomerRole: applied, discordSyncAt: null } : { discordSyncAt: new Date() })
    .where(eq(users.id, user.id));
  if (ok && desired) await clearRoleError();
  return ok;
}

/** Letzten Fehler der Rollenvergabe vergessen, sobald sie wieder klappt */
async function clearRoleError(): Promise<void> {
  const state = await getDiscordState();
  if (state.roleError) await patchDiscordState({ roleError: null }).catch(() => {});
}

/** Customer-Rolle eines Accounts sofort abgleichen (nach Verknüpfung, Server-Erstellung, Löschung) */
export async function syncCustomerRole(userId: string): Promise<void> {
  const cfg = await discordConfig();
  if (!cfg.botReady || !cfg.settings.customerRoleId) return;
  const [row] = await db.select({ id: users.id, discordId: users.discordId, desired: sql<number>`${hasServer(users.id)}` }).from(users).where(eq(users.id, userId)).limit(1);
  if (row?.discordId) await applyCustomerRole(row, !!row.desired, cfg);
}

/** Wie syncCustomerRole, aber ohne zu warten und ohne Fehler nach außen – für Stellen, an denen ein Server entsteht oder verschwindet */
export function syncCustomerRoleSoon(userId: string): void {
  void syncCustomerRole(userId).catch((err) => console.warn(`[discord] Abgleich der Customer-Rolle fehlgeschlagen: ${discordErrorText(err)}`));
}

/**
 * Abgleich für alle: Wer einen Server hat, bekommt die Rolle; wer keinen mehr hat, verliert sie.
 * Normal werden nur Abweichungen bearbeitet (fehlgeschlagene Versuche frühestens nach 30 Minuten erneut).
 */
export async function syncCustomerRoles(opts: { all?: boolean; limit?: number } = {}): Promise<{ checked: number; failed: number }> {
  const cfg = await discordConfig();
  if (!cfg.botReady || !cfg.settings.customerRoleId) return { checked: 0, failed: 0 };
  const desired = sql<number>`${hasServer(users.id)}`;
  const retryBefore = new Date(Date.now() - 30 * 60_000);
  const rows = await db
    .select({ id: users.id, discordId: users.discordId, desired })
    .from(users)
    .where(
      opts.all
        ? isNotNull(users.discordId)
        : and(isNotNull(users.discordId), sql`${hasServer(users.id)} != ${users.discordCustomerRole}`, or(isNull(users.discordSyncAt), lt(users.discordSyncAt, retryBefore))),
    )
    .limit(opts.limit ?? 40);
  let failed = 0;
  for (const row of rows) if (!(await applyCustomerRole(row, !!row.desired, cfg))) failed++;
  return { checked: rows.length, failed };
}

/* ------------------------------------------------------------ Einladungslink */

export const inviteUrlOf = (code: string | null) => (code ? `https://discord.gg/${code}` : null);

/** Kanal für die Einladung: Admin-Einstellung → Systemkanal → Regelkanal → erster Textkanal */
async function pickInviteChannel(settings: DiscordSettings): Promise<string | null> {
  if (settings.inviteChannelId) return settings.inviteChannelId;
  const guild = await botRequest<DiscordGuild>('GET', `/guilds/${settings.guildId}`);
  if (guild.system_channel_id) return guild.system_channel_id;
  if (guild.rules_channel_id) return guild.rules_channel_id;
  const channels = await botRequest<DiscordChannel[]>('GET', `/guilds/${settings.guildId}/channels`);
  return channels.filter((c) => c.type === CHANNEL.text).sort((a, b) => (a.position ?? 0) - (b.position ?? 0))[0]?.id ?? null;
}

/**
 * Sorgt dafür, dass es eine dauerhafte Einladung gibt, die der Bot erstellt hat – die Website verwendet sie überall
 * als Discord-Link. Eine gelöschte Einladung wird ersetzt.
 */
export async function ensureDiscordInvite(force = false): Promise<string | null> {
  const cfg = await discordConfig();
  if (!cfg.botReady) return null;
  const state = await getDiscordState(true);
  const channelWanted = cfg.settings.inviteChannelId || state.inviteChannelId;
  if (state.inviteCode && !force && (!cfg.settings.inviteChannelId || cfg.settings.inviteChannelId === state.inviteChannelId)) {
    try {
      await botRequest<DiscordInvite>('GET', `/invites/${state.inviteCode}`);
      await patchDiscordState({ inviteCheckedAt: new Date().toISOString() });
      return inviteUrlOf(state.inviteCode);
    } catch (err) {
      if (!(err instanceof DiscordApiError) || err.status !== 404) return inviteUrlOf(state.inviteCode); // Discord gerade nicht erreichbar – Link behalten
    }
  }
  const channelId = (await pickInviteChannel(cfg.settings)) ?? channelWanted;
  if (!channelId) throw new Error('Auf dem Discord-Server wurde kein Textkanal für die Einladung gefunden.');
  const invite = await botRequest<DiscordInvite>('POST', `/channels/${channelId}/invites`, {
    json: { max_age: 0, max_uses: 0, temporary: false, unique: false },
    reason: 'Einladungslink für die Website',
  });
  await patchDiscordState({ inviteCode: invite.code, inviteChannelId: channelId, inviteCheckedAt: new Date().toISOString() });
  invalidatePublicSite();
  return inviteUrlOf(invite.code);
}

/* ------------------------------------------------------------ Einrichtung */

export type SetupStep = DiscordSetupStep;

/** Berechtigungen, mit denen der Bot eingeladen wird: Administrator (nötig, damit /wartung alle Kanäle sperren und wieder freigeben kann) */
export const botInviteUrl = (clientId: string) => `https://discord.com/oauth2/authorize?client_id=${clientId}&scope=bot%20applications.commands&permissions=8`;

/** Prüft Token und Server, registriert die Befehle und erstellt den Einladungslink. Jeder Schritt meldet sein Ergebnis. */
export async function setupDiscord(): Promise<SetupStep[]> {
  const steps: SetupStep[] = [];
  const cfg = await discordConfig();
  const add = (name: string, ok: boolean, detail: string) => void steps.push({ name, ok, detail });
  if (!cfg.settings.enabled) add('Anbindung', false, 'Die Discord-Anbindung ist ausgeschaltet.');
  if (!cfg.botToken) add('Bot-Token', false, 'Es ist kein Bot-Token hinterlegt.');
  if (!cfg.settings.guildId) add('Server-ID', false, 'Die ID des Discord-Servers fehlt.');
  if (steps.length) return steps;

  let botUser: DiscordUser;
  try {
    botUser = await botRequest<DiscordUser>('GET', '/users/@me');
    add('Bot-Token', true, `Angemeldet als ${botUser.username}`);
  } catch (err) {
    add('Bot-Token', false, discordErrorText(err));
    return steps;
  }
  if (cfg.settings.clientId && cfg.settings.clientId !== botUser.id) {
    add('Client-ID', false, `Die Client-ID gehört nicht zu diesem Bot (erwartet: ${botUser.id}).`);
  }

  let guild: DiscordGuild | null = null;
  try {
    guild = await botRequest<DiscordGuild>('GET', `/guilds/${cfg.settings.guildId}?with_counts=true`);
    add('Discord-Server', true, `${guild.name}${guild.approximate_member_count ? ` · ca. ${guild.approximate_member_count} Mitglieder` : ''}`);
  } catch (err) {
    add('Discord-Server', false, `Der Bot ist nicht auf diesem Server oder die Server-ID stimmt nicht. ${discordErrorText(err)}`);
    return steps;
  }
  await patchDiscordState({
    bot: { id: botUser.id, username: botUser.username, avatar: botUser.avatar ?? null },
    guild: { name: guild.name, icon: guild.icon ?? null, memberCount: guild.approximate_member_count ?? null },
    setupAt: new Date().toISOString(),
  });

  try {
    const commands = buildCommands(cfg.settings);
    await botRequest('PUT', `/applications/${botUser.id}/guilds/${cfg.settings.guildId}/commands`, { json: commands });
    await patchDiscordState({ commandsAt: new Date().toISOString() });
    add('Befehle', true, commands.map((c) => `/${c.name}`).join(' '));
  } catch (err) {
    add('Befehle', false, `${discordErrorText(err)} – der Bot muss mit „applications.commands“ eingeladen sein.`);
  }

  try {
    const url = await ensureDiscordInvite();
    add('Einladungslink', !!url, url ?? 'Es konnte kein Einladungslink erstellt werden.');
  } catch (err) {
    add('Einladungslink', false, discordErrorText(err));
  }

  // Rollen prüfen: vorhanden und unterhalb der Bot-Rolle?
  const wanted: [string, string][] = [
    ['Customer-Rolle', cfg.settings.customerRoleId],
    ['Support-Rolle', cfg.settings.supportRoleId],
    ...cfg.settings.autoRoleIds.map((id, i): [string, string] => [`Auto-Rolle ${i + 1}`, id]),
    ...cfg.settings.rolePanels.flatMap((p) => p.buttons.filter((b) => b.roleId).map((b): [string, string] => [`Rollen-Panel „${p.title}“ · ${b.label}`, b.roleId])),
  ];
  if (wanted.some(([, id]) => id)) {
    try {
      const [roles, me] = await Promise.all([
        botRequest<{ id: string; name: string; position: number; managed?: boolean }[]>('GET', `/guilds/${cfg.settings.guildId}/roles`),
        botRequest<DiscordMember>('GET', `/guilds/${cfg.settings.guildId}/members/${botUser.id}`),
      ]);
      const top = Math.max(0, ...roles.filter((r) => me.roles.includes(r.id)).map((r) => r.position));
      for (const [label, id] of wanted) {
        if (!id) continue;
        const role = roles.find((r) => r.id === id);
        if (!role) add(label, false, `Rolle ${id} gibt es auf dem Server nicht.`);
        else if (label !== 'Support-Rolle' && role.position >= top) add(label, false, `„${role.name}“ steht über der Bot-Rolle – der Bot kann sie nicht vergeben. Bot-Rolle in den Servereinstellungen nach oben ziehen.`);
        else add(label, true, role.name);
      }
    } catch (err) {
      add('Rollen', false, discordErrorText(err));
    }
  }
  return steps;
}

/** Übersicht für den Admin-Bereich (ohne Geheimnisse) */
export async function discordAdminStatus(): Promise<AdminDiscordDTO> {
  const [cfg, state] = await Promise.all([discordConfig(), getDiscordState(true)]);
  const [linked] = await db.select({ n: sql<number>`count(*)` }).from(users).where(isNotNull(users.discordId));
  return {
    hasBotToken: !!cfg.botToken,
    hasClientSecret: !!cfg.clientSecret,
    botReady: cfg.botReady,
    linkReady: cfg.linkReady,
    redirectUri: discordRedirectUri(),
    botInviteUrl: cfg.settings.clientId ? botInviteUrl(cfg.settings.clientId) : null,
    inviteUrl: inviteUrlOf(state.inviteCode),
    bot: state.bot,
    guild: state.guild,
    commandsAt: state.commandsAt,
    setupAt: state.setupAt,
    gateway: state.gateway,
    roleError: state.roleError,
    join: await discordJoinStats(),
    statusFeedError: state.statusFeedError,
    honeypotError: state.honeypotError,
    linkedUsers: Number(linked?.n ?? 0),
  };
}

/** Adresse, auf die nach dem Verknüpfen zurückgeleitet wird */
export const afterLinkUrl = (lang: Locale, result: string, back: 'myServers' | 'account' = 'myServers') => `${env.APP_URL}${localePath(lang, back)}?discord=${result}`;
