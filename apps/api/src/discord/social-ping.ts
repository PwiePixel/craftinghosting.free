/**
 * Social Ping: Der Bot meldet neue Videos hinterlegter Konten in einem Discord-Kanal
 * (Admin → Discord → Social Ping).
 *
 * Unterstützt werden YouTube-Kanäle (Link auf den Kanal, z. B. youtube.com/@name – der Bot ermittelt daraus den
 * öffentlichen Feed des Kanals, ein API-Schlüssel ist nicht nötig) und beliebige RSS-/Atom-Feeds.
 * Beim ersten Abruf eines Kontos merkt sich der Bot nur die vorhandenen Videos; gepostet wird alles, was danach
 * neu erscheint. Der Link steht als Text in der Nachricht, damit Discord die Vorschau mit Player anzeigt.
 */
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import type { AdminSocialDTO, SocialAccount, SocialPingSettings } from '@chfree/shared';
import { db } from '../db/client';
import { settings as settingsTable } from '../db/schema';
import { env } from '../env';
import { acquireLease, releaseLease } from '../jobs/lock';
import { discordErrorText } from './rest';
import { botRequest, discordConfig } from './service';

const STATE_KEY = 'discord-social';
const LEASE = 'discord-social-check';
const OWNER = randomUUID();
/** Höchstens so viele neue Videos je Konto und Lauf – verhindert eine Flut, falls ein Feed viele Einträge auf einmal bringt */
const MAX_POSTS_PER_RUN = 3;

export interface FeedEntry {
  id: string;
  title: string;
  url: string;
  publishedAt: string | null;
}

interface AccountState {
  /** false = der Feed wurde noch nie erfolgreich gelesen – der erste erfolgreiche Abruf merkt sich nur den Bestand */
  initialized: boolean;
  /** IDs bereits bekannter Videos (die neuesten zuerst, begrenzt) */
  seen: string[];
  checkedAt: string | null;
  error: string | null;
  latest: FeedEntry | null;
  posted: number;
}
type SocialState = Record<string, AccountState>;

async function readState(): Promise<SocialState> {
  const [row] = await db.select().from(settingsTable).where(eq(settingsTable.key, STATE_KEY)).limit(1);
  return (row?.value as SocialState | undefined) ?? {};
}

async function writeState(value: SocialState): Promise<void> {
  await db.insert(settingsTable).values({ key: STATE_KEY, value }).onConflictDoUpdate({ target: settingsTable.key, set: { value, updatedAt: new Date() } });
}

/* ------------------------------------------------------------ Feed abrufen und lesen */

const decode = (text: string) =>
  text
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&#x([0-9a-f]+);/gi, (_, h: string) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .trim();

const tag = (xml: string, name: string): string | null => {
  const m = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, 'i').exec(xml);
  return m ? decode(m[1]!) : null;
};

/** Liest Einträge aus einem Atom- oder RSS-Feed (YouTube liefert Atom). Reicht für Titel, Link, Kennung und Datum. */
export function parseFeed(xml: string): { title: string | null; entries: FeedEntry[] } {
  const head = xml.split(/<entry[\s>]|<item[\s>]/i)[0] ?? '';
  const title = tag(head, 'title');
  const blocks = [...xml.matchAll(/<entry[\s>][\s\S]*?<\/entry>|<item[\s>][\s\S]*?<\/item>/gi)].map((m) => m[0]);
  const entries: FeedEntry[] = [];
  for (const b of blocks) {
    // Atom: <link rel="alternate" href="…"/> · RSS: <link>…</link>
    const href = /<link\b[^>]*\brel=["']alternate["'][^>]*\bhref=["']([^"']+)["']/i.exec(b)?.[1] ?? /<link\b[^>]*\bhref=["']([^"']+)["']/i.exec(b)?.[1] ?? tag(b, 'link');
    const url = href ? decode(href) : '';
    const id = tag(b, 'yt:videoId') ?? tag(b, 'id') ?? tag(b, 'guid') ?? url;
    if (!id || !/^https?:\/\//i.test(url)) continue;
    const published = tag(b, 'published') ?? tag(b, 'pubDate') ?? tag(b, 'updated');
    const time = published ? Date.parse(published) : NaN;
    entries.push({ id: id.slice(0, 300), title: (tag(b, 'title') ?? '').slice(0, 300), url: url.slice(0, 500), publishedAt: Number.isFinite(time) ? new Date(time).toISOString() : null });
  }
  return { title, entries };
}

/** Lokale und interne Adressen werden nicht abgerufen (außer im Test) */
function assertPublicUrl(raw: string): URL {
  const url = new URL(raw);
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error('Nur Adressen mit http:// oder https:// sind möglich.');
  const host = url.hostname.toLowerCase();
  const internal = host === 'localhost' || host.endsWith('.local') || host.endsWith('.internal') || /^(127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|0\.)/.test(host) || host === '[::1]' || host.startsWith('[f');
  if (internal && !env.SOCIAL_FEED_ALLOW_PRIVATE) throw new Error('Diese Adresse ist nicht erlaubt.');
  return url;
}

async function fetchText(raw: string): Promise<string> {
  const url = assertPublicUrl(raw);
  const res = await fetch(url, {
    redirect: 'follow',
    signal: AbortSignal.timeout(10_000),
    // YouTube zeigt ohne diese Angabe in der EU eine Zustimmungsseite statt des Kanals
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; feed-reader)', 'Accept-Language': 'en', Cookie: 'SOCS=CAI', Accept: 'application/atom+xml, application/rss+xml, application/xml, text/xml, text/html;q=0.8' },
  });
  if (!res.ok) throw new Error(`Die Adresse antwortet mit Fehler ${res.status}.`);
  const text = await res.text();
  return text.slice(0, 3_000_000);
}

const YT_HOSTS = ['youtube.com', 'www.youtube.com', 'm.youtube.com', 'youtu.be'];
const youtubeFeed = (channelId: string) => `${env.YOUTUBE_BASE_URL}/feeds/videos.xml?channel_id=${channelId}`;

/**
 * Macht aus einem eingegebenen Link den Feed, den der Bot abfragt:
 *  – YouTube: /channel/UC…, /@name, /c/name, /user/name oder direkt der Feed
 *  – alles andere: die Adresse selbst muss ein RSS-/Atom-Feed sein
 */
export async function resolveSocialAccount(input: string): Promise<{ url: string; feedUrl: string; name: string; latest: FeedEntry | null }> {
  let url: URL;
  try {
    url = new URL(input.trim().startsWith('http') ? input.trim() : `https://${input.trim()}`);
  } catch {
    throw new Error('Das ist kein gültiger Link.');
  }
  const base = new URL(env.YOUTUBE_BASE_URL);
  // Die zweite Bedingung gilt nur im Test, wenn YouTube durch eine lokale Adresse ersetzt ist
  const isYoutube = YT_HOSTS.includes(url.hostname.toLowerCase()) || (url.host === base.host && /^\/(@|channel\/|c\/|user\/)/.test(url.pathname));
  let feedUrl = url.toString();
  if (isYoutube && !url.pathname.startsWith('/feeds/')) {
    const direct = /^\/channel\/(UC[\w-]{22})/.exec(url.pathname)?.[1];
    let channelId = direct ?? null;
    if (!channelId) {
      // Kanalseite laden und die Kanal-ID herauslesen
      const html = await fetchText(`${env.YOUTUBE_BASE_URL}${url.pathname}`);
      channelId = /channel_id=(UC[\w-]{22})/.exec(html)?.[1] ?? /"externalId":"(UC[\w-]{22})"/.exec(html)?.[1] ?? /"channelId":"(UC[\w-]{22})"/.exec(html)?.[1] ?? null;
    }
    if (!channelId) throw new Error('Zu diesem Link wurde kein YouTube-Kanal gefunden. Bitte den Link zum Kanal angeben, z. B. https://www.youtube.com/@name.');
    feedUrl = youtubeFeed(channelId);
  }
  const feed = parseFeed(await fetchText(feedUrl));
  if (feed.entries.length === 0 && !feed.title) {
    throw new Error(isYoutube ? 'Der Feed dieses Kanals konnte nicht gelesen werden.' : 'Unter dieser Adresse liegt kein RSS-/Atom-Feed. Unterstützt werden YouTube-Kanäle und Feeds.');
  }
  return { url: url.toString(), feedUrl, name: (feed.title ?? url.hostname).slice(0, 80), latest: feed.entries[0] ?? null };
}

/* ------------------------------------------------------------ Posten */

function messageFor(cfg: SocialPingSettings, account: SocialAccount, entry: FeedEntry): unknown {
  const text = cfg.message.replaceAll('{name}', account.name).replaceAll('{title}', entry.title || account.name).replaceAll('{url}', entry.url);
  return {
    content: `${cfg.pingRoleId ? `<@&${cfg.pingRoleId}>\n` : ''}${text}`.slice(0, 1900),
    allowed_mentions: { parse: [], roles: cfg.pingRoleId ? [cfg.pingRoleId] : [] },
  };
}

/** Testnachricht: postet das neueste Video eines Kontos (wirft bei einem Fehler) */
export async function sendSocialTest(accountId: string): Promise<void> {
  const cfg = (await discordConfig()).settings.socialPing;
  const account = cfg.accounts.find((a) => a.id === accountId);
  if (!account) throw new Error('Dieses Konto gibt es nicht (mehr). Bitte zuerst speichern.');
  if (!cfg.channelId) throw new Error('Es ist noch kein Kanal eingetragen.');
  const entry = parseFeed(await fetchText(account.feedUrl)).entries[0];
  if (!entry) throw new Error('Dieses Konto hat noch kein Video.');
  await botRequest('POST', `/channels/${cfg.channelId}/messages`, { json: messageFor(cfg, account, entry) });
}

/* ------------------------------------------------------------ Regelmäßige Prüfung */

/** Prüft alle Konten auf neue Videos und postet sie */
export async function checkSocialAccounts(): Promise<{ accounts: number; posted: number; errors: number }> {
  if (env.BETA_MODE) return { accounts: 0, posted: 0, errors: 0 };
  const dc = await discordConfig();
  const cfg = dc.settings.socialPing;
  if (!dc.botReady || !cfg.enabled || !cfg.channelId || cfg.accounts.length === 0) return { accounts: 0, posted: 0, errors: 0 };
  if (!(await acquireLease(LEASE, OWNER, 4 * 60_000))) return { accounts: 0, posted: 0, errors: 0 };
  const stats = { accounts: cfg.accounts.length, posted: 0, errors: 0 };
  try {
    const state = await readState();
    const next: SocialState = {};
    for (const account of cfg.accounts) {
      // Der Stand hängt am Feed: Wird der Link eines Kontos geändert, beginnt es von vorn
      const key = `${account.id}|${account.feedUrl}`;
      const prev = state[key];
      const now = new Date().toISOString();
      try {
        const entries = parseFeed(await fetchText(account.feedUrl)).entries;
        if (!prev?.initialized) {
          // Erster erfolgreicher Abruf: nur merken, nichts posten
          next[key] = { initialized: true, seen: entries.map((e) => e.id).slice(0, 100), checkedAt: now, error: null, latest: entries[0] ?? null, posted: 0 };
          continue;
        }
        const seen = new Set(prev.seen);
        // Feeds führen das Neueste zuerst – gepostet wird in der Reihenfolge des Erscheinens
        const fresh = entries.filter((e) => !seen.has(e.id)).reverse();
        let posted = prev.posted;
        let error: string | null = null;
        const done: string[] = [];
        for (const entry of fresh.slice(0, MAX_POSTS_PER_RUN)) {
          try {
            await botRequest('POST', `/channels/${cfg.channelId}/messages`, { json: messageFor(cfg, account, entry) });
            done.push(entry.id);
            posted++;
            stats.posted++;
          } catch (err) {
            // Nicht als gesehen merken – beim nächsten Lauf wird es noch einmal versucht
            error = `Nachricht konnte nicht gesendet werden: ${discordErrorText(err)}`;
            stats.errors++;
            break;
          }
        }
        // Was über die Obergrenze je Lauf hinausgeht, gilt als erledigt (sonst käme es als Flut nach)
        const skipped = error ? [] : fresh.slice(MAX_POSTS_PER_RUN).map((e) => e.id);
        next[key] = { initialized: true, seen: [...done, ...skipped, ...prev.seen].slice(0, 100), checkedAt: now, error, latest: entries[0] ?? prev.latest, posted };
      } catch (err) {
        stats.errors++;
        // Der Fehler wird im Admin-Bereich angezeigt; ohne früheren Stand bleibt das Konto „noch nie gelesen“
        next[key] = { ...(prev ?? { initialized: false, seen: [], latest: null, posted: 0 }), checkedAt: now, error: (err as Error).message.slice(0, 200) };
      }
    }
    await writeState(next);
    return stats;
  } finally {
    await releaseLease(LEASE, OWNER).catch(() => {});
  }
}

/** Stand je Konto für den Admin-Bereich */
export async function socialAdminStatus(): Promise<AdminSocialDTO> {
  const cfg = (await discordConfig()).settings.socialPing;
  const state = await readState();
  return {
    accounts: cfg.accounts.map((a) => {
      const s = state[`${a.id}|${a.feedUrl}`];
      return { id: a.id, checkedAt: s?.checkedAt ?? null, error: s?.error ?? null, latest: s?.latest ? { title: s.latest.title, url: s.latest.url, publishedAt: s.latest.publishedAt } : null, posted: s?.posted ?? 0 };
    }),
  };
}
