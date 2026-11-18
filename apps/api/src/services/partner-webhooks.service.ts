/**
 * Webhooks der Partner-API: Wir melden Statuswechsel aktiv an eine Adresse des Partners – dann muss er nicht
 * ständig abfragen. Jede Zustellung ist signiert (HMAC-SHA256 über Zeitstempel und Inhalt).
 *
 * Schutz: nur https, keine Adressen im eigenen Netz (auch nicht über DNS), Weiterleitungen werden nicht verfolgt,
 * kurze Zeitgrenze, begrenzte Wiederholungen und eine Obergrenze wartender Ereignisse je Partner.
 */
import { createHmac, randomInt } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { isIP } from 'node:net';
import { and, asc, count, desc, eq, isNull, lt, lte, or } from 'drizzle-orm';
import { affectedRows, db } from '../db/client';
import { partnerWebhookEvents, partners, type Partner } from '../db/schema';
import { env } from '../env';
import { decryptField, encryptField, uuid } from '../lib/crypto';
import { Errors, L } from '../lib/errors';
import { mapLimit } from '../jobs/types';

export type WebhookEvent = 'server.installed' | 'server.install_failed' | 'server.running' | 'server.stopped' | 'server.cooldown_ended' | 'server.deletion_soon' | 'server.deleted' | 'webhook.test';

const MAX_ATTEMPTS = 6;
/** Abstand vor dem nächsten Versuch (Sekunden) */
const BACKOFF = [30, 120, 600, 3600, 6 * 3600];
const MAX_PENDING = 5000;
/** Zeitgrenze je Zustellung, Ereignisse je Partner und Lauf, Dauer der Reservierung während des Sendens */
const TIMEOUT_MS = 5000;
const PER_RUN = 25;
const CLAIM_MS = 120_000;
const SECRET_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';

/** Adresse im eigenen oder einem privaten Netz? (IPv4 und IPv6) */
function isPrivateAddress(ip: string): boolean {
  if (isIP(ip) === 4) {
    const [a, b] = ip.split('.').map(Number) as [number, number];
    return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 192 && b === 0) || (a === 198 && (b === 18 || b === 19)) || a >= 224;
  }
  if (isIP(ip) !== 6) return true; // weder IPv4 noch IPv6: nie erlaubt
  const v = ip.toLowerCase();
  // Alles, was mit „::“ beginnt (unbestimmt, Loopback, in IPv6 verpackte IPv4-Adressen wie ::ffff:10.0.0.1 – auch in
  // der Schreibweise ::ffff:a00:1), sowie NAT64 und 6to4: Dahinter kann eine interne IPv4-Adresse stecken
  if (v.startsWith('::') || v.startsWith('64:ff9b:') || v.startsWith('2002:')) return true;
  return v.startsWith('fc') || v.startsWith('fd') || v.startsWith('fe8') || v.startsWith('fe9') || v.startsWith('fea') || v.startsWith('feb') || v.startsWith('ff');
}

/** Unsere eigenen Hosts (Website, API, Panel) sind als Ziel nie erlaubt */
const ownHosts = () =>
  new Set(
    [env.APP_URL, env.MAIN_URL, env.PTERODACTYL_URL]
      .map((u) => {
        try {
          return u ? new URL(u).hostname.toLowerCase() : null;
        } catch {
          return null;
        }
      })
      .filter((h): h is string => !!h),
  );

/**
 * Prüft die Adresse: https auf Port 443, öffentlicher Host, keine Zugangsdaten. Gibt die Adresse zusammen mit der
 * geprüften IP zurück – zugestellt wird genau an diese IP (sonst könnte der Host zwischen Prüfung und Verbindung
 * auf eine interne Adresse umgestellt werden). Wirft einen verständlichen Fehler.
 */
async function assertPublicHttps(raw: string): Promise<{ url: URL; address: string; family: 4 | 6 }> {
  const invalid = (de: string, en: string) => {
    const msg = L(de, en);
    return Errors.badRequest('invalid_url', msg, { url: msg });
  };
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw invalid('Das ist keine gültige Adresse.', 'This is not a valid URL.');
  }
  if (url.username || url.password) throw invalid('Adressen mit Zugangsdaten sind nicht erlaubt.', 'URLs with credentials are not allowed.');
  const test = env.PARTNER_WEBHOOK_ALLOW_PRIVATE;
  if (!test && url.protocol !== 'https:') throw invalid('Nur https-Adressen sind erlaubt.', 'Only https URLs are allowed.');
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw invalid('Nur https-Adressen sind erlaubt.', 'Only https URLs are allowed.');
  if (!test && url.port && url.port !== '443') throw invalid('Nur der Standard-Port 443 ist erlaubt.', 'Only the default port 443 is allowed.');
  const host = url.hostname.replace(/^\[|\]$/g, '').replace(/\.$/, '').toLowerCase();
  if (!test && ownHosts().has(host)) throw invalid('Diese Adresse ist nicht erlaubt.', 'This URL is not allowed.');
  let addresses: Array<{ address: string; family: number }>;
  try {
    // Auch die Namensauflösung bekommt eine Frist – ein hängender DNS-Server darf die Zustellung nicht aufhalten
    addresses = isIP(host)
      ? [{ address: host, family: isIP(host) }]
      : await Promise.race([lookup(host, { all: true }), new Promise<never>((_, reject) => setTimeout(() => reject(new Error('DNS-Zeitüberschreitung')), 3000).unref())]);
  } catch {
    throw invalid('Der Host dieser Adresse lässt sich nicht auflösen.', 'The host of this URL cannot be resolved.');
  }
  if (addresses.length === 0 || (!test && addresses.some((a) => isPrivateAddress(a.address)))) throw invalid('Diese Adresse zeigt in ein privates Netz und ist nicht erlaubt.', 'This URL points to a private network and is not allowed.');
  const first = addresses[0]!;
  return { url, address: first.address, family: first.family === 6 ? 6 : 4 };
}

/** POST an genau die geprüfte IP (kein erneutes Auflösen), ohne Weiterleitungen, mit harter Zeitgrenze. Gibt den Status zurück. */
function postPinned(target: { url: URL; address: string; family: 4 | 6 }, headers: Record<string, string>, body: string, timeoutMs: number): Promise<number> {
  return new Promise((resolve, reject) => {
    const request = (target.url.protocol === 'https:' ? httpsRequest : httpRequest)(
      target.url,
      {
        method: 'POST',
        headers: { ...headers, 'Content-Length': String(Buffer.byteLength(body)) },
        // Immer die geprüfte IP – der Hostname dient nur noch für Zertifikat und Host-Kopfzeile
        // (Node fragt je nach Version nach einer einzelnen Adresse oder – mit „all“ – nach einer Liste)
        lookup: (_host, options, callback) => {
          const cb = callback as (err: Error | null, address: string | Array<{ address: string; family: number }>, family?: number) => void;
          if (typeof options === 'object' && options && (options as { all?: boolean }).all) cb(null, [{ address: target.address, family: target.family }]);
          else cb(null, target.address, target.family);
        },
        agent: false,
      },
      (res) => {
        // Der Inhalt der Antwort interessiert nicht (und darf nichts auslösen)
        res.destroy();
        clearTimeout(deadline);
        resolve(res.statusCode ?? 0);
      },
    );
    const deadline = setTimeout(() => request.destroy(new Error('Zeitüberschreitung')), timeoutMs);
    request.on('error', (err) => {
      clearTimeout(deadline);
      reject(err);
    });
    request.end(body);
  });
}

/** Webhook setzen bzw. ändern. Das Geheimnis zum Prüfen der Signatur steht nur in dieser Antwort. */
export async function setPartnerWebhook(partner: Partner, rawUrl: string): Promise<{ url: string; secret: string }> {
  if (rawUrl.length > 500) throw Errors.badRequest('invalid_url', L('Die Adresse ist zu lang.', 'The URL is too long.'));
  const url = (await assertPublicHttps(rawUrl)).url.toString();
  const secret = `whsec_${Array.from({ length: 40 }, () => SECRET_ALPHABET[randomInt(SECRET_ALPHABET.length)]).join('')}`;
  await db.update(partners).set({ webhookUrl: url, webhookSecret: encryptField(secret) }).where(eq(partners.id, partner.id));
  return { url, secret };
}

export async function clearPartnerWebhook(partner: Partner): Promise<void> {
  await db.update(partners).set({ webhookUrl: null, webhookSecret: null }).where(eq(partners.id, partner.id));
  await db.update(partnerWebhookEvents).set({ failedAt: new Date(), lastError: 'Webhook entfernt' }).where(and(eq(partnerWebhookEvents.partnerId, partner.id), isNull(partnerWebhookEvents.deliveredAt), isNull(partnerWebhookEvents.failedAt)));
}

export async function partnerWebhookStatus(partner: Partner) {
  const [fresh] = await db.select({ url: partners.webhookUrl }).from(partners).where(eq(partners.id, partner.id)).limit(1);
  const [pending] = await db.select({ n: count() }).from(partnerWebhookEvents).where(and(eq(partnerWebhookEvents.partnerId, partner.id), isNull(partnerWebhookEvents.deliveredAt), isNull(partnerWebhookEvents.failedAt)));
  // Die neuesten zuerst
  const last = await db.select().from(partnerWebhookEvents).where(eq(partnerWebhookEvents.partnerId, partner.id)).orderBy(desc(partnerWebhookEvents.createdAt)).limit(20);
  return {
    url: fresh?.url ?? null,
    events: ['server.installed', 'server.install_failed', 'server.running', 'server.stopped', 'server.cooldown_ended', 'server.deletion_soon', 'server.deleted'],
    pending: Number(pending?.n ?? 0),
    recent: last.map((e) => ({ id: e.id, type: e.type, createdAt: e.createdAt.toISOString(), status: e.deliveredAt ? 'delivered' : e.failedAt ? 'failed' : 'pending', attempts: e.attempts, lastError: e.lastError })),
  };
}

/** Ereignis in den Ausgangskorb legen (nur, wenn der Partner einen Webhook eingerichtet hat) */
export async function emitPartnerEvent(partnerId: string, type: WebhookEvent, data: Record<string, unknown>): Promise<void> {
  const [p] = await db.select({ url: partners.webhookUrl, enabled: partners.enabled }).from(partners).where(eq(partners.id, partnerId)).limit(1);
  if (!p?.url) return;
  // Obergrenze wartender Ereignisse: Ist der Empfänger lange nicht erreichbar, läuft die Tabelle nicht voll
  const [open] = await db.select({ n: count() }).from(partnerWebhookEvents).where(and(eq(partnerWebhookEvents.partnerId, partnerId), isNull(partnerWebhookEvents.deliveredAt), isNull(partnerWebhookEvents.failedAt)));
  if (Number(open?.n ?? 0) >= MAX_PENDING) return;
  await db.insert(partnerWebhookEvents).values({ id: uuid(), partnerId, type, payload: data });
}

export const signWebhook = (secret: string, timestamp: number, body: string) => createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');

/** Fällige Ereignisse zustellen (Job, alle 15 Sekunden) und alte aufräumen */
export async function deliverPartnerWebhooks(now = new Date()) {
  const stats = { delivered: 0, failed: 0, dropped: 0, postponed: 0 };
  // Je Partner getrennt und mehrere Partner gleichzeitig: Ein Empfänger, der hängt oder Fehler liefert (oder ein Partner
  // mit tausenden wartenden Ereignissen), darf die Zustellung an alle anderen nicht aufhalten. Deshalb zuerst die
  // Partner mit fälligen Ereignissen ermitteln und dann je Partner höchstens PER_RUN der ältesten laden.
  const open = and(isNull(partnerWebhookEvents.deliveredAt), isNull(partnerWebhookEvents.failedAt), lte(partnerWebhookEvents.nextAttemptAt, now));
  const waiting = await db.selectDistinct({ partnerId: partnerWebhookEvents.partnerId }).from(partnerWebhookEvents).where(open).limit(500);
  const byPartner = new Map<string, (typeof partnerWebhookEvents.$inferSelect)[]>();
  for (const { partnerId } of waiting) {
    byPartner.set(partnerId, await db.select().from(partnerWebhookEvents).where(and(eq(partnerWebhookEvents.partnerId, partnerId), open)).orderBy(asc(partnerWebhookEvents.createdAt)).limit(PER_RUN));
  }
  await mapLimit([...byPartner.entries()], 4, async ([partnerId, events]) => {
    const [p] = await db.select({ url: partners.webhookUrl, secret: partners.webhookSecret, enabled: partners.enabled }).from(partners).where(eq(partners.id, partnerId)).limit(1);
    const secret = decryptField(p?.secret) || '';
    const target = p?.enabled && p.url && secret ? { url: p.url, secret } : null;
    for (let i = 0; i < events.length; i++) {
      const event = events[i]!;
      if (!target) {
        await db.update(partnerWebhookEvents).set({ failedAt: now, lastError: 'Kein Webhook eingerichtet' }).where(eq(partnerWebhookEvents.id, event.id));
        stats.dropped++;
        continue;
      }
      // Reservieren, bevor gesendet wird: Überschneiden sich zwei Läufe, stellt nur einer zu
      const claimed = await db
        .update(partnerWebhookEvents)
        .set({ nextAttemptAt: new Date(now.getTime() + CLAIM_MS) })
        .where(and(eq(partnerWebhookEvents.id, event.id), isNull(partnerWebhookEvents.deliveredAt), isNull(partnerWebhookEvents.failedAt), lte(partnerWebhookEvents.nextAttemptAt, now)));
      if (affectedRows(claimed) !== 1) continue;
      const timestamp = Math.floor(Date.now() / 1000);
      const body = JSON.stringify({ id: event.id, type: event.type, createdAt: event.createdAt.toISOString(), data: event.payload });
      let error: string | null = null;
      try {
        // Bei jeder Zustellung neu prüfen: Der Host darf nicht (inzwischen) in ein privates Netz zeigen
        const checked = await assertPublicHttps(target.url);
        const status = await postPinned(
          checked,
          {
            'Content-Type': 'application/json',
            'User-Agent': 'CraftingHosting-Webhooks/1',
            'X-CHF-Event': event.type,
            'X-CHF-Delivery': event.id,
            'X-CHF-Timestamp': String(timestamp),
            'X-CHF-Signature': `sha256=${signWebhook(target.secret, timestamp, body)}`,
          },
          body,
          TIMEOUT_MS,
        );
        if (status < 200 || status >= 300) error = `HTTP ${status}`;
      } catch (err) {
        const e = err as { message?: unknown; code?: unknown };
        error = String((typeof e.message === 'string' && e.message) || e.code || err).slice(0, 200);
      }
      if (!error) {
        await db.update(partnerWebhookEvents).set({ deliveredAt: new Date(), attempts: event.attempts + 1, lastError: null }).where(eq(partnerWebhookEvents.id, event.id));
        stats.delivered++;
        continue;
      }
      const attempts = event.attempts + 1;
      const final = attempts >= MAX_ATTEMPTS;
      const retryAt = new Date(now.getTime() + (BACKOFF[attempts - 1] ?? 21_600) * 1000);
      await db
        .update(partnerWebhookEvents)
        .set({ attempts, lastError: error, ...(final ? { failedAt: now } : { nextAttemptAt: retryAt }) })
        .where(eq(partnerWebhookEvents.id, event.id));
      stats.failed++;
      // Der Empfänger ist gerade nicht erreichbar: die übrigen Ereignisse dieses Partners in diesem Lauf gar nicht erst
      // versuchen (sie bleiben fällig und kommen in der richtigen Reihenfolge nach, sobald er wieder antwortet)
      stats.postponed += events.length - i - 1;
      break;
    }
  });
  // Erledigte und aufgegebene Ereignisse nach sieben Tagen entfernen
  const old = new Date(now.getTime() - 7 * 86_400_000);
  await db.delete(partnerWebhookEvents).where(and(lt(partnerWebhookEvents.createdAt, old), or(lte(partnerWebhookEvents.deliveredAt, now), lte(partnerWebhookEvents.failedAt, now))));
  return stats;
}
