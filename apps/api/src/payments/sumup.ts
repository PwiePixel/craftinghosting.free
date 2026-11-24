/**
 * SumUp: gehostete Bezahlseite für Extras.
 *
 * Ablauf: Wir legen einen „Checkout“ an (Betrag, eindeutige Referenz) und schicken den Kunden auf die Bezahlseite von
 * SumUp. Nach der Zahlung ruft SumUp unsere Rückmelde-Adresse auf – die Nachricht enthält nur die ID. Ob wirklich
 * bezahlt wurde, fragen wir immer selbst bei SumUp ab (mit unserem geheimen Key); die Rückmeldung allein beweist nichts.
 * Zahlungsdaten (Karte, Konto) sehen und speichern wir nie.
 */
import { env } from '../env';

export const sumupConfigured = (): boolean => !!env.SUMUP_API_KEY && !!env.SUMUP_MERCHANT_CODE;

export interface SumupCheckout {
  id: string;
  status: 'PENDING' | 'PAID' | 'FAILED' | 'EXPIRED' | string;
  amount: number;
  currency: string;
  checkoutReference: string;
  merchantCode: string | null;
  hostedUrl: string | null;
  /** Mindestens eine erfolgreiche Zahlung hängt an diesem Checkout */
  hasSuccessfulTransaction: boolean;
}

export class SumupError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string | null = null,
  ) {
    super(message);
  }
}

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

async function request(method: 'GET' | 'POST', path: string, body?: unknown): Promise<Json> {
  let res: Response;
  try {
    res = await fetch(`${env.SUMUP_API_URL.replace(/\/$/, '')}${path}`, {
      method,
      headers: { Authorization: `Bearer ${env.SUMUP_API_KEY}`, Accept: 'application/json', ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });
  } catch (err) {
    throw new SumupError(`SumUp nicht erreichbar: ${(err as Error).message}`, 0);
  }
  const text = await res.text();
  let data: Json = {};
  try {
    data = text ? (JSON.parse(text) as Json) : {};
  } catch {
    /* keine JSON-Antwort */
  }
  if (!res.ok) throw new SumupError(`SumUp ${method} ${path.split('?')[0]} → ${res.status}: ${String(data.message ?? data.error_message ?? data.detail ?? res.statusText).slice(0, 200)}`, res.status, typeof data.error_code === 'string' ? data.error_code : null);
  return data;
}

function map(d: Json): SumupCheckout {
  const transactions: Json[] = Array.isArray(d.transactions) ? d.transactions : [];
  return {
    id: String(d.id ?? ''),
    status: String(d.status ?? ''),
    amount: Number(d.amount),
    currency: String(d.currency ?? ''),
    checkoutReference: String(d.checkout_reference ?? ''),
    merchantCode: typeof d.merchant_code === 'string' ? d.merchant_code : null,
    hostedUrl: typeof d.hosted_checkout_url === 'string' ? d.hosted_checkout_url : null,
    hasSuccessfulTransaction: transactions.some((t) => t?.status === 'SUCCESSFUL'),
  };
}

/** Bezahlseite anlegen. `reference` muss eindeutig sein (höchstens 64 Zeichen). */
export async function createSumupCheckout(input: { reference: string; amountCents: number; description: string; webhookUrl: string; redirectUrl: string }): Promise<SumupCheckout> {
  const data = await request('POST', '/v0.1/checkouts', {
    checkout_reference: input.reference.slice(0, 64),
    // SumUp erwartet den Betrag in Euro (nicht in Cent)
    amount: Math.round(input.amountCents) / 100,
    currency: 'EUR',
    merchant_code: env.SUMUP_MERCHANT_CODE,
    description: input.description.slice(0, 120),
    return_url: input.webhookUrl,
    redirect_url: input.redirectUrl,
    hosted_checkout: { enabled: true },
  });
  const checkout = map(data);
  if (!checkout.id || !checkout.hostedUrl) throw new SumupError('SumUp hat keine Bezahlseite geliefert (ist „Hosted Checkout“ für das Konto verfügbar?)', 502);
  return checkout;
}

export async function getSumupCheckout(id: string): Promise<SumupCheckout> {
  return map(await request('GET', `/v0.1/checkouts/${encodeURIComponent(id)}`));
}
