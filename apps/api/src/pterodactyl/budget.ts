/**
 * Kontingent für Panel-Aufrufe, die von Partnern (Partner-API) ausgelöst werden.
 *
 * Das Panel begrenzt Anfragen je API-Key – und alle unsere Aufrufe laufen über dieselben Keys. Ohne eigene Grenze
 * könnte ein Partner allein durch häufiges Abfragen das Kontingent aufbrauchen; dann kämen auch die Stopp-Befehle
 * unserer Hintergrund-Jobs nicht mehr durch (Laufzeit-Grenze, Lebenszeichen). Deshalb zählt jeder Panel-Aufruf aus
 * einer Partner-Anfrage gegen ein Kontingent je Partner und ein gemeinsames für alle Partner. Aufrufe der Jobs und
 * der Website sind davon nicht betroffen.
 */
import { AsyncLocalStorage } from 'node:async_hooks';
import { env } from '../env';
import { ApiError, L } from '../lib/errors';

const caller = new AsyncLocalStorage<{ partnerId: string }>();

class Bucket {
  private tokens: number;
  private at = Date.now();
  constructor(private readonly perMinute: number) {
    this.tokens = perMinute;
  }
  private refill() {
    const now = Date.now();
    this.tokens = Math.min(this.perMinute, this.tokens + ((now - this.at) / 60_000) * this.perMinute);
    this.at = now;
  }
  has(): boolean {
    this.refill();
    return this.tokens >= 1;
  }
  take() {
    this.tokens -= 1;
  }
  /** Sekunden, bis wieder ein Aufruf frei ist */
  waitSeconds(): number {
    return Math.max(1, Math.ceil(((1 - this.tokens) / this.perMinute) * 60));
  }
}

let all: Bucket | null = null;
const perPartner = new Map<string, Bucket>();

/** Führt `fn` als Anfrage eines Partners aus: Panel-Aufrufe darin zählen gegen dessen Kontingent */
export const asPartner = <T>(partnerId: string, fn: () => T): T => caller.run({ partnerId }, fn);

/** Führt `fn` ohne Kontingent aus – nur für Aufrufe, die eine Grenze durchsetzen (z. B. das Stoppen eines Servers) */
export const unbudgeted = <T>(fn: () => T): T => caller.exit(fn);

/** Vor jedem Panel-Aufruf: zählt ihn, wenn er aus einer Partner-Anfrage stammt */
export function takePanelCall(): void {
  const store = caller.getStore();
  if (!store) return;
  const total = env.PARTNER_PANEL_CALLS_PER_MINUTE;
  all ??= new Bucket(total);
  let own = perPartner.get(store.partnerId);
  if (!own) {
    // Ein einzelner Partner bekommt höchstens 80 % – so bleibt für die anderen immer etwas übrig
    own = new Bucket(Math.max(1, Math.floor(total * 0.8)));
    perPartner.set(store.partnerId, own);
  }
  const empty = !own.has() ? own : !all.has() ? all : null;
  if (empty) {
    throw new ApiError(429, 'panel_busy', L('Zu viele Anfragen an die Server-Verwaltung. Bitte kurz warten und seltener abfragen.', 'Too many requests to the server management. Please wait a moment and poll less often.'), { retryAfterSeconds: String(empty.waitSeconds()) });
  }
  own.take();
  all.take();
}
