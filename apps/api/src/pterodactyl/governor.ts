/**
 * Steuerung aller Panel-Aufrufe, damit das Anfrage-Limit von Pterodactyl nie erreicht wird.
 *
 * Pterodactyl begrenzt Anfragen je Panel-Benutzer und Minute (Client-API Standard 720, Application-API 240 –
 * APP_API_CLIENT_RATELIMIT / APP_API_APPLICATION_RATELIMIT in der .env des Panels). Alle Aufrufe dieses Systems laufen
 * über je einen Key; das Panel-Frontend desselben Benutzers teilt sich das Client-Limit. Wird es erreicht, antwortet
 * das Panel mit 429 „Too Many Attempts“ – für das System UND für den Benutzer im Panel.
 *
 * So wird es verhindert:
 *  – Jede Antwort des Panels meldet in X-RateLimit-Remaining, wie viele Anfragen in der laufenden Minute noch frei
 *    sind. Das ist der echte Stand beim Panel – auch wenn mehrere Prozesse (API und Worker) gleichzeitig fragen.
 *  – Prioritäten: Hintergrund-Abfragen (Jobs) halten einen großen Teil frei und warten, sobald es knapp wird;
 *    Abfragen der Website und der Partner-API halten einen kleinen Rest frei; Befehle (Starten, Stoppen, Schreiben)
 *    kommen immer durch.
 *  – Nach einem 429 fragt niemand vor Ablauf der genannten Wartezeit erneut (kein „Nachhämmern“).
 *  – Ohne diese Kopfzeilen (z. B. ältere Panels, Testbetrieb) greift ein eigenes Kontingent je Minute.
 */
import { AsyncLocalStorage } from 'node:async_hooks';
import { env } from '../env';
import { PterodactylError } from './types';

export type PanelApi = 'application' | 'client';
/** high: Befehle und Grenzen durchsetzen · normal: Website und Partner · low: Hintergrund-Abfragen */
export type PanelPriority = 'high' | 'normal' | 'low';

const priorityCtx = new AsyncLocalStorage<{ priority: PanelPriority }>();

/** Führt `fn` mit der angegebenen Priorität für Panel-Aufrufe aus (Jobs laufen mit „low“) */
export const withPanelPriority = <T>(priority: PanelPriority, fn: () => T): T => priorityCtx.run({ priority }, fn);

const WINDOW_MS = 60_000;
/** Anteil des Limits, den eine Priorität frei lassen muss */
const RESERVE: Record<PanelPriority, number> = { low: 0.35, normal: 0.08, high: 0 };
/** So lange wartet ein Aufruf höchstens auf ein freies Kontingent, danach gibt er auf */
const MAX_WAIT_MS: Record<PanelPriority, number> = { low: 65_000, normal: 6_000, high: 30_000 };
/** Solange das Limit noch unbekannt ist (vor der ersten Antwort), höchstens so viele Anfragen gleichzeitig */
const PROBE_CONCURRENCY = 2;

/** Anfrage ohne Antwort beendet (Netzwerkfehler, Zeitüberschreitung) */
export function panelCallFailed(api: PanelApi): void {
  states[api].inflight = Math.max(0, states[api].inflight - 1);
}

/** Panel ausgelastet: der Aufruf wurde gar nicht erst geschickt */
export class PanelBusyError extends PterodactylError {
  constructor(
    readonly api: PanelApi,
    readonly retryAfterMs: number,
  ) {
    super(`Pterodactyl ausgelastet (${api}-API) – Aufruf zurückgestellt, erneut in ${Math.ceil(retryAfterMs / 1000)} s`, 429);
  }
}

class ApiState {
  /** Vom Panel gemeldet (null = noch unbekannt) */
  limit: number | null = null;
  remaining: number | null = null;
  /** Beginn des laufenden Minutenfensters beim Panel (geschätzt) */
  windowStart = 0;
  /** Nach einem 429: vorher nichts schicken */
  blockedUntil = 0;
  /** Geschickt, aber noch ohne Antwort (stecken noch nicht im Rest, den das Panel meldet) */
  inflight = 0;
  /** Zeitpunkt der letzten Antwort mit Kopfzeilen */
  lastHeaderAt = 0;
  /** Eigenes Kontingent, falls das Panel keine Kopfzeilen schickt */
  private tokens: number;
  private refilledAt = Date.now();
  /** Für die Anzeige im Admin-Bereich */
  readonly sent: number[] = [];
  readonly throttled: number[] = [];
  readonly deferred: number[] = [];

  constructor(readonly fallbackLimit: number) {
    this.tokens = fallbackLimit;
  }

  effectiveLimit(): number {
    return this.limit ?? this.fallbackLimit;
  }

  /** Noch freie Anfragen im laufenden Fenster (vom Panel gemeldet, sonst eigenes Kontingent) */
  free(now: number): number {
    if (this.remaining !== null && now < this.windowStart + WINDOW_MS) return this.remaining;
    if (this.remaining !== null) return this.effectiveLimit(); // Fenster abgelaufen: wieder voll
    this.refill(now);
    return Math.floor(this.tokens);
  }

  /** Wann wieder Anfragen frei werden */
  freeAt(now: number): number {
    if (this.remaining !== null) return Math.max(now + 250, this.windowStart + WINDOW_MS);
    this.refill(now);
    return now + Math.ceil(((1 - this.tokens) / this.fallbackLimit) * WINDOW_MS) + 50;
  }

  private refill(now: number) {
    this.tokens = Math.min(this.fallbackLimit, this.tokens + ((now - this.refilledAt) / WINDOW_MS) * this.fallbackLimit);
    this.refilledAt = now;
  }

  consume(now: number) {
    if (this.remaining !== null && now < this.windowStart + WINDOW_MS) this.remaining = Math.max(0, this.remaining - 1);
    else if (this.remaining !== null) {
      // Neues Fenster beim Panel – bis zur nächsten Antwort von vollem Kontingent ausgehen
      this.windowStart = now;
      this.remaining = this.effectiveLimit() - 1;
    }
    this.refill(now);
    this.tokens -= 1;
    push(this.sent, now);
  }
}

const push = (list: number[], now: number) => {
  list.push(now);
  while (list.length && list[0]! < now - 60 * 60_000) list.shift();
  if (list.length > 20_000) list.splice(0, list.length - 20_000);
};

const states: Record<PanelApi, ApiState> = {
  client: new ApiState(env.PTERODACTYL_CLIENT_RATE_LIMIT),
  application: new ApiState(env.PTERODACTYL_APP_RATE_LIMIT),
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Vor jedem Panel-Aufruf: wartet, bis die Priorität ein freies Kontingent hat, oder wirft PanelBusyError.
 * Schreibende Aufrufe (alles außer GET) gelten immer als „high“.
 */
export async function acquirePanelCall(api: PanelApi, method: string): Promise<void> {
  const priority: PanelPriority = method !== 'GET' ? 'high' : (priorityCtx.getStore()?.priority ?? 'normal');
  const s = states[api];
  const deadline = Date.now() + MAX_WAIT_MS[priority];
  for (;;) {
    const now = Date.now();
    const reserve = Math.ceil(s.effectiveLimit() * RESERVE[priority]);
    const blocked = s.blockedUntil > now;
    // Vor der ersten Antwort ist das echte Limit unbekannt: nur vorsichtig anfragen, bis es die Kopfzeilen verraten
    const probing = s.limit === null && s.remaining === null && s.inflight >= PROBE_CONCURRENCY && s.sent.length < 50;
    // Unser Fenster-Ende ist nur geschätzt (das Panel-Fenster beginnt mit der ersten Anfrage irgendeines Prozesses).
    // Ist der Rest aufgebraucht und die letzte Meldung älter als 5 s, darf EINE Anfrage als Probe raus – ihre Antwort
    // zeigt, ob beim Panel schon ein neues Fenster begonnen hat.
    const probe = !blocked && s.remaining !== null && s.inflight === 0 && now - s.lastHeaderAt > 5_000 && priority !== 'low';
    if (!blocked && !probing && (s.free(now) > reserve || probe)) {
      s.inflight++;
      s.consume(now);
      return;
    }
    const until = blocked ? s.blockedUntil : probing ? now + 100 : s.remaining !== null && priority !== 'low' ? Math.min(s.freeAt(now), Math.max(now + 250, s.lastHeaderAt + 5_100)) : s.freeAt(now);
    if (until > deadline) {
      push(s.deferred, now);
      throw new PanelBusyError(api, until - now);
    }
    await sleep(Math.min(until - now, 2_000));
  }
}

/** Nach jeder Antwort: Stand des Panels übernehmen */
export function observePanelResponse(api: PanelApi, res: Pick<Response, 'status' | 'headers'>): void {
  const s = states[api];
  const now = Date.now();
  s.inflight = Math.max(0, s.inflight - 1);
  const limit = Number(res.headers.get('x-ratelimit-limit'));
  const remaining = Number(res.headers.get('x-ratelimit-remaining'));
  if (Number.isFinite(limit) && limit > 0 && res.headers.has('x-ratelimit-limit')) s.limit = limit;
  if (Number.isFinite(remaining) && res.headers.has('x-ratelimit-remaining')) {
    s.lastHeaderAt = now;
    // Der gemeldete Rest enthält unsere noch laufenden Anfragen nicht – unser eigener Stand ist deshalb meist kleiner.
    // Liegt die Meldung deutlich darüber (mehr als die laufenden Anfragen), hat beim Panel ein neues Fenster begonnen.
    const fresh = s.remaining === null || now >= s.windowStart + WINDOW_MS || remaining > s.remaining + s.inflight + 1;
    if (fresh) {
      s.windowStart = now;
      s.remaining = Math.max(0, remaining - s.inflight);
    } else s.remaining = Math.min(s.remaining!, remaining);
  }
  // Nur ein 429 des Anfrage-Limits sperrt alles. Andere 429 (z. B. „zu viele Backups“) haben noch freien Rest.
  const limitHit = res.status === 429 && (!res.headers.has('x-ratelimit-remaining') || remaining === 0);
  if (limitHit) {
    const retryAfterRaw = res.headers.get('retry-after');
    const retryAfter = Number(retryAfterRaw);
    const resetAt = Number(res.headers.get('x-ratelimit-reset')) * 1000;
    const until =
      retryAfterRaw !== null && Number.isFinite(retryAfter) ? now + Math.max(1, retryAfter) * 1000 : Number.isFinite(resetAt) && resetAt > now ? resetAt : now + 15_000;
    // Ein festes Minutenfenster braucht nie länger als eine Minute
    s.blockedUntil = Math.max(s.blockedUntil, Math.min(until, now + WINDOW_MS));
    s.remaining = 0;
    s.windowStart = Math.min(until, now + WINDOW_MS) - WINDOW_MS;
    push(s.throttled, now);
  }
}

export interface PanelUsage {
  api: PanelApi;
  limit: number;
  limitSource: 'panel' | 'setting';
  remaining: number | null;
  sentLastMinute: number;
  sentLastHour: number;
  throttledLastHour: number;
  deferredLastHour: number;
  lastThrottledAt: string | null;
}

/** Auslastung dieses Prozesses für den Admin-Bereich */
export function panelUsage(): PanelUsage[] {
  const now = Date.now();
  return (['client', 'application'] as const).map((api) => {
    const s = states[api];
    return {
      api,
      limit: s.effectiveLimit(),
      limitSource: s.limit !== null ? 'panel' : 'setting',
      remaining: s.remaining !== null && now < s.windowStart + WINDOW_MS ? s.remaining : null,
      sentLastMinute: s.sent.filter((t) => t > now - WINDOW_MS).length,
      sentLastHour: s.sent.length,
      throttledLastHour: s.throttled.length,
      deferredLastHour: s.deferred.length,
      lastThrottledAt: s.throttled.length ? new Date(s.throttled[s.throttled.length - 1]!).toISOString() : null,
    };
  });
}

/* ------------------------------------------------------------ Anzeige im Admin-Bereich (über Prozesse hinweg) */

export interface PanelUsageSnapshot {
  role: 'api' | 'worker';
  at: string;
  usage: PanelUsage[];
}

/**
 * API und Worker sind getrennte Prozesse mit eigenem Zähler. Jeder legt seinen Stand alle 30 Sekunden in der
 * Datenbank ab, damit der Admin-Bereich beide zeigen kann.
 */
export function startPanelUsageReporter(role: PanelUsageSnapshot['role']): () => void {
  const write = async () => {
    const { db } = await import('../db/client');
    const { settings } = await import('../db/schema');
    const value: PanelUsageSnapshot = { role, at: new Date().toISOString(), usage: panelUsage() };
    await db
      .insert(settings)
      .values({ key: `panel-usage:${role}`, value })
      .onConflictDoUpdate({ target: settings.key, set: { value, updatedAt: new Date() } });
  };
  const timer = setInterval(() => void write().catch(() => {}), 30_000);
  timer.unref();
  void write().catch(() => {});
  return () => clearInterval(timer);
}

/** Stände beider Prozesse (nur aktuelle, höchstens 2 Minuten alt) */
export async function panelUsageSnapshots(): Promise<PanelUsageSnapshot[]> {
  const { db } = await import('../db/client');
  const { settings } = await import('../db/schema');
  const { inArray } = await import('drizzle-orm');
  const rows = await db.select().from(settings).where(inArray(settings.key, ['panel-usage:api', 'panel-usage:worker']));
  return rows
    .map((r) => r.value as PanelUsageSnapshot)
    .filter((s) => s && Date.now() - Date.parse(s.at) < 2 * 60_000);
}
