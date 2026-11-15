/**
 * Schlanker Client für die Discord-HTTP-API (ohne zusätzliche Bibliothek).
 * Hält sich an die Rate-Limits: wartet bei 429 und sobald ein Kontingent aufgebraucht ist.
 */
import { env } from '../env';

export class DiscordApiError extends Error {
  constructor(
    readonly status: number,
    /** Fehlercode von Discord, z. B. 10007 = Unknown Member, 50013 = Missing Permissions */
    readonly code: number | null,
    message: string,
  ) {
    super(message);
    this.name = 'DiscordApiError';
  }
}

export const DISCORD_CODES = { unknownChannel: 10003, unknownInvite: 10006, unknownMember: 10007, unknownRole: 10011, missingAccess: 50001, missingPermissions: 50013 } as const;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export interface DiscordRequest {
  /** Bot-Token (Authorization: Bot …) */
  botToken?: string;
  /** OAuth-Zugriffstoken eines Nutzers (Authorization: Bearer …) */
  bearer?: string;
  json?: unknown;
  form?: Record<string, string>;
  /** Erscheint im Audit-Log des Discord-Servers */
  reason?: string;
}

/** Führt eine Anfrage aus. 204 → null. Fehler → DiscordApiError. */
export async function discordRequest<T = unknown>(method: string, path: string, opts: DiscordRequest = {}): Promise<T> {
  const headers: Record<string, string> = { 'User-Agent': 'DiscordBot (https://craftinghosting.free, 1.0)' };
  if (opts.botToken) headers.Authorization = `Bot ${opts.botToken}`;
  else if (opts.bearer) headers.Authorization = `Bearer ${opts.bearer}`;
  if (opts.reason) headers['X-Audit-Log-Reason'] = encodeURIComponent(opts.reason.slice(0, 400));
  let body: string | undefined;
  if (opts.form) {
    headers['Content-Type'] = 'application/x-www-form-urlencoded';
    body = new URLSearchParams(opts.form).toString();
  } else if (opts.json !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(opts.json);
  }

  for (let attempt = 0; ; attempt++) {
    const res = await fetch(`${env.DISCORD_API_URL}${path}`, { method, headers, body, signal: AbortSignal.timeout(20_000) });
    if (res.status === 429 && attempt < 6) {
      const data = (await res.json().catch(() => ({}))) as { retry_after?: number };
      await sleep(Math.min(60_000, Math.ceil((data.retry_after ?? Number(res.headers.get('retry-after') ?? 1)) * 1000) + 100));
      continue;
    }
    // Kontingent dieser Route aufgebraucht → vor der nächsten Anfrage warten statt in ein 429 zu laufen
    if (res.headers.get('x-ratelimit-remaining') === '0') {
      const wait = Number(res.headers.get('x-ratelimit-reset-after') ?? 0);
      if (wait > 0) await sleep(Math.min(15_000, Math.ceil(wait * 1000)));
    }
    if (res.status === 204) return null as T;
    const text = await res.text();
    let data: unknown = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      /* keine JSON-Antwort */
    }
    if (!res.ok) {
      const d = (data ?? {}) as { code?: number; message?: string; error_description?: string; error?: string };
      throw new DiscordApiError(res.status, typeof d.code === 'number' ? d.code : null, d.message ?? d.error_description ?? d.error ?? `HTTP ${res.status}`);
    }
    return data as T;
  }
}

/** Fehlertext für Admin-Bereich und Bot-Antworten (ohne Token o. Ä.) */
export function discordErrorText(err: unknown): string {
  if (err instanceof DiscordApiError) {
    if (err.status === 401) return 'Discord lehnt das Bot-Token ab (401). Bitte Token prüfen.';
    if (err.code === DISCORD_CODES.missingPermissions || err.code === DISCORD_CODES.missingAccess || err.status === 403) {
      return `Dem Bot fehlt eine Berechtigung (${err.message}). Die Bot-Rolle braucht die nötigen Rechte und muss über den Rollen stehen, die sie vergibt.`;
    }
    return `Discord meldet: ${err.message} (${err.status}${err.code ? `, Code ${err.code}` : ''})`;
  }
  return err instanceof Error ? err.message : 'Unbekannter Fehler';
}

/* ------------------------------------------------------------------ Typen */

export interface DiscordUser {
  id: string;
  username: string;
  global_name?: string | null;
  discriminator?: string;
  avatar?: string | null;
  banner?: string | null;
  bot?: boolean;
}
export interface DiscordMember {
  user?: DiscordUser;
  roles: string[];
  joined_at?: string;
  permissions?: string;
}
export interface DiscordOverwrite {
  id: string;
  /** 0 = Rolle, 1 = Mitglied */
  type: 0 | 1;
  allow: string;
  deny: string;
}
export interface DiscordChannel {
  id: string;
  type: number;
  name?: string;
  position?: number;
  parent_id?: string | null;
  permission_overwrites?: DiscordOverwrite[];
}
export interface DiscordRole {
  id: string;
  name: string;
  position: number;
  permissions: string;
  managed?: boolean;
}
export interface DiscordGuild {
  id: string;
  name: string;
  icon?: string | null;
  owner_id: string;
  system_channel_id?: string | null;
  rules_channel_id?: string | null;
  approximate_member_count?: number;
  vanity_url_code?: string | null;
}
export interface DiscordInvite {
  code: string;
  uses?: number;
  inviter?: DiscordUser;
  channel?: { id: string } | null;
}

/** Berechtigungen (Bitfeld) */
export const PERM = {
  createInvite: 1n << 0n,
  administrator: 1n << 3n,
  manageChannels: 1n << 4n,
  manageGuild: 1n << 5n,
  viewChannel: 1n << 10n,
  sendMessages: 1n << 11n,
  embedLinks: 1n << 14n,
  attachFiles: 1n << 15n,
  readHistory: 1n << 16n,
  connect: 1n << 20n,
  manageRoles: 1n << 28n,
} as const;

export const hasPerm = (bits: string | undefined, perm: bigint) => {
  try {
    return (BigInt(bits ?? '0') & perm) === perm;
  } catch {
    return false;
  }
};

/** Kanalarten */
export const CHANNEL = { text: 0, voice: 2, category: 4, announcement: 5, stage: 13, forum: 15 } as const;

export const userDisplayName = (u: DiscordUser) => u.global_name || u.username;

export function avatarUrl(u: DiscordUser, size = 256): string {
  if (u.avatar) return `https://cdn.discordapp.com/avatars/${u.id}/${u.avatar}.${u.avatar.startsWith('a_') ? 'gif' : 'png'}?size=${size}`;
  // Standard-Avatar: bei neuen Benutzernamen aus der ID, sonst aus dem Diskriminator
  const index = u.discriminator && u.discriminator !== '0' ? Number(u.discriminator) % 5 : Number((BigInt(u.id) >> 22n) % 6n);
  return `https://cdn.discordapp.com/embed/avatars/${index}.png`;
}

export function bannerUrl(u: DiscordUser, size = 600): string | null {
  return u.banner ? `https://cdn.discordapp.com/banners/${u.id}/${u.banner}.${u.banner.startsWith('a_') ? 'gif' : 'png'}?size=${size}` : null;
}
