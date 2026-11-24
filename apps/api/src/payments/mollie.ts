/**
 * Mollie: Online-Zahlung für Extras – einmalig oder als Abo.
 *
 * Ablauf einmalig: Wir legen eine Zahlung an (Betrag, Beschreibung, unsere Kennung in `metadata`) und schicken den
 * Kunden auf die Bezahlseite von Mollie. Mollie ruft danach unsere Rückmelde-Adresse auf – die Nachricht enthält nur
 * die ID der Zahlung. Ob wirklich bezahlt wurde, fragen wir immer selbst bei Mollie ab (mit unserem geheimen Key);
 * die Rückmeldung allein beweist nichts. Zahlungsdaten (Karte, Konto) sehen und speichern wir nie.
 *
 * Ablauf Abo: Die erste Zahlung läuft wie oben, aber mit einem „Kunden“ bei Mollie (`sequenceType: first`). Dabei
 * entsteht eine Einzugsermächtigung (Mandat). Jede Verlängerung stoßen wir selbst an (`sequenceType: recurring`) –
 * so bestimmt unser System, wann und ob abgebucht wird; endet das Abo, wird das Mandat widerrufen.
 * Den Kunden legen wir ohne Namen und E-Mail-Adresse an (nur mit unserem Verwendungszweck).
 */
import { env } from '../env';

export const mollieConfigured = (): boolean => !!env.MOLLIE_API_KEY;
/** Test-Schlüssel: Zahlungen laufen über die Testseite von Mollie, es fließt kein Geld */
export const mollieTestMode = (): boolean => !!env.MOLLIE_API_KEY && env.MOLLIE_API_KEY.startsWith('test_');

export type MollieStatus = 'open' | 'pending' | 'authorized' | 'paid' | 'canceled' | 'expired' | 'failed';

export interface MolliePayment {
  id: string;
  status: MollieStatus | string;
  /** Betrag in Cent */
  amountCents: number;
  currency: string;
  /** test | live */
  mode: string;
  /** Unsere Angaben zur Zahlung (Verwendungszweck der Buchung) */
  metadata: Record<string, unknown>;
  checkoutUrl: string | null;
  customerId: string | null;
  mandateId: string | null;
  sequenceType: string;
  /** Zurückgezahlt (Erstattung) bzw. von der Bank zurückgeholt (Rücklastschrift, Chargeback) – in Cent */
  refundedCents: number;
  chargedBackCents: number;
}

export class MollieError extends Error {
  constructor(
    message: string,
    /** HTTP-Status (0 = nicht erreichbar) */
    readonly status: number,
    readonly field: string | null = null,
  ) {
    super(message);
  }
}

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

async function request(method: 'GET' | 'POST' | 'DELETE', path: string, body?: unknown, idempotencyKey?: string): Promise<Json> {
  let res: Response;
  try {
    res = await fetch(`${env.MOLLIE_API_URL.replace(/\/$/, '')}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${env.MOLLIE_API_KEY}`,
        Accept: 'application/json',
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        // Dieselbe Anfrage zweimal (z. B. nach einer verlorenen Antwort) legt bei Mollie nichts doppelt an
        ...(idempotencyKey && method === 'POST' ? { 'Idempotency-Key': idempotencyKey } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });
  } catch (err) {
    throw new MollieError(`Mollie nicht erreichbar: ${(err as Error).message}`, 0);
  }
  if (res.status === 204) return {};
  const text = await res.text();
  let data: Json = {};
  try {
    data = text ? (JSON.parse(text) as Json) : {};
  } catch {
    /* keine JSON-Antwort */
  }
  if (!res.ok) throw new MollieError(`Mollie ${method} ${path.split('?')[0]} → ${res.status}: ${String(data.detail ?? data.title ?? res.statusText).slice(0, 200)}`, res.status, typeof data.field === 'string' ? data.field : null);
  return data;
}

/** „12.50“ → 1250 (ohne Rundungsfehler durch Kommazahlen) */
function toCents(value: unknown): number {
  const m = /^(\d+)(?:\.(\d{1,2}))?$/.exec(String(value ?? ''));
  if (!m) return NaN;
  return Number(m[1]) * 100 + Number((m[2] ?? '').padEnd(2, '0'));
}
const toValue = (cents: number): string => `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, '0')}`;
const amountCents = (a: unknown): number => (a && typeof a === 'object' ? toCents((a as Json).value) : 0);

function map(d: Json): MolliePayment {
  return {
    id: String(d.id ?? ''),
    status: String(d.status ?? ''),
    amountCents: amountCents(d.amount),
    currency: String(d.amount?.currency ?? ''),
    mode: String(d.mode ?? ''),
    metadata: d.metadata && typeof d.metadata === 'object' && !Array.isArray(d.metadata) ? (d.metadata as Record<string, unknown>) : {},
    checkoutUrl: typeof d._links?.checkout?.href === 'string' ? d._links.checkout.href : null,
    customerId: typeof d.customerId === 'string' ? d.customerId : null,
    mandateId: typeof d.mandateId === 'string' ? d.mandateId : null,
    sequenceType: String(d.sequenceType ?? 'oneoff'),
    refundedCents: amountCents(d.amountRefunded) || 0,
    chargedBackCents: amountCents(d.amountChargedBack) || 0,
  };
}

export interface CreatePaymentInput {
  amountCents: number;
  description: string;
  /** Unsere Kennung – kommt bei jeder Abfrage der Zahlung zurück */
  metadata: Record<string, string | number>;
  webhookUrl: string;
  /** Wohin der Kunde nach der Bezahlseite zurückkommt (entfällt bei Abbuchungen im Hintergrund) */
  redirectUrl?: string;
  locale?: 'de_DE' | 'en_US';
  /** oneoff = einmalig · first = erste Zahlung eines Abos (erzeugt das Mandat) · recurring = Abbuchung per Mandat */
  sequenceType?: 'oneoff' | 'first' | 'recurring';
  customerId?: string;
  mandateId?: string;
  idempotencyKey: string;
}

export async function createMolliePayment(input: CreatePaymentInput): Promise<MolliePayment> {
  const payment = map(
    await request(
      'POST',
      '/v2/payments',
      {
        amount: { currency: 'EUR', value: toValue(Math.round(input.amountCents)) },
        description: input.description.slice(0, 255),
        metadata: input.metadata,
        webhookUrl: input.webhookUrl,
        ...(input.redirectUrl ? { redirectUrl: input.redirectUrl } : {}),
        ...(input.locale ? { locale: input.locale } : {}),
        ...(input.sequenceType && input.sequenceType !== 'oneoff' ? { sequenceType: input.sequenceType } : {}),
        ...(input.customerId ? { customerId: input.customerId } : {}),
        ...(input.mandateId ? { mandateId: input.mandateId } : {}),
      },
      input.idempotencyKey,
    ),
  );
  if (!payment.id) throw new MollieError('Mollie hat keine Zahlung geliefert', 502);
  if (input.sequenceType !== 'recurring' && !payment.checkoutUrl) throw new MollieError('Mollie hat keine Bezahlseite geliefert', 502);
  return payment;
}

export async function getMolliePayment(id: string): Promise<MolliePayment> {
  return map(await request('GET', `/v2/payments/${encodeURIComponent(id)}`));
}

/** „Kunde“ bei Mollie für ein Abo – ohne Namen und E-Mail-Adresse, nur mit unserem Verwendungszweck */
export async function createMollieCustomer(metadata: Record<string, string>, idempotencyKey: string): Promise<string> {
  const d = await request('POST', '/v2/customers', { metadata }, idempotencyKey);
  if (typeof d.id !== 'string' || !d.id) throw new MollieError('Mollie hat keinen Kunden geliefert', 502);
  return d.id;
}

/** Nutzbares Mandat eines Kunden (falls die Zahlung selbst keines nennt) */
export async function findMollieMandate(customerId: string): Promise<string | null> {
  const d = await request('GET', `/v2/customers/${encodeURIComponent(customerId)}/mandates?limit=50`);
  const list: Json[] = Array.isArray(d._embedded?.mandates) ? d._embedded.mandates : [];
  const usable = list.find((m) => m?.status === 'valid') ?? list.find((m) => m?.status === 'pending');
  return typeof usable?.id === 'string' ? usable.id : null;
}

/** Mandat widerrufen: Danach lässt sich darüber nichts mehr abbuchen. Schon widerrufen oder unbekannt zählt als erledigt. */
export async function revokeMollieMandate(customerId: string, mandateId: string): Promise<void> {
  try {
    await request('DELETE', `/v2/customers/${encodeURIComponent(customerId)}/mandates/${encodeURIComponent(mandateId)}`);
  } catch (err) {
    if (err instanceof MollieError && (err.status === 404 || err.status === 410)) return;
    throw err;
  }
}
