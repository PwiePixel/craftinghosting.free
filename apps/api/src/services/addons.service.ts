/**
 * Extras (kostenpflichtige Add-ons) für kostenlose Server: bestellen, bezahlen, freischalten, verlängern, ablaufen.
 *
 * Grundsätze:
 *  – Bezahlt wird im Voraus für eine Laufzeit. Standard ist die einmalige Buchung: Ohne neue Zahlung endet das Extra
 *    von selbst, und für den Server gelten wieder die normalen Regeln des kostenlosen Angebots. Wahlweise als Abo:
 *    Dann bucht das System kurz vor dem Ende über die Einzugsermächtigung des Kunden ab, bis er kündigt.
 *  – Freigeschaltet wird nur durch eine bestätigte Zahlung: entweder prüft das System sie selbst beim Zahlungsdienst
 *    (Mollie – die Rückmeldung des Dienstes allein genügt nie), oder das Team bestätigt den Zahlungseingang.
 *    Holt die Bank eine Zahlung zurück (Rücklastschrift), endet das Extra.
 *  – Preis, Laufzeit und Wirkung kommen immer aus dem Katalog auf dem Server, nie aus der Anfrage des Kunden.
 *  – Ein Extra hebt nur auf, wofür es da ist: „24/7“ die Fair-Use-Pausen und den Zyklus. Sperren, Auszeiten, der
 *    Überlastschutz, die Discord-Pflicht und die Grenzen je Person gelten weiter (dieselben Schranken wie beim
 *    kostenlosen Reaktivieren).
 *  – Die Wirkung „24/7“ hängt an genau einer Stelle am Server (alwaysOnSince); ein Abgleich im Job stellt sicher, dass
 *    sie nie ohne laufende Buchung bestehen bleibt.
 */
import { randomInt } from 'node:crypto';
import { and, asc, count, desc, eq, gt, inArray, isNotNull, isNull, like, lte, ne, or, sql } from 'drizzle-orm';
import {
  ADMIN_PAGE_SIZE,
  NO_CYCLE_END,
  addonFits,
  addonRenewLeadDays,
  cycleEndFor,
  formatAddonPeriod,
  formatAddonPrice,
  formatDateTime,
  publicAddon,
  freeHostingConfig,
  type AddonOfferDTO,
  type AddonPaymentDTO,
  type AddonSetting,
  type AdminAddonRowDTO,
  type AdminAddonsDTO,
  type Locale,
  type PageInfo,
  type ServerAddonDTO,
  type ServerAddonsDTO,
  type SiteSettings,
} from '@chfree/shared';
import { affectedRows, db, isUniqueViolation, writeTx } from '../db/client';
import { addonPayments, auditLogs, notifications, serverAddons, servers, users, type Server, type ServerAddon, type User } from '../db/schema';
import { env } from '../env';
import { uuid } from '../lib/crypto';
import { ApiError, Errors, L } from '../lib/errors';
import { createMollieCustomer, createMolliePayment, findMollieMandate, getMolliePayment, listMollieCustomerPayments, mollieConfigured, MollieError, mollieTestMode, refundMolliePayment, revokeMollieMandate, type MolliePayment } from '../payments/mollie';
import { isAdmin } from '../plugins/auth';
import { pterodactyl } from '../pterodactyl';
import { audit } from './audit.service';
import { notify } from './notification.service';
import { trySyncPanelDescription } from './panel';
import { assertNoTimeout } from './sanction-gate';
import { fitsServerLimits, renewalBlock } from './server.service';
import { getSettings } from './settings.service';

const DAY_MS = 86_400_000;
/** So lange geben wir die Adresse einer offenen Bezahlseite ohne Rückfrage beim Zahlungsdienst wieder heraus */
const CHECKOUT_REUSE_MS = 10 * 60_000;
/** Offene Zahlungen fragen wir selbst nach, falls die Rückmeldung des Zahlungsdienstes ausbleibt: frische jede Minute, ältere seltener */
const POLL_RECENT_MS = 2 * 60 * 60_000;
const POLL_MAX_MS = 16 * DAY_MS;
/** Höchstzahl offener (unbezahlter) Bestellungen je Konto */
const MAX_PENDING_PER_USER = 5;
/** Ohne Online-Zahlung: Nachfrist, wenn der Kunde eine Verlängerung angekündigt hat (Zeit für die Bestätigung durch das Team) */
const MANUAL_GRACE_MS = 2 * DAY_MS;
/** Online: Nachfrist, solange die Bank eine angestoßene Zahlung noch verarbeitet (z. B. Lastschrift) */
const PROCESSING_GRACE_MS = 5 * DAY_MS;
/** So lange hält eine unbezahlte Bestellung einen Platz bei begrenzten Extras frei */
const stockHoldMs = (): number => (online() ? 60 * 60_000 : 2 * DAY_MS);

const tz = () => freeHostingConfig.fairUse.timezone;
const when = (d: Date, l: Locale) => formatDateTime(d, tz(), l);
const baseUrl = () => env.APP_URL.replace(/\/$/, '');
export const paymentWebhookUrl = () => `${baseUrl()}/api/v1/payments/mollie/webhook`;

/** Online-Zahlung eingerichtet (Mollie)? Sonst: Zahlungslink und Bestätigung durch das Team */
const online = (): boolean => mollieConfigured();

/**
 * Testbetrieb (Mollie-Schlüssel beginnt mit test_): Auf der Testseite von Mollie lässt sich „bezahlt“ einfach
 * anklicken, es fließt kein Geld. Deshalb dürfen dann nur Admins bestellen und bezahlen – sonst bekäme jeder Kunde
 * Extras umsonst. Testzahlungen sind eigens gekennzeichnet (mollie-test:…) und enden beim Wechsel auf den Live-Schlüssel.
 */
const testOnly = (user: Pick<User, 'role' | 'email'>): boolean => mollieTestMode() && !isAdmin(user);
const TEST_REF = 'mollie-test:%';

/** So lange sperrt eine zurückgeholte Zahlung (Rücklastschrift/Chargeback) weitere Bestellungen, bis das Team sie aufhebt */
const CHARGEBACK_BLOCK_MS = 180 * DAY_MS;

/**
 * Hat dieses Konto eine Zahlung zurückgeholt, ohne dass das Team die Sperre aufgehoben hat? Dann gibt es keine neuen
 * Extras – sonst ließe sich „bezahlen, nutzen, zurückholen“ beliebig wiederholen.
 */
async function chargebackBlocked(userId: string, now = new Date()): Promise<boolean> {
  const since = new Date(now.getTime() - CHARGEBACK_BLOCK_MS);
  const [last] = await db
    .select({ at: addonPayments.createdAt })
    .from(addonPayments)
    .where(and(eq(addonPayments.userId, userId), like(addonPayments.providerRef, '%:chargeback%'), gt(addonPayments.createdAt, since)))
    .orderBy(desc(addonPayments.createdAt))
    .limit(1);
  if (!last) return false;
  const [cleared] = await db
    .select({ id: addonPayments.id })
    .from(addonPayments)
    .where(and(eq(addonPayments.userId, userId), like(addonPayments.providerRef, 'chargeback-cleared:%'), gt(addonPayments.createdAt, last.at)))
    .limit(1);
  return !cleared;
}
const chargebackError = () => Errors.conflict('chargeback_block', L('Eine frühere Zahlung für ein Extra wurde von deiner Bank zurückgeholt. Bitte melde dich bei unserem Team, bevor du wieder ein Extra buchst.', 'An earlier payment for an extra was reversed by your bank. Please contact our team before booking an extra again.'));

/* ------------------------------------------------------------ Katalog */

const REF_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
const newRef = () => `CH-${Array.from({ length: 8 }, () => REF_ALPHABET[randomInt(REF_ALPHABET.length)]).join('')}`;

/** Stände, in denen ein Server ein Extra bekommen kann (nicht: wegen eines Verstoßes gesperrt, gelöscht, noch nicht angelegt) */
function orderable(server: Server): boolean {
  if (server.partnerId || !server.pteroServerId) return false;
  return server.status === 'active' || server.status === 'expiring' || (server.status === 'suspended' && server.suspensionReason === 'cycle_expired');
}

async function ownServer(user: Pick<User, 'id'>, serverId: string): Promise<Server> {
  const [server] = await db
    .select()
    .from(servers)
    .where(and(eq(servers.id, serverId), eq(servers.userId, user.id), ne(servers.status, 'deleted')))
    .limit(1);
  // Server der Partner-API gehören zum Konto des Partners und bekommen keine Extras
  if (!server || server.partnerId) throw Errors.notFound(L('Server nicht gefunden.', 'Server not found.'));
  return server;
}

async function ownRow(user: Pick<User, 'id'>, serverId: string, rowId: string): Promise<{ server: Server; row: ServerAddon }> {
  const server = await ownServer(user, serverId);
  const [row] = await db
    .select()
    .from(serverAddons)
    .where(and(eq(serverAddons.id, rowId), eq(serverAddons.serverId, server.id), eq(serverAddons.userId, user.id)))
    .limit(1);
  if (!row) throw Errors.notFound(L('Buchung nicht gefunden.', 'Booking not found.'));
  return { server, row };
}

/** Besitzer einer Buchung – null, wenn es das Konto nicht mehr gibt (Buchungen überleben das Löschen des Kontos) */
async function ownerOf(row: Pick<ServerAddon, 'userId'>): Promise<User | null> {
  const [user] = await db.select().from(users).where(eq(users.id, row.userId)).limit(1);
  return user ?? null;
}

/** Nachricht an den Kunden – nur, wenn es das Konto noch gibt */
async function tell(row: Pick<ServerAddon, 'userId'>, input: Omit<Parameters<typeof notify>[0], 'userId'>): Promise<boolean> {
  if (!(await ownerOf(row))) return false;
  return notify({ ...input, userId: row.userId });
}

type Tx = Parameters<Parameters<typeof writeTx>[0]>[0];

/**
 * Belegte Plätze eines begrenzten Extras: laufende Buchungen und frische, noch unbezahlte Bestellungen. Eine alte
 * unbezahlte Bestellung hält keinen Platz mehr frei – sonst ließe sich ein Extra kostenlos blockieren.
 */
async function occupied(addonId: string, q: Pick<Tx, 'select'> = db, now = new Date()): Promise<number> {
  const fresh = new Date(now.getTime() - stockHoldMs());
  const [r] = await q
    .select({ n: count() })
    .from(serverAddons)
    .where(and(eq(serverAddons.addonId, addonId), or(eq(serverAddons.status, 'active'), and(eq(serverAddons.status, 'pending'), or(gt(serverAddons.createdAt, fresh), gt(serverAddons.checkoutAt, fresh))))));
  return Number(r?.n ?? 0);
}

/* ------------------------------------------------------------ Ansicht für Kunden */

/** Läuft für diese Buchung gerade eine Zahlung, die der Kunde schon abgeschickt hat (Bank verarbeitet sie noch)? */
const processing = (row: ServerAddon): boolean => row.checkoutId !== null && row.checkoutUrl === null;
/** Abo mit gültiger Einzugsermächtigung */
const subscribed = (row: ServerAddon): boolean => row.autoRenew && row.mandateId !== null;

function paymentFor(row: ServerAddon, settings: SiteSettings, lang: Locale): AddonPaymentDTO | null {
  const due = row.status === 'pending' || (row.status === 'active' && row.renewalRequestedAt !== null);
  // Abbuchung eines Abos im Hintergrund: nichts zu tun, nur anzeigen
  if (!due && !(row.status === 'active' && processing(row))) return null;
  const deadline = row.status === 'pending' ? new Date(row.createdAt.getTime() + settings.addons.pendingDays * DAY_MS).toISOString() : null;
  if (online() || processing(row)) {
    const fresh = row.checkoutUrl && row.checkoutAt && Date.now() - row.checkoutAt.getTime() < CHECKOUT_REUSE_MS;
    return { mode: 'checkout', url: fresh ? row.checkoutUrl : null, reference: row.ref, amountCents: row.priceCents, note: '', processing: processing(row), deadline };
  }
  const addon = settings.addons.items.find((a) => a.id === row.addonId);
  return { mode: 'link', url: addon?.paymentUrl || null, reference: row.ref, amountCents: row.priceCents, note: settings.addons.paymentNote[lang] || settings.addons.paymentNote.de, processing: false, deadline };
}

/** Verlängern von Hand: läuft, hat ein Ende, ist noch im Angebot und passt noch zum Server. Abos verlängern sich selbst. */
function canRenew(row: ServerAddon, settings: SiteSettings, now: Date, server: Pick<Server, 'kind' | 'planId'> | null): boolean {
  if (row.status !== 'active' || !row.paidUntil || row.priceCents <= 0 || subscribed(row)) return false;
  const addon = settings.addons.items.find((a) => a.id === row.addonId);
  if (!settings.addons.enabled || !addon || !addon.enabled || addon.periodDays <= 0 || addon.priceCents <= 0) return false;
  if (!server || !addonFits(addon, server)) return false;
  // Nicht beliebig weit im Voraus: höchstens drei Laufzeiten
  return row.paidUntil.getTime() - now.getTime() < 3 * addon.periodDays * DAY_MS;
}

/** Nächste automatische Abbuchung eines Abos (null = kein Abo oder für diese Laufzeit schon angestoßen) */
function nextCharge(row: ServerAddon): Date | null {
  if (row.status !== 'active' || !subscribed(row) || !row.paidUntil) return null;
  if (row.renewFor && row.renewFor.getTime() === row.paidUntil.getTime()) return null;
  return new Date(row.paidUntil.getTime() - addonRenewLeadDays(row.periodDays) * DAY_MS);
}

function toDTO(row: ServerAddon, settings: SiteSettings, lang: Locale, now: Date, server: Pick<Server, 'kind' | 'planId'> | null): ServerAddonDTO {
  const renewable = canRenew(row, settings, now, server);
  const addon = settings.addons.items.find((a) => a.id === row.addonId);
  return {
    id: row.id,
    ref: row.ref,
    addonId: row.addonId,
    name: row.name[lang] || row.name.de,
    icon: row.icon as ServerAddonDTO['icon'],
    effect: row.effect,
    priceCents: row.priceCents,
    periodDays: row.periodDays,
    status: row.status,
    paidUntil: row.paidUntil?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    activatedAt: row.activatedAt?.toISOString() ?? null,
    endedAt: row.endedAt?.toISOString() ?? null,
    endReason: row.endReason,
    fulfilment: row.fulfilment,
    renewalRequested: row.renewalRequestedAt !== null,
    canRenew: renewable,
    canSubscribe: renewable && online() && !!addon?.subscription,
    autoRenew: row.autoRenew && row.status !== 'ended',
    nextChargeAt: nextCharge(row)?.toISOString() ?? null,
    subscriptionCanceledAt: row.subscriptionCanceledAt?.toISOString() ?? null,
    payment: paymentFor(row, settings, lang),
  };
}

async function viewFor(server: Server, lang: Locale, viewer: Pick<User, 'role' | 'email'>): Promise<ServerAddonsDTO> {
  const settings = await getSettings();
  const now = new Date();
  const rows = await db.select().from(serverAddons).where(eq(serverAddons.serverId, server.id)).orderBy(desc(serverAddons.createdAt)).limit(60);
  const open = rows.filter((r) => r.status !== 'ended');
  const ended = rows.filter((r) => r.status === 'ended').slice(0, 5);
  // Im Testbetrieb sehen nur Admins Angebote (siehe testOnly)
  const offered = settings.addons.enabled && !testOnly(viewer);
  const catalog = offered ? settings.addons.items.filter((a) => a.enabled && a.priceCents > 0 && addonFits(a, server)) : [];
  const offers: AddonOfferDTO[] = [];
  for (const a of catalog) {
    const booked = open.some((r) => r.addonId === a.id);
    const soldOut = !booked && a.maxActive !== null && (await occupied(a.id, db, now)) >= a.maxActive;
    offers.push({ ...publicAddon(a, online()), available: !booked && !soldOut && orderable(server), unavailable: booked ? 'booked' : soldOut ? 'sold_out' : null });
  }
  return {
    enabled: offered,
    priceNote: settings.addons.priceNote[lang] || settings.addons.priceNote.de,
    requireAdultConfirm: settings.addons.requireAdultConfirm,
    offers,
    booked: [...open, ...ended].map((r) => toDTO(r, settings, lang, now, server)),
  };
}

export async function listServerAddons(user: User, serverId: string, lang: Locale): Promise<ServerAddonsDTO> {
  return viewFor(await ownServer(user, serverId), lang, user);
}

/* ------------------------------------------------------------ Bestellen, verlängern, bezahlen */

export interface AddonConsent {
  acceptTerms: boolean;
  acceptEarlyStart: boolean;
  adult?: boolean;
  /** Abo: Zustimmung zur wiederkehrenden Abbuchung */
  acceptRecurring?: boolean;
}

/** Was der Kunde bestellt – Preis und Laufzeit dienen nur dem Abgleich mit dem, was er gesehen hat */
export interface AddonOrderInput {
  consent: AddonConsent;
  subscribe?: boolean;
  priceCents?: number;
  periodDays?: number;
}

function assertConsent(c: AddonConsent, settings: SiteSettings, subscribe: boolean): void {
  const fields: Record<string, ReturnType<typeof L>> = {};
  if (c.acceptTerms !== true) fields.acceptTerms = L('Bitte stimme den Bedingungen zu.', 'Please accept the terms.');
  if (c.acceptEarlyStart !== true) fields.acceptEarlyStart = L('Bitte bestätige, dass wir sofort mit der Leistung beginnen dürfen.', 'Please confirm that we may start the service immediately.');
  if (settings.addons.requireAdultConfirm && c.adult !== true) fields.adult = L('Bitte bestätige, dass du volljährig bist oder die Zustimmung deiner Erziehungsberechtigten hast.', 'Please confirm that you are of legal age or have the consent of your legal guardian.');
  if (subscribe && c.acceptRecurring !== true) fields.acceptRecurring = L('Bitte stimme der wiederkehrenden Abbuchung zu.', 'Please agree to the recurring charge.');
  if (Object.keys(fields).length) throw Errors.badRequest('consent_required', L('Bitte bestätige die Angaben zum Kauf.', 'Please confirm the purchase details.'), fields);
}

const disabled = () => Errors.conflict('addons_disabled', L('Extras sind derzeit nicht buchbar.', 'Extras cannot be booked at the moment.'));

function catalogItem(settings: SiteSettings, addonId: string, server: Server): AddonSetting {
  if (!settings.addons.enabled) throw disabled();
  const addon = settings.addons.items.find((a) => a.id === addonId);
  if (!addon || !addon.enabled || addon.priceCents <= 0 || !addonFits(addon, server)) {
    throw Errors.conflict('addon_unavailable', L('Dieses Extra ist für diesen Server nicht buchbar.', 'This extra cannot be booked for this server.'));
  }
  return addon;
}

/** Der Kunde hat einen anderen Preis oder eine andere Laufzeit gesehen, als jetzt gilt: nicht stillschweigend bestellen */
function assertSeen(addon: AddonSetting, input: AddonOrderInput): void {
  if ((input.priceCents !== undefined && input.priceCents !== addon.priceCents) || (input.periodDays !== undefined && input.periodDays !== addon.periodDays)) {
    throw Errors.conflict('price_changed', L('Preis oder Laufzeit haben sich gerade geändert. Bitte prüfe die Angaben und bestelle erneut.', 'The price or term has just changed. Please check the details and order again.'));
  }
}

const BLOCK_TEXT = {
  locked: L('Dein Konto ist gesperrt – Extras lassen sich nicht buchen.', 'Your account is locked – extras cannot be booked.'),
  timeout: L('Wegen einer Verwarnung sind deine Dienste gerade offline. So lange lassen sich keine Extras buchen.', 'Because of a warning your services are offline right now. Until then no extras can be booked.'),
  discord: L('Für dieses Extra musst du dein Discord-Konto verknüpft haben und Mitglied auf unserem Discord-Server sein.', 'For this extra you need to have your Discord account linked and be a member of our Discord server.'),
  discord_unavailable: L('Deine Discord-Mitgliedschaft lässt sich gerade nicht prüfen. Bitte versuche es gleich noch einmal.', 'Your Discord membership cannot be checked right now. Please try again shortly.'),
  limit: L('Dieser Server gehörte zu einer Boost-Belohnung, die nicht mehr aktiv ist. Das Extra lässt sich buchen, sobald du unseren Discord-Server wieder boostest.', 'This server was part of a boost reward that is no longer active. You can book the extra as soon as you boost our Discord server again.'),
};

/** „24/7“ hebt den Zyklus auf – deshalb gelten beim Buchen und Verlängern dieselben Schranken wie beim Reaktivieren */
async function assertAlwaysOnAllowed(user: User, server: Server): Promise<void> {
  // Streng (Discord nicht prüfbar = warten) nur, wenn dabei eine Zyklus-Sperre aufgehoben würde – ein laufender Server
  // soll an einem kurzen Ausfall von Discord nicht scheitern
  const held = server.status === 'expiring' || (server.status === 'suspended' && server.suspensionReason === 'cycle_expired');
  const block = await renewalBlock(user, server, new Date(), { strict: held });
  if (block) throw Errors.conflict(block === 'limit' ? 'boost_reward_ended' : block === 'discord' ? 'discord_required' : block === 'discord_unavailable' ? 'discord_unavailable' : 'account_blocked', BLOCK_TEXT[block]);
}

const paymentUnavailable = () => new ApiError(503, 'payment_unavailable', L('Die Bezahlseite ist gerade nicht erreichbar. Bitte versuche es gleich noch einmal.', 'The payment page is not available right now. Please try again shortly.'));

/**
 * Bezahlweg für eine offene Bestellung bzw. Verlängerung öffnen. Online: Zahlung beim Zahlungsdienst anlegen und die
 * Adresse der Bezahlseite zurückgeben. Eine noch offene Zahlung wird wiederverwendet (nie zwei offene Zahlungen für
 * dieselbe Buchung). Ohne Online-Zahlung: null – dann gilt der Zahlungslink aus den Einstellungen.
 */
async function openCheckout(row: ServerAddon, lang: Locale): Promise<string | null> {
  if (!online()) return null;
  if (row.checkoutId) {
    if (row.checkoutUrl && row.checkoutAt && Date.now() - row.checkoutAt.getTime() < CHECKOUT_REUSE_MS) return row.checkoutUrl;
    const state = await checkAddonPayment(row.id);
    if (state === 'paid') return null;
    if (state === 'processing') throw Errors.conflict('payment_processing', L('Deine Zahlung wird gerade verarbeitet. Das Extra wird freigeschaltet, sobald sie bestätigt ist.', 'Your payment is being processed. The extra is activated as soon as it is confirmed.'));
    if (unsure(state)) throw paymentUnavailable();
    if (state === 'open' && row.checkoutUrl) return row.checkoutUrl;
    const [fresh] = await db.select().from(serverAddons).where(eq(serverAddons.id, row.id)).limit(1);
    if (!fresh || !(fresh.status === 'pending' || (fresh.status === 'active' && fresh.renewalRequestedAt !== null))) return null;
    row = fresh;
  }
  // Nummer des Versuchs zuerst vergeben: Dieselbe Anfrage legt beim Zahlungsdienst nie zwei Zahlungen an
  const [reserved] = await db.update(serverAddons).set({ checkoutCount: sql`${serverAddons.checkoutCount} + 1` }).where(eq(serverAddons.id, row.id)).returning({ n: serverAddons.checkoutCount });
  const n = reserved?.n ?? row.checkoutCount + 1;
  let payment: MolliePayment;
  try {
    // Abo: Die erste Zahlung läuft über einen „Kunden“ beim Zahlungsdienst – dabei entsteht die Einzugsermächtigung
    let customerId = row.customerId;
    const first = row.autoRenew && !row.mandateId;
    if (first && !customerId) {
      customerId = await createMollieCustomer({ ref: row.ref }, `customer:${row.id}`);
      await db.update(serverAddons).set({ customerId }).where(eq(serverAddons.id, row.id));
    }
    payment = await createMolliePayment({
      amountCents: row.priceCents,
      description: `${row.name[lang] || row.name.de} (${row.ref})`,
      metadata: { ref: row.ref, booking: row.id },
      webhookUrl: paymentWebhookUrl(),
      redirectUrl: `${baseUrl()}/api/v1/payments/return?s=${encodeURIComponent(row.serverId)}&lang=${lang}`,
      locale: lang === 'de' ? 'de_DE' : 'en_US',
      ...(first && customerId ? { sequenceType: 'first' as const, customerId } : {}),
      idempotencyKey: `pay:${row.id}:${n}`,
    });
  } catch (err) {
    console.warn('[addons] Zahlung konnte nicht angelegt werden:', (err as Error).message);
    throw paymentUnavailable();
  }
  await db.update(serverAddons).set({ checkoutId: payment.id, checkoutUrl: payment.checkoutUrl, checkoutAt: new Date() }).where(eq(serverAddons.id, row.id));
  return payment.checkoutUrl;
}

export async function orderAddon(user: User, serverId: string, addonId: string, input: AddonOrderInput, lang: Locale, ip?: string): Promise<{ addons: ServerAddonsDTO; orderId: string; checkoutUrl: string | null }> {
  assertNoTimeout(user);
  const server = await ownServer(user, serverId);
  const settings = await getSettings();
  if (testOnly(user)) throw disabled();
  const addon = catalogItem(settings, addonId, server);
  if (await chargebackBlocked(user.id)) throw chargebackError();
  const subscribe = input.subscribe === true;
  if (subscribe && !(online() && addon.subscription && addon.periodDays > 0)) throw Errors.conflict('subscription_unavailable', L('Dieses Extra gibt es gerade nicht als Abo.', 'This extra is not available as a subscription right now.'));
  assertConsent(input.consent, settings, subscribe);
  assertSeen(addon, input);
  if (!orderable(server)) throw Errors.conflict('server_not_eligible', L('Für diesen Server lassen sich gerade keine Extras buchen (gesperrt oder noch nicht eingerichtet).', 'Extras cannot be booked for this server right now (suspended or not set up yet).'));
  if (addon.effect === 'always_on') await assertAlwaysOnAllowed(user, server);

  const id = uuid();
  const now = new Date();
  // Prüfen und anlegen in einer Transaktion: zwei gleichzeitige Bestellungen dürfen die Höchstzahl nicht überschreiten
  await writeTx(async (tx) => {
    const [same] = await tx
      .select({ id: serverAddons.id })
      .from(serverAddons)
      .where(and(eq(serverAddons.serverId, server.id), eq(serverAddons.addonId, addon.id), inArray(serverAddons.status, ['pending', 'active'])))
      .limit(1);
    if (same) throw Errors.conflict('already_booked', L('Dieses Extra ist für diesen Server schon gebucht bzw. bestellt.', 'This extra is already booked or ordered for this server.'));
    const [pending] = await tx
      .select({ n: count() })
      .from(serverAddons)
      .where(and(eq(serverAddons.userId, user.id), eq(serverAddons.status, 'pending')));
    if (Number(pending?.n ?? 0) >= MAX_PENDING_PER_USER) throw Errors.conflict('too_many_pending', L('Du hast schon mehrere unbezahlte Bestellungen. Bitte bezahle oder storniere sie zuerst.', 'You already have several unpaid orders. Please pay or cancel them first.'));
    if (addon.maxActive !== null && (await occupied(addon.id, tx, now)) >= addon.maxActive) throw Errors.conflict('sold_out', L('Dieses Extra ist gerade ausgebucht.', 'This extra is fully booked at the moment.'));
    for (let attempt = 0; ; attempt++) {
      try {
        await tx.insert(serverAddons).values({ id, ref: newRef(), userId: user.id, serverId: server.id, addonId: addon.id, name: addon.name, icon: addon.icon, effect: addon.effect, priceCents: addon.priceCents, periodDays: addon.periodDays, status: 'pending', autoRenew: subscribe, consentAt: now });
        break;
      } catch (err) {
        if (!isUniqueViolation(err) || attempt >= 4) throw err;
      }
    }
  });
  const [row] = await db.select().from(serverAddons).where(eq(serverAddons.id, id)).limit(1);
  await audit({ userId: user.id, serverId: server.id, actor: 'user', action: 'addon.ordered', message: `Extra „${addon.name.de}“ für „${server.name}“ bestellt${subscribe ? ' (als Abo)' : ''} (${formatAddonPrice(addon.priceCents, 'de')}, ${formatAddonPeriod(addon.periodDays, 'de')}, Verwendungszweck ${row!.ref})`, ip });
  let checkoutUrl: string | null = null;
  try {
    checkoutUrl = await openCheckout(row!, lang);
  } catch {
    // Die Bestellung steht – bezahlt wird dann über „Jetzt bezahlen“ in der Liste
  }
  return { addons: await viewFor(server, lang, user), orderId: id, checkoutUrl };
}

/** „Jetzt bezahlen“ für eine offene Bestellung oder angefragte Verlängerung */
export async function payAddon(user: User, serverId: string, rowId: string, lang: Locale): Promise<{ addons: ServerAddonsDTO; checkoutUrl: string | null }> {
  assertNoTimeout(user);
  const { server, row } = await ownRow(user, serverId, rowId);
  const open = row.status === 'pending' || (row.status === 'active' && row.renewalRequestedAt !== null);
  if (!open) throw Errors.conflict('nothing_to_pay', L('Für diese Buchung ist keine Zahlung offen.', 'No payment is due for this booking.'));
  if (!orderable(server)) throw Errors.conflict('server_not_eligible', L('Für diesen Server lassen sich gerade keine Extras bezahlen (gesperrt).', 'Extras cannot be paid for this server right now (suspended).'));
  if (testOnly(user)) throw disabled();
  if (await chargebackBlocked(user.id)) throw chargebackError();
  // Zwischen Bestellen und Bezahlen kann sich etwas geändert haben: dieselben Prüfungen noch einmal
  const settings = await getSettings();
  const addon = settings.addons.items.find((a) => a.id === row.addonId);
  if (row.status === 'pending') {
    catalogItem(settings, row.addonId, server);
    // Der Platz einer alten unbezahlten Bestellung ist nicht mehr reserviert – erst prüfen, dann Geld nehmen
    if (addon && addon.maxActive !== null && Date.now() - row.createdAt.getTime() > stockHoldMs()) {
      const [used] = await db
        .select({ n: count() })
        .from(serverAddons)
        .where(and(eq(serverAddons.addonId, row.addonId), ne(serverAddons.id, row.id), or(eq(serverAddons.status, 'active'), and(eq(serverAddons.status, 'pending'), gt(serverAddons.createdAt, new Date(Date.now() - stockHoldMs()))))));
      if (Number(used?.n ?? 0) >= addon.maxActive) throw Errors.conflict('sold_out', L('Dieses Extra ist inzwischen ausgebucht. Du kannst die Bestellung stornieren und es später erneut versuchen.', 'This extra is fully booked by now. You can cancel the order and try again later.'));
    }
  }
  if (row.effect === 'always_on') await assertAlwaysOnAllowed(user, server);
  const checkoutUrl = await openCheckout(row, lang);
  return { addons: await viewFor(server, lang, user), checkoutUrl };
}

/** Verlängerung anfragen: gilt zum aktuellen Preis des Katalogs und schließt an die laufende Zeit an – wahlweise ab jetzt als Abo */
export async function renewAddon(user: User, serverId: string, rowId: string, input: AddonOrderInput, lang: Locale, ip?: string): Promise<{ addons: ServerAddonsDTO; checkoutUrl: string | null }> {
  assertNoTimeout(user);
  const { server, row } = await ownRow(user, serverId, rowId);
  const settings = await getSettings();
  if (!canRenew(row, settings, new Date(), server)) throw Errors.conflict('not_renewable', L('Diese Buchung lässt sich gerade nicht verlängern.', 'This booking cannot be renewed right now.'));
  if (testOnly(user)) throw disabled();
  if (await chargebackBlocked(user.id)) throw chargebackError();
  const addon = catalogItem(settings, row.addonId, server);
  const subscribe = input.subscribe === true;
  if (subscribe && !(online() && addon.subscription && addon.periodDays > 0)) throw Errors.conflict('subscription_unavailable', L('Dieses Extra gibt es gerade nicht als Abo.', 'This extra is not available as a subscription right now.'));
  assertConsent(input.consent, settings, subscribe);
  assertSeen(addon, input);
  if (addon.effect === 'always_on') await assertAlwaysOnAllowed(user, server);
  // Läuft schon eine Zahlung, erst deren Ergebnis holen (sonst zwei Zahlungen für dieselbe Verlängerung)
  if (row.checkoutId) {
    const state = await checkAddonPayment(row.id);
    if (state === 'paid' || state === 'processing') return { addons: await viewFor(server, lang, user), checkoutUrl: null };
    if (unsure(state)) throw paymentUnavailable();
  }
  // Eine alte, noch nicht widerrufene Einzugsermächtigung (gekündigtes Abo) zuerst loswerden – ein neues Abo bekommt eine neue
  if (row.mandateId) {
    await revokeMandate(row);
    const [again] = await db.select({ mandateId: serverAddons.mandateId }).from(serverAddons).where(eq(serverAddons.id, row.id)).limit(1);
    if (again?.mandateId && subscribe) throw paymentUnavailable();
  }
  // Preis oder Laufzeit haben sich geändert: Die Verlängerung gilt zu den neuen Bedingungen
  const res = await db
    .update(serverAddons)
    .set({ renewalRequestedAt: new Date(), priceCents: addon.priceCents, periodDays: addon.periodDays, consentAt: new Date(), autoRenew: subscribe, subscriptionCanceledAt: null, checkoutId: null, checkoutUrl: null, checkoutAt: null })
    .where(and(eq(serverAddons.id, row.id), eq(serverAddons.status, 'active')));
  if (affectedRows(res) !== 1) throw Errors.conflict('state_changed', L('Der Stand hat sich geändert. Bitte lade die Seite neu.', 'The state has changed. Please reload the page.'));
  const [fresh] = await db.select().from(serverAddons).where(eq(serverAddons.id, row.id)).limit(1);
  await audit({ userId: user.id, serverId: server.id, actor: 'user', action: 'addon.renewal_requested', message: `Verlängerung von „${row.name.de}“ für „${server.name}“ angefragt${subscribe ? ' (als Abo)' : ''} (${formatAddonPrice(addon.priceCents, 'de')}, Verwendungszweck ${row.ref})`, ip });
  let checkoutUrl: string | null = null;
  try {
    checkoutUrl = await openCheckout(fresh!, lang);
  } catch {
    /* Bezahlen später über „Jetzt bezahlen“ */
  }
  return { addons: await viewFor(server, lang, user), checkoutUrl };
}

/** Offene Bestellung stornieren bzw. angefragte Verlängerung zurücknehmen (nichts bezahlt → nichts zu erstatten) */
export async function cancelAddonOrder(user: User, serverId: string, rowId: string, lang: Locale, ip?: string): Promise<ServerAddonsDTO> {
  const { server, row } = await ownRow(user, serverId, rowId);
  // Läuft gerade eine Zahlung, erst deren Ergebnis holen – eine bezahlte oder abgeschickte Zahlung wird nie storniert
  if (row.checkoutId) {
    const state = await checkAddonPayment(row.id);
    if (state === 'processing') throw Errors.conflict('payment_processing', L('Deine Zahlung wird gerade verarbeitet – stornieren geht jetzt nicht mehr.', 'Your payment is being processed – cancelling is no longer possible.'));
    if (unsure(state)) throw paymentUnavailable();
  }
  const [now] = await db.select().from(serverAddons).where(eq(serverAddons.id, row.id)).limit(1);
  if (now?.status === 'pending') {
    if (await endAddon(now, 'canceled', { silent: true })) await audit({ userId: user.id, serverId: server.id, actor: 'user', action: 'addon.canceled', message: `Bestellung „${row.name.de}“ (${row.ref}) storniert`, ip });
  } else if (now?.status === 'active' && now.renewalRequestedAt) {
    // Auch ein mit der Verlängerung gewünschtes Abo entfällt (es gibt noch keine Einzugsermächtigung)
    await db
      .update(serverAddons)
      .set({ renewalRequestedAt: null, checkoutId: null, checkoutUrl: null, checkoutAt: null, ...(now.mandateId ? {} : { autoRenew: false }) })
      .where(and(eq(serverAddons.id, row.id), eq(serverAddons.status, 'active'), isNotNull(serverAddons.renewalRequestedAt)));
  }
  return viewFor(server, lang, user);
}

/* ------------------------------------------------------------ Zahlung bestätigen */

type PaymentSource = {
  provider: 'manual' | 'mollie' | 'admin';
  providerRef: string | null;
  amountCents: number;
  confirmedBy: string;
  periodDays?: number;
  /** Abo: Kunde und Einzugsermächtigung aus der ersten Zahlung */
  mandate?: { customerId: string | null; mandateId: string | null };
};
/**
 * applied = freigeschaltet bzw. verlängert · duplicate = diese Zahlung war schon verbucht · mismatch = Betrag passt
 * nicht zur Buchung · stale = Buchung nimmt keine Zahlung mehr an · orphan = Server/Buchung gibt es nicht mehr.
 * Bei mismatch, stale und orphan ist die Zahlung verbucht, aber nichts freigeschaltet – das Team erstattet.
 */
type ApplyOutcome = 'applied' | 'duplicate' | 'mismatch' | 'stale' | 'orphan';

/**
 * Bestätigte Zahlung verbuchen und das Extra freischalten bzw. verlängern. Jede Zahlung des Zahlungsdienstes zählt
 * genau einmal (eindeutige providerRef). Ob die Buchung die Zahlung überhaupt (noch) annimmt, wird in derselben
 * Transaktion am aktuellen Stand geprüft – nicht an dem, den der Aufrufer vorher gelesen hat.
 */
async function applyPayment(rowId: string, pay: PaymentSource): Promise<ApplyOutcome> {
  const now = new Date();
  const settings = await getSettings();
  let outcome = 'applied' as ApplyOutcome;
  let activated = false;
  let oversold = false;
  let noMandate = false;
  let row: ServerAddon | undefined;
  let server: Server | undefined;
  await writeTx(async (tx) => {
    [row] = await tx.select().from(serverAddons).where(eq(serverAddons.id, rowId)).limit(1);
    if (!row) {
      outcome = 'orphan';
      return;
    }
    const current = row;
    [server] = await tx.select().from(servers).where(eq(servers.id, current.serverId)).limit(1);
    const serverGone = !server || server.status === 'deleted';
    const addon = settings.addons.items.find((a) => a.id === current.addonId);

    // Nimmt die Buchung diese Zahlung an?
    let accept = true;
    let full = false;
    if (current.status === 'ended') {
      // Nachträglich bezahlt (z. B. nach dem Stornieren oder Verfallen): wieder aufnehmen, wenn nichts dagegen spricht
      const [other] = await tx
        .select({ id: serverAddons.id })
        .from(serverAddons)
        .where(and(eq(serverAddons.serverId, current.serverId), eq(serverAddons.addonId, current.addonId), inArray(serverAddons.status, ['pending', 'active']), ne(serverAddons.id, current.id)))
        .limit(1);
      accept = !other && (current.endReason === 'unpaid' || current.endReason === 'canceled' || (pay.provider === 'mollie' && current.endReason === 'expired'));
    } else if (current.status === 'active' && pay.provider === 'manual' && current.renewalRequestedAt === null) {
      // Bestätigung von Hand ohne offene Zahlung (doppelter Klick, veraltete Seite): nichts tun
      accept = false;
    }
    if (current.status !== 'active' && addon && addon.maxActive !== null) {
      const [used] = await tx
        .select({ n: count() })
        .from(serverAddons)
        .where(and(eq(serverAddons.addonId, current.addonId), eq(serverAddons.status, 'active'), ne(serverAddons.id, current.id)));
      full = Number(used?.n ?? 0) >= addon.maxActive;
    }
    if (pay.provider === 'manual') {
      if (!accept) throw Errors.conflict('nothing_to_pay', L('Für diese Buchung ist keine Zahlung offen (schon bestätigt oder beendet). Bitte lade die Seite neu.', 'No payment is due for this booking (already confirmed or ended). Please reload the page.'));
      if (serverGone) throw Errors.conflict('server_gone', L('Den Server gibt es nicht mehr.', 'The server no longer exists.'));
      if (full && current.status === 'ended') throw Errors.conflict('sold_out', L('Dieses Extra ist inzwischen ausgebucht. Erhöhe die Höchstzahl oder erstatte die Zahlung.', 'This extra is fully booked by now. Raise the maximum or refund the payment.'));
    }

    const periodDays = pay.periodDays ?? current.periodDays;
    try {
      await tx.insert(addonPayments).values({ id: uuid(), serverAddonId: current.id, ref: current.ref, userId: current.userId, serverId: current.serverId, addonId: current.addonId, addonName: current.name.de, amountCents: pay.amountCents, periodDays, provider: pay.provider, providerRef: pay.providerRef, confirmedBy: pay.confirmedBy });
    } catch (err) {
      if (isUniqueViolation(err)) {
        outcome = 'duplicate';
        return;
      }
      throw err;
    }
    // Verbucht ist die Zahlung jetzt in jedem Fall. Freigeschaltet wird nur, wenn alles passt – sonst erstattet das Team.
    if (serverGone) {
      outcome = 'orphan';
      return;
    }
    if (pay.provider === 'mollie' && pay.amountCents !== current.priceCents) {
      outcome = 'mismatch';
      return;
    }
    if (!accept) {
      outcome = 'stale';
      return;
    }
    oversold = full;
    // Eine laufende Buchung wird ab ihrem Ende verlängert – auch wenn das Ende schon kurz zurückliegt (Nachfrist):
    // So ist jede Nachfrist mitbezahlt und nie geschenkt.
    const base = current.status === 'active' && current.paidUntil !== null ? current.paidUntil : now;
    const unlimited = current.status === 'active' && current.paidUntil === null;
    const paidUntil = periodDays > 0 && !unlimited ? new Date(Math.max(base.getTime() + periodDays * DAY_MS, now.getTime() + 60_000)) : null;
    activated = current.status !== 'active';
    const fulfilment = current.effect !== 'manual' ? 'none' : current.fulfilment === 'none' ? 'todo' : current.fulfilment === 'revoke' ? 'done' : current.fulfilment;
    // Abo nur mit Einzugsermächtigung – ohne sie bleibt es bei der einmaligen Laufzeit. Eine Ermächtigung, die bei der
    // Zahlung entstanden ist, obwohl das Abo inzwischen abgewählt wurde, wird gemerkt und vom Job widerrufen.
    const mandateId = pay.mandate?.mandateId ?? current.mandateId;
    const customerId = pay.mandate?.customerId ?? current.customerId;
    const autoRenew = current.autoRenew && mandateId !== null && paidUntil !== null;
    noMandate = current.autoRenew && !autoRenew;
    await tx
      .update(serverAddons)
      .set({ status: 'active', paidUntil, activatedAt: current.activatedAt && !activated ? current.activatedAt : now, renewalRequestedAt: null, checkoutId: null, checkoutUrl: null, checkoutAt: null, renewFor: null, endedAt: null, endReason: null, fulfilment, autoRenew, mandateId, customerId })
      .where(eq(serverAddons.id, current.id));
    row = { ...current, status: 'active', paidUntil, fulfilment, autoRenew, mandateId, customerId };
  });
  if (!row) return 'orphan';
  const paid = formatAddonPrice(pay.amountCents, 'de');
  if (outcome === 'duplicate') return outcome;
  // Verbucht, aber nichts geliefert: kennzeichnen – so wird die Zahlung erstattet (und die Erstattung nachgeholt, falls sie nicht klappt)
  if ((outcome === 'orphan' || outcome === 'stale' || outcome === 'mismatch') && pay.providerRef) {
    await db.update(addonPayments).set({ confirmedBy: UNDELIVERED }).where(eq(addonPayments.providerRef, pay.providerRef));
  }
  if (outcome === 'orphan' || outcome === 'stale') {
    await audit({ userId: row.userId, serverId: row.serverId, actor: 'system', action: 'addon.payment_orphan', message: `Zahlung für „${row.name.de}“ (${row.ref}, ${paid}) eingegangen, aber ${outcome === 'orphan' ? 'den Server gibt es nicht mehr' : 'die Buchung ist beendet bzw. durch eine neue ersetzt'} – nichts freigeschaltet, wird automatisch erstattet` });
    return outcome;
  }
  if (outcome === 'mismatch') {
    await audit({ userId: row.userId, serverId: row.serverId, actor: 'system', action: 'addon.payment_mismatch', message: `Zahlung für „${row.name.de}“ (${row.ref}): bezahlt ${paid}, Preis der Buchung ${formatAddonPrice(row.priceCents, 'de')} – nichts freigeschaltet, wird automatisch erstattet` });
    return outcome;
  }
  if (oversold) await audit({ userId: row.userId, serverId: row.serverId, actor: 'system', action: 'addon.oversold', message: `Extra „${row.name.de}“ (${row.ref}) wurde bezahlt, obwohl die Höchstzahl schon erreicht war – bitte prüfen (einrichten oder erstatten)` });
  if (noMandate) await audit({ userId: row.userId, serverId: row.serverId, actor: 'system', action: 'addon.subscription_unavailable', message: `Extra „${row.name.de}“ (${row.ref}): Die Zahlung kam ohne Einzugsermächtigung – es läuft einmalig statt als Abo` });
  let waiting = false;
  if (row.effect === 'always_on') {
    const block = await activateAlwaysOn(row.serverId, now);
    waiting = block !== null;
    if (block) await audit({ userId: row.userId, serverId: row.serverId, actor: 'system', action: 'addon.always_on_waiting', message: `Extra „${row.name.de}“ (${row.ref}) ist bezahlt, der Server bleibt aber vorerst gesperrt (${BLOCK_AUDIT[block]}) – „24/7“ greift, sobald das Hindernis wegfällt` });
  }
  const until = row.paidUntil;
  const sub = row.autoRenew;
  await audit({
    userId: row.userId,
    serverId: row.serverId,
    actor: pay.provider === 'mollie' ? 'system' : 'admin',
    action: activated ? 'addon.activated' : 'addon.renewed',
    message: `Extra „${row.name.de}“ (${row.ref}) für „${server!.name}“ ${activated ? 'freigeschaltet' : 'verlängert'}${until ? ` bis ${when(until, 'de')}` : ' (unbefristet)'}${sub ? ' – Abo' : ''} – ${pay.provider === 'admin' ? 'kostenlos vom Team' : `Zahlung ${paid}`} (${pay.confirmedBy})`,
  });
  await tell(row, {
    serverId: row.serverId,
    type: activated ? 'addon.activated' : 'addon.renewed',
    title: activated ? L(`Extra aktiv: ${row.name.de}`, `Extra active: ${row.name.en || row.name.de}`) : L(`Extra verlängert: ${row.name.de}`, `Extra renewed: ${row.name.en || row.name.de}`),
    body: (l) => {
      const name = row!.name[l] || row!.name.de;
      const till = until ? when(until, l) : null;
      const manual = row!.effect === 'manual' && row!.fulfilment === 'todo';
      const cancelUrl = `${baseUrl()}${l === 'de' ? '/de/kuendigen' : '/cancel-subscription'}`;
      const next = nextCharge(row!);
      const renewal = sub
        ? l === 'en'
          ? `\nThis is a subscription: it renews automatically for ${formatAddonPeriod(row!.periodDays, l)} at ${formatAddonPrice(row!.priceCents, l)}${next ? ` (next charge around ${when(next, l)})` : ''}. You can cancel at any time under “My servers” → Manage → Extras or at ${cancelUrl} – it then runs until the end of the paid term.`
          : `\nDas ist ein Abo: Es verlängert sich automatisch um ${formatAddonPeriod(row!.periodDays, l)} zum Preis von ${formatAddonPrice(row!.priceCents, l)}${next ? ` (nächste Abbuchung etwa am ${when(next, l)})` : ''}. Kündigen kannst du jederzeit unter „Meine Server“ → Verwalten → Extras oder auf ${cancelUrl} – es läuft dann bis zum Ende der bezahlten Laufzeit.`
        : till
          ? l === 'en'
            ? '\nThere is no automatic renewal – it simply ends unless you renew it.'
            : '\nEs gibt keine automatische Verlängerung – es endet einfach, wenn du nicht verlängerst.'
          : '';
      return l === 'en'
        ? `${pay.provider === 'admin' ? 'We have added' : 'Thank you – we have received your payment for'} “${name}” for your server “${server!.name}” (reference ${row!.ref}).\n${till ? `It runs until ${till}.` : 'It has no end date.'}${waiting ? '\nNote: the server itself is currently still locked – the extra takes effect as soon as the lock is lifted.' : ''}${manual ? '\nOur team sets it up for you and lets you know as soon as it is done.' : ''}${renewal}`
        : `${pay.provider === 'admin' ? 'Wir haben' : 'Danke – deine Zahlung ist eingegangen. Wir haben'} „${name}“ für deinen Server „${server!.name}“ ${activated ? 'freigeschaltet' : 'verlängert'} (Verwendungszweck ${row!.ref}).\n${till ? `Es läuft bis ${till}.` : 'Es hat kein Enddatum.'}${waiting ? '\nHinweis: Der Server selbst ist derzeit noch gesperrt – das Extra greift, sobald die Sperre aufgehoben ist.' : ''}${manual ? '\nUnser Team richtet es für dich ein und meldet sich, sobald es erledigt ist.' : ''}${renewal}`;
    },
    dedupeKey: `addon-paid:${row.id}:${until?.getTime() ?? 'unlimited'}:${activated ? 'a' : 'r'}`,
    email: true,
  });
  return outcome;
}

const BLOCK_AUDIT = { locked: 'Konto gesperrt', timeout: 'Auszeit wegen Verwarnung', discord: 'Discord-Pflicht nicht erfüllt', discord_unavailable: 'Discord-Mitgliedschaft gerade nicht prüfbar', limit: 'Server passt nicht mehr in die Grenzen (Boost-Belohnung beendet)' };

/**
 * paid = bezahlt und verbucht · processing = vom Kunden abgeschickt, die Bank verarbeitet noch · open = Bezahlseite
 * offen · failed = gescheitert, abgebrochen oder verfallen · none = keine Zahlung · unknown = Zahlungsdienst gerade
 * nicht erreichbar (dann darf nichts beendet oder verworfen werden).
 */
export type PayState = 'paid' | 'processing' | 'open' | 'failed' | 'none' | 'unknown' | 'foreign';
/** Stand nicht ermittelbar (Dienst nicht erreichbar oder Zahlung unter dem aktuellen Schlüssel nicht auffindbar): nichts beenden */
const unsure = (s: PayState): boolean => s === 'unknown' || s === 'foreign';

/** Kennzeichen einer verbuchten Zahlung, für die sich nichts freischalten ließ (wird erstattet) */
const UNDELIVERED = 'Mollie (nicht geliefert)';
/** … und für die die Erstattung bei Mollie schon ausgelöst ist (verbucht wird sie, sobald Mollie sie meldet) */
const REFUND_SENT = 'Mollie (nicht geliefert, Erstattung ausgelöst)';
/** Meldet Mollie eine ausgelöste Erstattung so lange nicht, sehen wir selbst nach */
const REFUND_SENT_CHECK_MS = 3 * DAY_MS;

/** Kennung einer Zahlung in der Buchhaltung – Testzahlungen sind eigens gekennzeichnet und zählen nicht als Einnahme */
const providerRef = (p: Pick<MolliePayment, 'id' | 'mode'>) => `${p.mode === 'test' ? 'mollie-test' : 'mollie'}:${p.id}`;

/** Zahlung wurde nach der Verbuchung zurückgeholt (Rücklastschrift, Chargeback) oder erstattet */
async function handleReversal(p: MolliePayment, row: ServerAddon): Promise<void> {
  const [booked] = await db.select({ id: addonPayments.id, confirmedBy: addonPayments.confirmedBy }).from(addonPayments).where(eq(addonPayments.providerRef, providerRef(p))).limit(1);
  if (!booked) return;
  // Diese Zahlung hat nie etwas freigeschaltet: Eine Rückbuchung nimmt dem Kunden dann nichts weg und sperrt ihn nicht
  const delivered = booked.confirmedBy !== UNDELIVERED && booked.confirmedBy !== REFUND_SENT;
  // Mollie nennt jeweils die Summe aller Erstattungen bzw. Rückbuchungen einer Zahlung. Verbucht wird nur, was neu
  // dazugekommen ist – so zählt auch eine zweite Teil-Erstattung, und eine wiederholte Meldung zählt nicht doppelt.
  const record = async (kind: 'chargeback' | 'refund' | 'reversal', totalCents: number): Promise<number> => {
    const [sum] = await db
      .select({ cents: sql<number>`coalesce(sum(${addonPayments.amountCents}), 0)` })
      .from(addonPayments)
      .where(like(addonPayments.providerRef, `${providerRef(p)}:${kind}%`));
    const delta = totalCents + Number(sum?.cents ?? 0);
    if (delta <= 0) return 0;
    try {
      await db.insert(addonPayments).values({ id: uuid(), serverAddonId: row.id, ref: row.ref, userId: row.userId, serverId: row.serverId, addonId: row.addonId, addonName: row.name.de, amountCents: -delta, periodDays: 0, provider: 'mollie', providerRef: `${providerRef(p)}:${kind}:${totalCents}`, confirmedBy: 'Mollie' });
      return delta;
    } catch (err) {
      if (isUniqueViolation(err)) return 0;
      throw err;
    }
  };
  if (p.refundedCents > 0) {
    const delta = await record('refund', p.refundedCents);
    if (delta > 0) await audit({ userId: row.userId, serverId: row.serverId, actor: 'system', action: 'addon.refund_recorded', message: `Erstattung über Mollie verbucht: „${row.name.de}“ (${row.ref}), ${formatAddonPrice(delta, 'de')}` });
  }
  if (p.chargedBackCents > 0 && !delivered) {
    const delta = await record('reversal', p.chargedBackCents);
    if (delta > 0) await audit({ userId: row.userId, serverId: row.serverId, actor: 'system', action: 'addon.refund_recorded', message: `Rückbuchung einer nicht freigeschalteten Zahlung verbucht: „${row.name.de}“ (${row.ref}), ${formatAddonPrice(delta, 'de')}` });
  } else if (p.chargedBackCents > 0) {
    const delta = await record('chargeback', p.chargedBackCents);
    // Bezahlt war damit nichts: Extra beenden (ohne den fairen Neustart, den ein regulär beendetes 24/7 bekommt), Abo
    // stoppen. Unabhängig davon, ob die Rückbuchung gerade neu verbucht wurde – ein früherer Versuch kann hier
    // abgebrochen sein.
    const [fresh] = await db.select().from(serverAddons).where(eq(serverAddons.id, row.id)).limit(1);
    const ended = fresh && fresh.status !== 'ended' ? await endAddon(fresh, 'refunded', { silent: true, unfair: true, note: 'Zahlung von der Bank zurückgeholt (Rücklastschrift/Chargeback)' }) : false;
    if (delta > 0 || ended) {
      await audit({ userId: row.userId, serverId: row.serverId, actor: 'system', action: 'addon.chargeback', message: `Zahlung zurückgeholt (Rücklastschrift/Chargeback): „${row.name.de}“ (${row.ref}), ${formatAddonPrice(p.chargedBackCents, 'de')}${ended ? ' – Extra beendet' : ''}. Das Konto kann keine Extras mehr buchen, bis die Sperre unter Admin → Extras aufgehoben wird.` });
    }
    if (ended) {
      await tell(row, {
        serverId: row.serverId,
        type: 'addon.ended',
        title: L(`Extra beendet: ${row.name.de}`, `Extra ended: ${row.name.en || row.name.de}`),
        body: (l) =>
          l === 'en'
            ? `The payment for “${row.name.en || row.name.de}” (${row.ref}) was reversed by your bank. The extra has therefore ended, and no further extras can be booked for now. If this was a mistake, please contact our team.`
            : `Die Zahlung für „${row.name.de}“ (${row.ref}) wurde von deiner Bank zurückgeholt. Das Extra ist deshalb beendet, und vorerst lassen sich keine weiteren Extras buchen. Falls das ein Versehen war, melde dich bitte bei unserem Team.`,
        dedupeKey: `addon-chargeback:${p.id}`,
        email: true,
      });
    }
  }
}

/** Versuche je Zahlung, eine Erstattung auszulösen: Zahlung → Zeitpunkt des letzten Versuchs (höchstens einer je Stunde) */
const refundTried = new Map<string, number>();

async function tryRefund(p: MolliePayment, row: Pick<ServerAddon, 'ref'>, cents: number): Promise<boolean> {
  const now = Date.now();
  if (refundTried.size > 5000) refundTried.clear();
  refundTried.set(p.id, now);
  try {
    // Kennung je Zahlung, Betrag und Stunde: Dieselbe Anfrage erstattet nie doppelt, ein späterer Versuch ist aber möglich
    await refundMolliePayment(p.id, cents, `${row.ref} – nicht zuordenbar`, `refund:${p.id}:${cents}:${Math.floor(now / 3_600_000)}`);
    await db.update(addonPayments).set({ confirmedBy: REFUND_SENT }).where(and(eq(addonPayments.providerRef, providerRef(p)), eq(addonPayments.confirmedBy, UNDELIVERED)));
    return true;
  } catch (err) {
    console.warn('[addons] Automatische Erstattung fehlgeschlagen:', (err as Error).message);
    return false;
  }
}

/** Verbuchte Zahlungen, für die nichts geliefert und (noch) nicht alles erstattet wurde */
async function refundsDue(now = new Date()): Promise<{ payment: typeof addonPayments.$inferSelect; openCents: number }[]> {
  const rows = await db
    .select()
    .from(addonPayments)
    .where(
      and(
        // Erstattung noch nicht ausgelöst – oder ausgelöst, aber von Mollie auffällig lange nicht gemeldet
        or(eq(addonPayments.confirmedBy, UNDELIVERED), and(eq(addonPayments.confirmedBy, REFUND_SENT), lte(addonPayments.createdAt, new Date(now.getTime() - REFUND_SENT_CHECK_MS)))),
        gt(addonPayments.amountCents, 0),
        gt(addonPayments.createdAt, new Date(now.getTime() - 120 * DAY_MS)),
      ),
    )
    .orderBy(asc(addonPayments.createdAt))
    .limit(100);
  const due: { payment: typeof addonPayments.$inferSelect; openCents: number }[] = [];
  for (const payment of rows) {
    if (!payment.providerRef) continue;
    const [back] = await db.select({ cents: sql<number>`coalesce(sum(${addonPayments.amountCents}), 0)` }).from(addonPayments).where(and(like(addonPayments.providerRef, `${payment.providerRef}:%`), lte(addonPayments.amountCents, 0)));
    const openCents = payment.amountCents + Number(back?.cents ?? 0);
    if (openCents > 0) due.push({ payment, openCents });
  }
  return due;
}

/** Erstattungen nachholen, die beim ersten Mal nicht geklappt haben oder noch nicht verbucht sind */
async function retryRefunds(now: Date): Promise<void> {
  for (const { payment } of await refundsDue(now)) {
    const paymentId = payment.providerRef!.split(':')[1]!;
    const last = refundTried.get(paymentId);
    if (last && now.getTime() - last < 60 * 60_000) continue;
    const testRow = payment.providerRef!.startsWith('mollie-test:');
    if (testRow !== mollieTestMode()) continue;
    let p: MolliePayment;
    try {
      p = await getMolliePayment(paymentId);
    } catch {
      continue;
    }
    const [row] = await db.select().from(serverAddons).where(eq(serverAddons.id, payment.serverAddonId)).limit(1);
    if (!row) continue;
    // Bei Mollie inzwischen erstattet oder zurückgeholt: nur noch verbuchen
    if (p.refundedCents > 0 || p.chargedBackCents > 0) await handleReversal(p, row);
    const open = p.amountCents - p.refundedCents - p.chargedBackCents;
    if (open <= 0) continue;
    if (await tryRefund(p, row, open)) {
      await audit({ userId: row.userId, serverId: row.serverId, actor: 'system', action: 'addon.payment_refunded', message: `Zahlung ${p.id} für „${row.name.de}“ (${row.ref}, ${formatAddonPrice(open, 'de')}) wurde im zweiten Anlauf automatisch erstattet` });
    }
  }
}

/**
 * Geld ist eingegangen, aber freischalten ließ sich nichts (Buchung beendet oder ersetzt, Server gelöscht, falscher
 * Betrag): automatisch zurückzahlen. Klappt das nicht, bleibt es als Aufgabe für das Team im Protokoll.
 */
async function refundUndelivered(p: MolliePayment, row: ServerAddon, outcome: 'orphan' | 'stale' | 'mismatch'): Promise<void> {
  const cents = p.amountCents - p.refundedCents - p.chargedBackCents;
  if (cents <= 0) return;
  const refunded = await tryRefund(p, row, cents);
  await audit({
    userId: row.userId,
    serverId: row.serverId,
    actor: 'system',
    action: refunded ? 'addon.payment_refunded' : 'addon.refund_failed',
    message: refunded
      ? `Zahlung ${p.id} für „${row.name.de}“ (${row.ref}, ${formatAddonPrice(cents, 'de')}) ließ sich nicht freischalten und wurde automatisch erstattet`
      : `Zahlung ${p.id} für „${row.name.de}“ (${row.ref}, ${formatAddonPrice(cents, 'de')}) ließ sich nicht freischalten – die automatische Erstattung hat NICHT geklappt, bitte im Mollie-Konto von Hand erstatten`,
  });
  await tell(row, {
    serverId: row.serverId,
    type: 'addon.payment_returned',
    title: L(`Zahlung wird erstattet: ${row.name.de}`, `Payment is refunded: ${row.name.en || row.name.de}`),
    body: (l) => {
      const why = outcome === 'mismatch' ? (l === 'en' ? 'the amount did not match the current price of the order' : 'der Betrag passte nicht zum aktuellen Preis der Bestellung') : l === 'en' ? 'the order had already ended or been replaced' : 'die Bestellung war schon beendet bzw. ersetzt';
      return l === 'en'
        ? `We received your payment of ${formatAddonPrice(cents, l)} for “${row.name.en || row.name.de}” (${row.ref}), but could not activate anything with it because ${why}.
${refunded ? 'We have refunded the amount; it will be back on your payment method within a few days.' : 'We will refund the amount – you do not need to do anything.'}`
        : `Deine Zahlung über ${formatAddonPrice(cents, l)} für „${row.name.de}“ (${row.ref}) ist eingegangen, wir konnten damit aber nichts freischalten, weil ${why}.
${refunded ? 'Wir haben den Betrag erstattet; er ist in wenigen Tagen wieder auf deinem Zahlungsmittel.' : 'Wir erstatten dir den Betrag – du musst nichts tun.'}`;
    },
    dedupeKey: `addon-payment-returned:${p.id}`,
    email: true,
  });
}

/** Stand einer Zahlung des Zahlungsdienstes auf die Buchung anwenden */
async function settlePayment(p: MolliePayment, row: ServerAddon): Promise<PayState> {
  const linked = row.checkoutId === p.id;
  const unlink = () => db.update(serverAddons).set({ checkoutId: null, checkoutUrl: null, checkoutAt: null }).where(and(eq(serverAddons.id, row.id), eq(serverAddons.checkoutId, p.id)));
  if (p.status === 'paid') {
    // Nur was zu dieser Buchung gehört: unsere Kennung, Währung, Betrieb (Test/Live). Der Betrag wird beim Verbuchen
    // am aktuellen Stand der Buchung geprüft.
    const ok = p.metadata.ref === row.ref && p.currency === 'EUR' && Number.isFinite(p.amountCents) && p.amountCents > 0 && p.mode === (mollieTestMode() ? 'test' : 'live');
    if (!ok) {
      if (linked) {
        await audit({ userId: row.userId, serverId: row.serverId, actor: 'system', action: 'addon.payment_mismatch', message: `Zahlung ${p.id} zu „${row.name.de}“ (${row.ref}) passt nicht zur Bestellung (${p.amountCents / 100} ${p.currency}, ${p.mode}) – bitte prüfen` });
        await unlink();
      }
      return 'failed';
    }
    const [booked] = await db.select({ id: addonPayments.id }).from(addonPayments).where(eq(addonPayments.providerRef, providerRef(p))).limit(1);
    // Schon vollständig erstattet oder zurückgeholt, bevor wir sie je verbucht haben: nichts freischalten
    if (!booked && p.refundedCents + p.chargedBackCents >= p.amountCents) {
      if (linked) await unlink();
      return 'failed';
    }
    let mandateId = p.mandateId;
    const customerId = p.customerId ?? row.customerId;
    if (row.autoRenew && !row.mandateId && !mandateId && customerId) mandateId = await findMollieMandate(customerId).catch(() => null);
    const outcome = await applyPayment(row.id, { provider: 'mollie', providerRef: providerRef(p), amountCents: p.amountCents, confirmedBy: 'Mollie', mandate: { customerId, mandateId } });
    if (outcome !== 'applied' && linked) await unlink();
    if (outcome === 'orphan' || outcome === 'stale' || outcome === 'mismatch') await refundUndelivered(p, row, outcome);
    if (p.chargedBackCents > 0 || p.refundedCents > 0) await handleReversal(p, row);
    return 'paid';
  }
  if (p.status === 'pending' || p.status === 'authorized') {
    // Abgeschickt, die Bank verarbeitet noch: Bezahlseite ist damit erledigt (keine zweite Zahlung anbieten)
    if (linked && row.checkoutUrl !== null) await db.update(serverAddons).set({ checkoutUrl: null }).where(and(eq(serverAddons.id, row.id), eq(serverAddons.checkoutId, p.id)));
    return 'processing';
  }
  if (p.status === 'open') return 'open';
  // failed, canceled, expired: endgültig – beim nächsten Versuch gibt es eine neue Zahlung
  if (linked) {
    await unlink();
    if (p.sequenceType === 'recurring') await renewalFailed(row);
  }
  return 'failed';
}

/**
 * Stand der laufenden Zahlung einer Buchung beim Zahlungsdienst abfragen und, wenn bezahlt, verbuchen. Aufgerufen nach
 * der Rückmeldung des Dienstes, nach der Rückkehr des Kunden und regelmäßig vom Job – maßgeblich ist immer die Abfrage.
 */
export async function checkAddonPayment(rowId: string): Promise<PayState> {
  if (!online()) return 'none';
  const [row] = await db.select().from(serverAddons).where(eq(serverAddons.id, rowId)).limit(1);
  if (!row?.checkoutId) return 'none';
  let p: MolliePayment;
  try {
    p = await getMolliePayment(row.checkoutId);
  } catch (err) {
    if (err instanceof MollieError && err.status === 404) {
      // Eine Zahlung, die wir selbst angelegt haben, „gibt es nicht“: Das passiert, wenn der Schlüssel gewechselt wurde
      // (Test ↔ Live, anderes Mollie-Profil). Dann nichts lösen und nichts beenden – unter dem richtigen Schlüssel ist
      // sie wieder da. Erst nach langer Zeit gilt sie als verloren.
      if (row.checkoutAt && Date.now() - row.checkoutAt.getTime() < POLL_MAX_MS) return 'foreign';
      await db.update(serverAddons).set({ checkoutId: null, checkoutUrl: null, checkoutAt: null }).where(and(eq(serverAddons.id, row.id), eq(serverAddons.checkoutId, row.checkoutId)));
      return 'failed';
    }
    return 'unknown';
  }
  if (p.id !== row.checkoutId) return 'unknown';
  return settlePayment(p, row);
}

/** Buchung zu einer Zahlung: die, an der sie gerade hängt – sonst über unsere Kennung in der Zahlung (nur wir legen Zahlungen an) */
async function rowForPayment(p: MolliePayment): Promise<ServerAddon | null> {
  const [linked] = await db.select().from(serverAddons).where(eq(serverAddons.checkoutId, p.id)).limit(1);
  if (linked) return linked;
  const ref = typeof p.metadata.ref === 'string' ? p.metadata.ref : null;
  if (!ref) return null;
  const [byRef] = await db.select().from(serverAddons).where(eq(serverAddons.ref, ref)).limit(1);
  return byRef ?? null;
}

/**
 * Rückmeldung von Mollie: enthält nur die ID einer Zahlung. Geprüft wird immer über die Abfrage bei Mollie. Auch
 * Zahlungen, an denen keine Buchung mehr hängt (nach dem Stornieren bezahlt, Rücklastschrift, Erstattung), werden
 * zugeordnet. @returns false, wenn Mollie gerade nicht erreichbar war – dann soll Mollie die Rückmeldung wiederholen.
 */
export async function handlePaymentWebhook(paymentId: string): Promise<boolean> {
  if (!online() || !/^tr_[A-Za-z0-9]{4,60}$/.test(paymentId)) return true;
  let p: MolliePayment;
  try {
    p = await getMolliePayment(paymentId);
  } catch (err) {
    // Unbekannte Zahlung: erledigt. Alles andere (nicht erreichbar, Schlüssel ungültig …): Mollie soll es erneut melden.
    if (err instanceof MollieError && (err.status === 404 || err.status === 410)) {
      // Hängt an dieser Zahlung eine Buchung, gibt es sie – nur nicht unter dem aktuellen Schlüssel: Mollie soll es erneut melden
      const [known] = await db.select({ id: serverAddons.id }).from(serverAddons).where(eq(serverAddons.checkoutId, paymentId)).limit(1);
      return !known && !mollieTestMode();
    }
    console.error('[addons] Rückmeldung von Mollie ließ sich nicht prüfen:', (err as Error).message);
    return false;
  }
  if (p.id !== paymentId) return true;
  const row = await rowForPayment(p);
  if (row) await settlePayment(p, row);
  return true;
}

/** Nach der Rückkehr von der Bezahlseite: offene Zahlungen dieses Servers gleich prüfen */
export async function checkServerPayments(user: User, serverId: string, lang: Locale): Promise<ServerAddonsDTO> {
  const server = await ownServer(user, serverId);
  const rows = await db
    .select({ id: serverAddons.id })
    .from(serverAddons)
    .where(and(eq(serverAddons.serverId, server.id), isNotNull(serverAddons.checkoutId), inArray(serverAddons.status, ['pending', 'active'])))
    .limit(5);
  for (const r of rows) await checkAddonPayment(r.id).catch(() => {});
  return viewFor(server, lang, user);
}

/* ------------------------------------------------------------ Abo */

/**
 * In welchem Betrieb wurde diese Buchung bezahlt – mit echtem Geld (live) oder zum Test? Kunde und Mandat bei Mollie
 * gibt es nur dort. Läuft die Website gerade mit dem anderen Schlüssel, wird für die Buchung weder abgebucht noch
 * widerrufen – sonst sähe ein Schlüsselwechsel wie eine Absage der Bank aus.
 */
async function otherMode(rowId: string): Promise<boolean> {
  const rows = await db.select({ ref: addonPayments.providerRef }).from(addonPayments).where(and(eq(addonPayments.serverAddonId, rowId), like(addonPayments.providerRef, 'mollie%:tr%'))).limit(50);
  const live = rows.some((r) => r.ref?.startsWith('mollie:'));
  const test = rows.some((r) => r.ref?.startsWith('mollie-test:'));
  if (!live && !test) return false;
  return mollieTestMode() ? live : !live && test;
}

/** Einzugsermächtigung beim Zahlungsdienst widerrufen – danach kann nichts mehr abgebucht werden. Scheitert das, versucht es der Job erneut. */
async function revokeMandate(row: Pick<ServerAddon, 'id' | 'customerId' | 'mandateId'>): Promise<void> {
  if (!row.mandateId) return;
  if (online() && row.customerId) {
    if (await otherMode(row.id)) return;
    try {
      await revokeMollieMandate(row.customerId, row.mandateId);
    } catch (err) {
      console.warn('[addons] Mandat konnte nicht widerrufen werden – neuer Versuch im Job:', (err as Error).message);
      return;
    }
  }
  await db.update(serverAddons).set({ mandateId: null }).where(and(eq(serverAddons.id, row.id), eq(serverAddons.mandateId, row.mandateId)));
}

/** Abo beenden: keine weitere Abbuchung, die bezahlte Laufzeit läuft zu Ende */
async function stopSubscription(row: ServerAddon, byCustomer: boolean, opts: { /** Widerruf beim Zahlungsdienst dem Job überlassen (Antwortzeit verrät sonst etwas) */ later?: boolean } = {}): Promise<boolean> {
  const res = await db
    .update(serverAddons)
    .set({ autoRenew: false, ...(byCustomer ? { subscriptionCanceledAt: new Date() } : {}) })
    .where(and(eq(serverAddons.id, row.id), eq(serverAddons.autoRenew, true)));
  if (affectedRows(res) !== 1) return false;
  if (!opts.later) await revokeMandate(row);
  return true;
}

/** Bestätigung der Kündigung an den Kunden (mit Zeitpunkt des Eingangs und Ende der Laufzeit) */
async function confirmCancellation(row: ServerAddon, at: Date, viaPage: boolean): Promise<void> {
  const [server] = await db.select({ name: servers.name }).from(servers).where(eq(servers.id, row.serverId)).limit(1);
  const inFlight = processing(row);
  await tell(row, {
    serverId: row.serverId,
    type: 'addon.subscription_canceled',
    title: L(`Kündigung bestätigt: ${row.name.de}`, `Cancellation confirmed: ${row.name.en || row.name.de}`),
    body: (l) => {
      const name = row.name[l] || row.name.de;
      const en = l === 'en';
      const head = en
        ? `We received your cancellation of the subscription “${name}” (${row.ref}) for your server “${server?.name ?? ''}” on ${when(at, l)}.\nNothing more will be charged.`
        : `Deine Kündigung des Abos „${name}“ (${row.ref}) für deinen Server „${server?.name ?? ''}“ ist am ${when(at, l)} bei uns eingegangen.\nEs wird nichts mehr abgebucht.`;
      const flight = !inFlight ? '' : en ? ' A charge that had already been started is still carried out and pays for one more term.' : ' Eine bereits angestoßene Abbuchung wird noch ausgeführt und bezahlt eine weitere Laufzeit.';
      const end =
        row.status === 'active' && row.paidUntil
          ? en
            ? `\nThe extra keeps running until ${when(row.paidUntil, l)}${inFlight ? ' (or until the end of that further term)' : ''} and then ends by itself.`
            : `\nDas Extra läuft noch bis ${when(row.paidUntil, l)}${inFlight ? ' (bzw. bis zum Ende dieser weiteren Laufzeit)' : ''} und endet dann von selbst.`
          : en
            ? '\nYour order is not paid yet. If you still pay it, it is a one-time booking that ends by itself.'
            : '\nDeine Bestellung ist noch nicht bezahlt. Bezahlst du sie noch, ist es eine einmalige Buchung, die von selbst endet.';
      const page = !viaPage ? '' : en ? '\nThis cancellation was submitted via the page “Cancel contracts here”. If it was not you, please contact us – you can choose a subscription again when you next renew.' : '\nDiese Kündigung kam über die Seite „Verträge hier kündigen“. Falls sie nicht von dir stammt, melde dich bitte bei uns – ein Abo kannst du beim nächsten Verlängern wieder wählen.';
      return `${head}${flight}${end}${page}`;
    },
    dedupeKey: `addon-sub-canceled:${row.id}:${at.getTime()}`,
    email: true,
  });
}

/** Denselben Eintrag höchstens einmal am Tag ins Protokoll schreiben (z. B. wiederholte Meldungen eines Dauerzustands) */
async function auditOnce(input: Parameters<typeof audit>[0]): Promise<void> {
  const [same] = await db
    .select({ id: auditLogs.id })
    .from(auditLogs)
    .where(and(eq(auditLogs.action, input.action), eq(auditLogs.message, input.message.slice(0, 500)), gt(auditLogs.createdAt, new Date(Date.now() - DAY_MS))))
    .limit(1);
  if (!same) await audit(input);
}

/** Kunde kündigt sein Abo in „Meine Server“ */
export async function cancelSubscription(user: User, serverId: string, rowId: string, lang: Locale, ip?: string): Promise<ServerAddonsDTO> {
  const { server, row } = await ownRow(user, serverId, rowId);
  if (row.status === 'ended' || !row.autoRenew) throw Errors.conflict('no_subscription', L('Für diese Buchung läuft kein Abo.', 'There is no subscription for this booking.'));
  const at = new Date();
  if (await stopSubscription(row, true)) {
    await audit({ userId: user.id, serverId: server.id, actor: 'user', action: 'addon.subscription_canceled', message: `Abo „${row.name.de}“ (${row.ref}) gekündigt – läuft bis ${row.paidUntil ? when(row.paidUntil, 'de') : 'zur ersten Zahlung'}`, ip });
    await confirmCancellation(row, at, false);
  }
  return viewFor(server, lang, user);
}

/**
 * Kündigung über die öffentliche Kündigungsseite (ohne Anmeldung). Passt die E-Mail-Adresse zu einem Konto mit Abo,
 * wird gekündigt und per E-Mail bestätigt – mit Verwendungszweck genau dieses Abo, ohne alle Abos des Kontos. Lässt
 * sich nichts zuordnen, landet die Erklärung im Protokoll, damit das Team sie bearbeitet. Die Antwort an den Absender
 * ist immer dieselbe (sie verrät nicht, ob es zu einer Adresse ein Konto gibt).
 */
export async function requestCancellation(input: { email: string; ref?: string }, ip?: string): Promise<void> {
  const email = input.email.trim().toLowerCase();
  const ref = input.ref?.trim().toUpperCase() || null;
  const at = new Date();
  const [user] = await db.select().from(users).where(sql`lower(${users.email}) = ${email}`).limit(1);
  const subs = user
    ? await db
        .select()
        .from(serverAddons)
        .where(and(eq(serverAddons.userId, user.id), eq(serverAddons.autoRenew, true), inArray(serverAddons.status, ['pending', 'active'])))
        .limit(50)
    : [];
  // Mit passendem Verwendungszweck genau dieses Abo – sonst alle Abos des Kontos (die Erklärung ist eindeutig: kündigen)
  const byRef = ref ? subs.filter((r) => r.ref === ref) : [];
  const targets = byRef.length ? byRef : subs;
  if (targets.length === 0) {
    const message = `Kündigung über die Kündigungsseite eingegangen, aber keinem Abo zuzuordnen (E-Mail ${email.slice(0, 120)}${ref ? `, Verwendungszweck ${ref.slice(0, 20)}` : ''}) – bitte prüfen und beantworten`;
    await auditOnce({ userId: user?.id ?? null, actor: 'user', action: 'addon.cancel_request_unmatched', message, ip });
    return;
  }
  for (const row of targets) {
    if (!(await stopSubscription(row, true, { later: true }))) continue;
    await audit({ userId: row.userId, serverId: row.serverId, actor: 'user', action: 'addon.subscription_canceled', message: `Abo „${row.name.de}“ (${row.ref}) über die Kündigungsseite gekündigt – läuft bis ${row.paidUntil ? when(row.paidUntil, 'de') : 'zur ersten Zahlung'}`, ip });
    await confirmCancellation(row, at, true);
  }
}

/** Automatische Abbuchung ist gescheitert: Abo beenden, Kunde informieren – das Extra läuft bis zum bezahlten Ende */
async function renewalFailed(row: ServerAddon): Promise<void> {
  if (!(await stopSubscription(row, false))) return;
  await audit({ userId: row.userId, serverId: row.serverId, actor: 'system', action: 'addon.renewal_failed', message: `Abo „${row.name.de}“ (${row.ref}): Abbuchung für die Verlängerung gescheitert – Abo beendet, läuft bis ${row.paidUntil ? when(row.paidUntil, 'de') : '–'}` });
  await tell(row, {
    serverId: row.serverId,
    type: 'addon.renewal_failed',
    title: L(`Abbuchung fehlgeschlagen: ${row.name.de}`, `Charge failed: ${row.name.en || row.name.de}`),
    body: (l) => {
      const till = row.paidUntil ? when(row.paidUntil, l) : '';
      return l === 'en'
        ? `We could not collect the payment for renewing “${row.name.en || row.name.de}” (${row.ref}). The subscription has therefore ended and nothing more will be charged.\nThe extra keeps running until ${till}. You can renew it yourself before then under “My servers” → Manage → Extras.`
        : `Die Abbuchung für die Verlängerung von „${row.name.de}“ (${row.ref}) hat nicht geklappt. Das Abo ist damit beendet, es wird nichts mehr abgebucht.\nDas Extra läuft noch bis ${till}. Du kannst es bis dahin unter „Meine Server“ → Verwalten → Extras selbst verlängern.`;
    },
    dedupeKey: `addon-renewal-failed:${row.id}:${row.paidUntil?.getTime() ?? 0}`,
    email: true,
  });
}

/** Wie lange wir eine Abbuchung ohne Antwort mit derselben Kennung wiederholen (der Zahlungsdienst erkennt sie so lange als dieselbe) */
const RENEW_RETRY_MS = 50 * 60_000;
/** Vor der Abbuchung muss die Ankündigung mindestens so lange beim Kunden sein */
const RENEW_NOTICE_MS = DAY_MS;

/**
 * Ankündigung der nächsten Abbuchung eines Abos – einmal je Laufzeit.
 * @returns wann sie verschickt wurde (null = es gibt das Konto nicht mehr)
 */
async function ensureRenewalNotice(row: ServerAddon, serverName: string, now: Date): Promise<Date | null> {
  if (!row.paidUntil) return null;
  const dedupeKey = `addon-renewal-notice:${row.id}:${row.paidUntil.getTime()}`;
  const [sent] = await db.select({ at: notifications.createdAt }).from(notifications).where(and(eq(notifications.userId, row.userId), eq(notifications.dedupeKey, dedupeKey))).limit(1);
  if (sent) return sent.at;
  const charge = new Date(Math.max(row.paidUntil.getTime() - addonRenewLeadDays(row.periodDays) * DAY_MS, now.getTime() + RENEW_NOTICE_MS));
  const created = await tell(row, {
    serverId: row.serverId,
    type: 'addon.renewal_notice',
    title: L(`Dein Abo verlängert sich: ${row.name.de}`, `Your subscription renews: ${row.name.en || row.name.de}`),
    body: (l) => {
      const cancelUrl = `${baseUrl()}${l === 'de' ? '/de/kuendigen' : '/cancel-subscription'}`;
      return l === 'en'
        ? `Your subscription “${row.name.en || row.name.de}” (${row.ref}) for your server “${serverName}” renews automatically: around ${when(charge, l)} we charge ${formatAddonPrice(row.priceCents, l)} for another ${formatAddonPeriod(row.periodDays, l)} (following ${when(row.paidUntil!, l)}).\nIf you do not want that, cancel before then under “My servers” → Manage → Extras or at ${cancelUrl}.`
        : `Dein Abo „${row.name.de}“ (${row.ref}) für deinen Server „${serverName}“ verlängert sich automatisch: Etwa am ${when(charge, l)} buchen wir ${formatAddonPrice(row.priceCents, l)} für weitere ${formatAddonPeriod(row.periodDays, l)} ab (im Anschluss an den ${when(row.paidUntil!, l)}).\nWenn du das nicht möchtest, kündige vorher unter „Meine Server“ → Verwalten → Extras oder auf ${cancelUrl}.`;
    },
    dedupeKey,
    email: true,
  });
  return created ? now : null;
}

/**
 * Abo verlängern: kurz vor dem Ende der Laufzeit über die Einzugsermächtigung abbuchen – ein Versuch je Laufzeit,
 * frühestens einen Tag nach der Ankündigung. Vorher gelten dieselben Schranken wie beim Bestellen; passt etwas nicht
 * (Extra nicht mehr im Angebot, Server gesperrt, Konto gesperrt …), endet das Abo, statt Geld für etwas abzubuchen,
 * das nicht geliefert wird. Beendet wird das Abo nur bei einer eindeutigen Absage – nicht, wenn der Zahlungsdienst
 * bloß nicht erreichbar ist.
 */
async function chargeRenewal(row: ServerAddon, settings: SiteSettings, now: Date): Promise<'charged' | 'stopped' | 'skipped'> {
  if (!row.paidUntil || !row.customerId || !row.mandateId) return 'skipped';
  if (row.paidUntil.getTime() - now.getTime() > addonRenewLeadDays(row.periodDays) * DAY_MS) return 'skipped';
  // Die Website läuft gerade mit dem anderen Schlüssel (Test statt Live oder umgekehrt): Dort gibt es Kunde und
  // Einzugsermächtigung dieser Buchung nicht – nichts abbuchen und das Abo nicht beenden
  if (await otherMode(row.id)) {
    await auditOnce({ userId: row.userId, serverId: row.serverId, actor: 'system', action: 'addon.renewal_stuck', message: `Abo „${row.name.de}“ (${row.ref}) kann gerade nicht abgebucht werden: Die Website läuft mit einem ${mollieTestMode() ? 'Test' : 'Live'}-Schlüssel, die Buchung gehört zum anderen Betrieb – läuft bis ${when(row.paidUntil, 'de')}` });
    return 'skipped';
  }
  const link = async (payment: MolliePayment): Promise<'charged' | 'skipped'> => {
    const linked = await db.update(serverAddons).set({ checkoutId: payment.id, checkoutUrl: null, checkoutAt: now }).where(and(eq(serverAddons.id, row.id), isNull(serverAddons.checkoutId)));
    if (affectedRows(linked) !== 1) return 'skipped';
    await settlePayment(payment, { ...row, checkoutId: payment.id, checkoutUrl: null });
    return 'charged';
  };
  const attempted = row.renewFor !== null && row.renewFor.getTime() === row.paidUntil.getTime();
  if (attempted && (!row.checkoutAt || now.getTime() - row.checkoutAt.getTime() > RENEW_RETRY_MS)) {
    // Ein früherer Versuch blieb ohne Antwort, und der Zahlungsdienst erkennt eine Wiederholung nicht mehr als dieselbe
    // Anfrage. Erst nachsehen, ob die Abbuchung doch angelegt wurde – nur wenn nicht, gibt es einen neuen Versuch.
    let found: MolliePayment | undefined;
    try {
      found = (await listMollieCustomerPayments(row.customerId)).find((x) => x.metadata.booking === row.id && Number(x.metadata.attempt) === row.checkoutCount);
    } catch {
      return 'skipped';
    }
    if (found) return link(found);
    await db.update(serverAddons).set({ renewFor: null, checkoutAt: null }).where(and(eq(serverAddons.id, row.id), isNull(serverAddons.checkoutId), eq(serverAddons.paidUntil, row.paidUntil)));
    return 'skipped';
  }
  // Nummer des Versuchs: Teil der Kennung, unter der der Zahlungsdienst eine wiederholte Anfrage als dieselbe erkennt
  let attempt = row.checkoutCount;
  if (!attempted) {
    const [server] = await db.select().from(servers).where(eq(servers.id, row.serverId)).limit(1);
    const owner = await ownerOf(row);
    const addon = settings.addons.items.find((a) => a.id === row.addonId);
    let why: string | null = null;
    if (!server || server.status === 'deleted' || !owner) why = 'Server oder Konto gibt es nicht mehr';
    else if (!settings.addons.enabled || !addon || !addon.enabled || !addonFits(addon, server)) why = 'das Extra wird für diesen Server nicht mehr angeboten';
    else if (!orderable(server)) why = 'der Server ist gesperrt';
    else if (await chargebackBlocked(row.userId, now)) why = 'eine frühere Zahlung wurde zurückgeholt';
    else if (row.effect === 'always_on') {
      const block = await renewalBlock(owner, server, now);
      if (block) why = BLOCK_AUDIT[block];
    }
    if (why) {
      if (await stopSubscription(row, false)) {
        await audit({ userId: row.userId, serverId: row.serverId, actor: 'system', action: 'addon.subscription_stopped', message: `Abo „${row.name.de}“ (${row.ref}) nicht verlängert: ${why} – läuft bis ${when(row.paidUntil, 'de')}` });
        await tell(row, {
          serverId: row.serverId,
          type: 'addon.subscription_stopped',
          title: L(`Abo endet: ${row.name.de}`, `Subscription ends: ${row.name.en || row.name.de}`),
          body: (l) =>
            l === 'en'
              ? `Your subscription “${row.name.en || row.name.de}” (${row.ref}) is not renewed and nothing more will be charged, because it can no longer be provided for this server at the moment.\nThe extra keeps running until ${when(row.paidUntil!, l)}.`
              : `Dein Abo „${row.name.de}“ (${row.ref}) wird nicht verlängert und es wird nichts mehr abgebucht, weil es sich für diesen Server derzeit nicht mehr bereitstellen lässt.\nDas Extra läuft noch bis ${when(row.paidUntil!, l)}.`,
          dedupeKey: `addon-sub-stopped:${row.id}:${row.paidUntil.getTime()}`,
          email: true,
        });
      }
      return 'stopped';
    }
    // Server ruht gerade wegen des Zyklus (abgelaufen, noch nicht reaktiviert): jetzt nichts abbuchen. Läuft die
    // bezahlte Zeit so aus, endet das Extra von selbst – ohne Abbuchung für einen Server, der vielleicht gelöscht wird.
    if (server!.status !== 'active') {
      await tell(row, {
        serverId: row.serverId,
        type: 'addon.renewal_paused',
        title: L(`Abo pausiert: ${row.name.de}`, `Subscription paused: ${row.name.en || row.name.de}`),
        body: (l) =>
          l === 'en'
            ? `Your server “${server!.name}” is resting at the moment, so we are not charging the renewal of “${row.name.en || row.name.de}” (${row.ref}).\nReactivate the server before ${when(row.paidUntil!, l)} and the subscription simply continues. Otherwise the extra ends then – without any charge.`
            : `Dein Server „${server!.name}“ ruht gerade, deshalb buchen wir die Verlängerung von „${row.name.de}“ (${row.ref}) nicht ab.\nReaktivierst du den Server vor dem ${when(row.paidUntil!, l)}, läuft das Abo einfach weiter. Sonst endet das Extra dann – ohne Abbuchung.`,
        dedupeKey: `addon-renewal-paused:${row.id}:${row.paidUntil.getTime()}`,
        email: true,
      });
      return 'skipped';
    }
    // Erst ankündigen, dann – frühestens einen Tag später – abbuchen
    const noticeAt = await ensureRenewalNotice(row, server!.name, now);
    if (!noticeAt || now.getTime() - noticeAt.getTime() < RENEW_NOTICE_MS) return 'skipped';
    // Ein Versuch je Laufzeit – erst vormerken, dann abbuchen
    const marked = await db
      .update(serverAddons)
      .set({ renewFor: row.paidUntil, checkoutAt: now, checkoutCount: sql`${serverAddons.checkoutCount} + 1` })
      .where(and(eq(serverAddons.id, row.id), eq(serverAddons.status, 'active'), eq(serverAddons.autoRenew, true), isNull(serverAddons.checkoutId), eq(serverAddons.paidUntil, row.paidUntil), or(isNull(serverAddons.renewFor), ne(serverAddons.renewFor, row.paidUntil))))
      .returning({ n: serverAddons.checkoutCount });
    if (marked.length !== 1) return 'skipped';
    attempt = marked[0]!.n;
  }
  let payment: MolliePayment;
  try {
    payment = await createMolliePayment({
      amountCents: row.priceCents,
      description: `${row.name.de} (${row.ref}) – Verlängerung`,
      metadata: { ref: row.ref, booking: row.id, attempt },
      webhookUrl: paymentWebhookUrl(),
      sequenceType: 'recurring',
      customerId: row.customerId,
      mandateId: row.mandateId,
      // Dieselbe Kennung für denselben Versuch: Eine wiederholte Anfrage bucht nicht doppelt ab
      idempotencyKey: `renew:${row.id}:${attempt}`,
    });
  } catch (err) {
    // Eindeutige Absage (z. B. Einzugsermächtigung ungültig): Abo beenden. Alles andere – nicht erreichbar, überlastet,
    // Schlüssel ungültig, Antwort abgebrochen – ist nicht die Schuld des Kunden: später mit derselben Kennung noch einmal.
    // Eindeutig ist nur: Mollie lehnt genau den Kunden bzw. die Einzugsermächtigung ab (oder sie gibt es nicht mehr).
    if (err instanceof MollieError && (err.status === 410 || (err.status === 422 && (err.field === 'mandateId' || err.field === 'customerId')))) {
      console.warn('[addons] Abbuchung abgelehnt:', err.message);
      await renewalFailed(row);
      return 'stopped';
    }
    console.error('[addons] Abbuchung ließ sich nicht anlegen – neuer Versuch im nächsten Lauf:', (err as Error).message);
    // Bleibt das so, läuft das Extra am Ende der bezahlten Zeit aus – das Team soll davon erfahren, bevor es so weit ist
    await auditOnce({ userId: row.userId, serverId: row.serverId, actor: 'system', action: 'addon.renewal_stuck', message: `Abo „${row.name.de}“ (${row.ref}) ließ sich nicht abbuchen (${(err as Error).message.slice(0, 120)}) – neuer Versuch folgt; ohne Erfolg endet das Extra am ${when(row.paidUntil, 'de')}` });
    return 'skipped';
  }
  return link(payment);
}

/* ------------------------------------------------------------ Wirkung „24/7“ */

/**
 * „24/7“ einschalten: keine Fair-Use-Pausen, kein 30-Tage-Zyklus. Eine laufende Fair-Use-Pause endet sofort; ein
 * Server, der wegen des Zyklus abläuft oder ruht, läuft wieder – aber nur, wenn auch eine kostenlose Reaktivierung
 * erlaubt wäre (Konto nicht gesperrt, keine Auszeit, Discord-Pflicht, Grenzen je Person). Sperren wegen Verstößen und
 * die Pause des Überlastschutzes bleiben unberührt.
 * @returns das Hindernis, wenn der Server vorerst gesperrt bleibt (der Abgleich im Job versucht es erneut)
 */
export async function activateAlwaysOn(serverId: string, now = new Date()): Promise<keyof typeof BLOCK_AUDIT | null> {
  const [server] = await db.select().from(servers).where(eq(servers.id, serverId)).limit(1);
  if (!server || server.status === 'deleted') return null;
  const cycleHeld = server.status === 'expiring' || (server.status === 'suspended' && server.suspensionReason === 'cycle_expired');
  if (cycleHeld) {
    const [owner] = await db.select().from(users).where(eq(users.id, server.userId)).limit(1);
    // Streng wie beim Reaktivieren: Lässt sich die Discord-Pflicht gerade nicht prüfen, bleibt die Sperre vorerst
    const block = owner ? await renewalBlock(owner, server, now, { strict: true }) : 'locked';
    if (block) return block;
  }
  const fairUsePause = server.pauseReason === 'max_session' || server.pauseReason === 'weekly_offline';
  await db
    .update(servers)
    .set({
      alwaysOnSince: server.alwaysOnSince ?? now,
      cycleEndsAt: NO_CYCLE_END,
      ...(fairUsePause ? { pausedUntil: null, pauseReason: null, pausedAt: null } : {}),
      ...(cycleHeld ? { status: 'active' as const, suspensionReason: null, suspendedAt: null, expiringSince: null } : {}),
    })
    .where(and(eq(servers.id, server.id), eq(servers.status, server.status)));
  if (cycleHeld && server.status === 'suspended' && server.pteroServerId) await pterodactyl().unsuspendServer(server.pteroServerId).catch(() => {});
  await trySyncPanelDescription(server.id);
  return null;
}

/**
 * „24/7“ ausschalten – mit fairem Neustart: frischer 30-Tage-Zyklus ab jetzt, und die Laufzeit aus der Zeit mit dem
 * Extra zählt nicht gegen die Fair-Use-Regeln. Nur wenn keine andere 24/7-Buchung für den Server mehr läuft.
 * Passt der Server nicht mehr in die Grenzen seines Besitzers (Boost-Belohnung beendet), gibt es keinen neuen Zyklus:
 * Er läuft sofort ab, wie er es ohne das Extra längst getan hätte.
 */
export async function deactivateAlwaysOn(serverId: string, now = new Date(), opts: { /** false = ohne fairen Neustart (Zahlung zurückgeholt) */ fair?: boolean } = {}): Promise<void> {
  const [other] = await db
    .select({ id: serverAddons.id })
    .from(serverAddons)
    .where(and(eq(serverAddons.serverId, serverId), eq(serverAddons.effect, 'always_on'), eq(serverAddons.status, 'active')))
    .limit(1);
  if (other) return;
  const [server] = await db.select().from(servers).where(eq(servers.id, serverId)).limit(1);
  if (!server?.alwaysOnSince) return;
  const fair = opts.fair !== false;
  const [owner] = fair ? await db.select().from(users).where(eq(users.id, server.userId)).limit(1) : [];
  const fits = owner ? await fitsServerLimits(owner, server).catch(() => true) : true;
  // Angebote ohne Zyklus (Discord-Bots) bekommen auch keinen: Für sie bleibt es beim „ohne Ablaufdatum“
  const noCycle = cycleEndFor(server.kind, now, freeHostingConfig.cycle).getTime() === NO_CYCLE_END.getTime();
  const cycle =
    !fair
      ? // Zahlung zurückgeholt bzw. nur zum Test bezahlt: kein Vorteil aus der unbezahlten Zeit – der Zyklus gilt als
        // abgelaufen (normaler Ablauf mit Ruhezeit). Neue Zyklus-Nummer, damit die Hinweise dazu ankommen.
        { cycleNumber: server.cycleNumber + 1, cycleEndsAt: noCycle ? NO_CYCLE_END : now }
      : fits
        ? // Fairer Neustart: frischer Zyklus, die Laufzeit aus der Zeit mit dem Extra zählt nicht gegen die Fair-Use-Regeln
          { fairUseResetAt: now, cycleNumber: server.cycleNumber + 1, cycleStartedAt: now, cycleEndsAt: cycleEndFor(server.kind, now, freeHostingConfig.cycle) }
        : // Passt nicht mehr in die Grenzen (Boost-Belohnung beendet): kein neuer Zyklus – es gilt das Ende, das der
          // Server ohne das Extra gehabt hätte (frühestens jetzt)
          { fairUseResetAt: now, cycleNumber: server.cycleNumber + 1, cycleEndsAt: new Date(Math.max(now.getTime(), cycleEndFor(server.kind, server.cycleStartedAt ?? now, freeHostingConfig.cycle).getTime())) };
  await db
    .update(servers)
    .set({
      alwaysOnSince: null,
      ...cycle,
      // Bots: Die Offline-Zeit zählt ab jetzt neu (Inaktivitäts-Regel)
      ...(server.kind === 'discord' ? { powerStateAt: now } : {}),
    })
    .where(and(eq(servers.id, server.id), isNotNull(servers.alwaysOnSince)));
  await trySyncPanelDescription(server.id);
}

/* ------------------------------------------------------------ Ende */

type EndReason = NonNullable<ServerAddon['endReason']>;

/**
 * Buchung beenden: Wirkung zurücknehmen, Abo stoppen, ggf. Aufgabe „zurücknehmen“ für das Team, Nachricht an den
 * Kunden. `ifPaidUntil`: nur beenden, wenn sich das Ende der Laufzeit seit dem Lesen nicht geändert hat (sonst würde
 * eine gerade bezahlte Verlängerung beendet).
 */
export async function endAddon(row: ServerAddon, reason: EndReason, opts: { silent?: boolean; note?: string; ifPaidUntil?: Date; /** ohne fairen Neustart (Zahlung zurückgeholt) */ unfair?: boolean } = {}): Promise<boolean> {
  const now = new Date();
  const wasActive = row.status === 'active';
  const fulfilment = row.effect === 'manual' && wasActive && row.fulfilment === 'done' ? 'revoke' : 'none';
  const res = await db
    .update(serverAddons)
    .set({ status: 'ended', endedAt: now, endReason: reason, renewalRequestedAt: null, checkoutId: null, checkoutUrl: null, checkoutAt: null, autoRenew: false, fulfilment, ...(opts.note ? { adminNote: opts.note.slice(0, 500) } : {}) })
    .where(and(eq(serverAddons.id, row.id), eq(serverAddons.status, row.status), opts.ifPaidUntil ? eq(serverAddons.paidUntil, opts.ifPaidUntil) : undefined));
  if (affectedRows(res) !== 1) return false;
  // Erst die Wirkung zurücknehmen (ohne Wartezeit), dann den Zahlungsdienst fragen – sonst käme der Abgleich im Job dazwischen
  if (wasActive && row.effect === 'always_on') await deactivateAlwaysOn(row.serverId, now, { fair: !opts.unfair });
  await revokeMandate(row);
  if (opts.silent || !wasActive || reason === 'server_deleted') return true;
  const [server] = await db.select({ name: servers.name }).from(servers).where(eq(servers.id, row.serverId)).limit(1);
  await tell(row, {
    serverId: row.serverId,
    type: 'addon.ended',
    title: L(`Extra beendet: ${row.name.de}`, `Extra ended: ${row.name.en || row.name.de}`),
    body: (l) => {
      const name = row.name[l] || row.name.de;
      const why =
        reason === 'expired'
          ? l === 'en'
            ? 'The paid period is over and it was not renewed.'
            : 'Die bezahlte Laufzeit ist vorbei und wurde nicht verlängert.'
          : l === 'en'
            ? 'It was ended by our team.'
            : 'Es wurde von unserem Team beendet.';
      const effect =
        row.effect === 'always_on'
          ? l === 'en'
            ? '\nThe normal rules of the free offer apply again from now on (fair-use breaks and the 30-day runtime).'
            : '\nAb jetzt gelten wieder die normalen Regeln des kostenlosen Angebots (Fair-Use-Pausen und die 30-Tage-Laufzeit).'
          : '';
      return l === 'en'
        ? `“${name}” for your server “${server?.name ?? ''}” has ended. ${why}${effect}\nYou can book it again at any time under “My servers” → Manage → Extras.`
        : `„${name}“ für deinen Server „${server?.name ?? ''}“ ist beendet. ${why}${effect}\nDu kannst es jederzeit unter „Meine Server“ → Verwalten → Extras wieder buchen.`;
    },
    dedupeKey: `addon-ended:${row.id}:${now.getTime()}`,
    email: true,
  });
  return true;
}

/* ------------------------------------------------------------ Job */

/** Server, bei denen „24/7“ zuletzt nicht greifen durfte: Server-ID → Zeitpunkt des letzten Versuchs */
const healTried = new Map<string, number>();
const HEAL_RETRY_MS = 5 * 60_000;

/** Regelmäßiger Lauf: aufräumen, erinnern, Zahlungen nachfragen, Abos verlängern, verwerfen, beenden, Wirkung abgleichen */
export async function runAddons(now = new Date()): Promise<{ expired: number; unpaid: number; reminded: number; paid: number; renewed: number; healed: number }> {
  const stats = { expired: 0, unpaid: 0, reminded: 0, paid: 0, renewed: 0, healed: 0 };
  const settings = await getSettings();
  // Ist der Zahlungsdienst nicht erreichbar, fragen wir in diesem Lauf nicht weiter – alles Übrige läuft trotzdem
  let down = false;
  const check = async (rowId: string): Promise<PayState> => {
    if (down) return 'unknown';
    const state = await checkAddonPayment(rowId).catch(() => 'unknown' as PayState);
    if (state === 'unknown') down = true;
    return state;
  };

  // 1) Buchungen beenden, deren Server oder Konto es nicht mehr gibt
  const gone = await db
    .select({ row: serverAddons })
    .from(serverAddons)
    .leftJoin(servers, eq(servers.id, serverAddons.serverId))
    .leftJoin(users, eq(users.id, serverAddons.userId))
    .where(and(inArray(serverAddons.status, ['pending', 'active']), or(isNull(servers.id), eq(servers.status, 'deleted'), isNull(users.id))))
    .limit(200);
  for (const { row } of gone) {
    if (!(await endAddon(row, 'server_deleted', { silent: true }))) continue;
    // Bezahlte Restlaufzeit geht mit dem Server unter – sichtbar machen, falls das Team kulant erstatten möchte
    if (row.status === 'active' && row.priceCents > 0 && row.paidUntil && row.paidUntil.getTime() - now.getTime() > DAY_MS) {
      await audit({ userId: row.userId, serverId: row.serverId, actor: 'system', action: 'addon.ended_server_deleted', message: `Extra „${row.name.de}“ (${row.ref}) beendet, weil es Server oder Konto nicht mehr gibt – bezahlt war noch bis ${when(row.paidUntil, 'de')}` });
    }
  }

  // 2) Erinnern, bevor die Laufzeit endet – bei Abos: ankündigen, dass und wann abgebucht wird
  const horizon = new Date(now.getTime() + 14 * DAY_MS);
  const soon = await db
    .select({ row: serverAddons, server: servers })
    .from(serverAddons)
    .innerJoin(servers, eq(servers.id, serverAddons.serverId))
    .where(and(eq(serverAddons.status, 'active'), isNotNull(serverAddons.paidUntil), gt(serverAddons.paidUntil, now), lte(serverAddons.paidUntil, horizon), isNull(serverAddons.renewalRequestedAt), isNull(serverAddons.checkoutId)))
    .orderBy(asc(serverAddons.paidUntil))
    .limit(400);
  for (const { row, server } of soon) {
    const left = row.paidUntil!.getTime() - now.getTime();
    if (subscribed(row)) {
      // Abo: Abbuchung rechtzeitig ankündigen (spätestens einen Tag vorher – ohne Ankündigung wird nicht abgebucht)
      const charge = nextCharge(row);
      if (!charge || charge.getTime() - now.getTime() > Math.min(3, addonRenewLeadDays(row.periodDays) + 1) * DAY_MS) continue;
      if (server.status !== 'active') continue;
      const [had] = await db.select({ id: notifications.id }).from(notifications).where(and(eq(notifications.userId, row.userId), eq(notifications.dedupeKey, `addon-renewal-notice:${row.id}:${row.paidUntil!.getTime()}`))).limit(1);
      if (!had && (await ensureRenewalNotice(row, server.name, now))) stats.reminded++;
      continue;
    }
    if (settings.addons.remindDaysBefore <= 0 || left > settings.addons.remindDaysBefore * DAY_MS) continue;
    const renewable = canRenew(row, settings, now, server);
    const created = await tell(row, {
      serverId: row.serverId,
      type: 'addon.expiring',
      title: L(`Dein Extra endet bald: ${row.name.de}`, `Your extra ends soon: ${row.name.en || row.name.de}`),
      body: (l) => {
        const name = row.name[l] || row.name.de;
        return l === 'en'
          ? `“${name}” for your server “${server.name}” runs until ${when(row.paidUntil!, l)}.\n${renewable ? `To keep it, renew it under “My servers” → Manage → Extras (${formatAddonPrice(row.priceCents, l)} for ${formatAddonPeriod(row.periodDays, l)}).` : 'It cannot be renewed at the moment.'}\nNothing is charged automatically. If you do not renew, the extra simply ends and the free offer continues as usual.`
          : `„${name}“ für deinen Server „${server.name}“ läuft bis ${when(row.paidUntil!, l)}.\n${renewable ? `Wenn du es behalten möchtest, verlängere es unter „Meine Server“ → Verwalten → Extras (${formatAddonPrice(row.priceCents, l)} für ${formatAddonPeriod(row.periodDays, l)}).` : 'Es lässt sich derzeit nicht verlängern.'}\nEs wird nichts automatisch abgebucht. Wenn du nicht verlängerst, endet das Extra einfach, und das kostenlose Angebot läuft normal weiter.`;
      },
      dedupeKey: `addon-expiring:${row.id}:${row.paidUntil!.getTime()}`,
      email: true,
    });
    if (created) stats.reminded++;
  }

  if (online()) {
    // 3) Offene Zahlungen nachfragen (falls die Rückmeldung des Zahlungsdienstes ausblieb): frische jede Minute, ältere alle 30 Minuten
    const older = Math.floor(now.getTime() / 60_000) % 30 === 0;
    const open = await db
      .select({ id: serverAddons.id })
      .from(serverAddons)
      .where(and(isNotNull(serverAddons.checkoutId), gt(serverAddons.checkoutAt, new Date(now.getTime() - (older ? POLL_MAX_MS : POLL_RECENT_MS))), inArray(serverAddons.status, ['pending', 'active'])))
      .orderBy(desc(serverAddons.checkoutAt))
      .limit(older ? 100 : 25);
    for (const r of open) if ((await check(r.id)) === 'paid') stats.paid++;

    // 4) Abos: kurz vor dem Ende der Laufzeit abbuchen
    if (!down) {
      const renewals = await db
        .select()
        .from(serverAddons)
        .where(and(eq(serverAddons.status, 'active'), eq(serverAddons.autoRenew, true), isNotNull(serverAddons.mandateId), isNotNull(serverAddons.paidUntil), isNull(serverAddons.checkoutId), isNull(serverAddons.renewalRequestedAt), lte(serverAddons.paidUntil, new Date(now.getTime() + 3 * DAY_MS))))
        .limit(100);
      for (const row of renewals) {
        const result = await chargeRenewal(row, settings, now).catch((err) => {
          console.error('[addons] Abo-Verlängerung fehlgeschlagen', err);
          return 'skipped' as const;
        });
        if (result === 'charged') stats.renewed++;
      }
    }

    // Testzahlungen zählen nur im Testbetrieb: Mit dem Live-Schlüssel enden Buchungen, die nur „zum Test“ bezahlt wurden
    if (!mollieTestMode()) {
      const tests = await db
        .select()
        .from(serverAddons)
        .where(
          and(
            inArray(serverAddons.status, ['pending', 'active']),
            sql`exists (select 1 from ${addonPayments} where ${addonPayments.serverAddonId} = ${serverAddons.id} and ${addonPayments.providerRef} like ${TEST_REF})`,
            sql`not exists (select 1 from ${addonPayments} where ${addonPayments.serverAddonId} = ${serverAddons.id} and ${addonPayments.amountCents} >= 0 and (${addonPayments.providerRef} is null or ${addonPayments.providerRef} not like ${TEST_REF}))`,
          ),
        )
        .limit(100);
      for (const row of tests) {
        if (await endAddon(row, 'admin', { silent: true, unfair: true, note: 'Testzahlung – mit dem Wechsel auf den Live-Schlüssel beendet' })) {
          await audit({ userId: row.userId, serverId: row.serverId, actor: 'system', action: 'addon.test_ended', message: `Extra „${row.name.de}“ (${row.ref}) war nur mit einer Testzahlung bezahlt und wurde mit dem Live-Schlüssel beendet` });
        }
      }
    }

    // Erstattungen nachholen, die nicht geklappt haben (z. B. zu wenig Guthaben bei Mollie)
    if (!down) await retryRefunds(now).catch((err) => console.error('[addons] Erstattungen nachholen fehlgeschlagen', err));

    // 5) Widerruf von Einzugsermächtigungen nachholen, der beim Kündigen nicht geklappt hat
    if (!down) {
      const stale = await db
        .select({ id: serverAddons.id, customerId: serverAddons.customerId, mandateId: serverAddons.mandateId })
        .from(serverAddons)
        .where(and(eq(serverAddons.autoRenew, false), isNotNull(serverAddons.mandateId)))
        .limit(20);
      for (const row of stale) await revokeMandate(row);
    }
  }

  // 6) Unbezahlte Bestellungen verwerfen
  const unpaid = await db
    .select()
    .from(serverAddons)
    .where(and(eq(serverAddons.status, 'pending'), lte(serverAddons.createdAt, new Date(now.getTime() - settings.addons.pendingDays * DAY_MS))))
    .limit(200);
  for (const row of unpaid) {
    // Vorher beim Zahlungsdienst nachsehen – eine bezahlte oder gerade verarbeitete Zahlung wird nie verworfen
    const state = row.checkoutId ? await check(row.id) : 'none';
    if (state === 'paid' || state === 'processing') continue;
    if (unsure(state) && row.checkoutAt && now.getTime() - row.checkoutAt.getTime() < POLL_MAX_MS) continue;
    if (await endAddon(row, 'unpaid', { silent: true })) stats.unpaid++;
  }

  // 7) Abgelaufene Buchungen beenden
  const due = await db
    .select()
    .from(serverAddons)
    .where(and(eq(serverAddons.status, 'active'), isNotNull(serverAddons.paidUntil), lte(serverAddons.paidUntil, now)))
    .limit(300);
  for (const row of due) {
    const state = row.checkoutId ? await check(row.id) : 'none';
    if (state === 'paid') continue;
    const end = row.paidUntil!.getTime();
    // Nachfrist nur, solange wirklich eine Zahlung unterwegs ist: online, wenn die Bank sie gerade verarbeitet; ohne
    // Online-Zahlung, wenn der Kunde die Verlängerung angefragt hat und das Team den Eingang noch bestätigen muss.
    // Wird bezahlt, zählt die Verlängerung ab dem alten Ende – die Nachfrist ist dann mitbezahlt.
    const grace =
      state === 'processing' || (unsure(state) && row.checkoutAt !== null && now.getTime() - row.checkoutAt.getTime() < PROCESSING_GRACE_MS)
        ? PROCESSING_GRACE_MS
        : !online() && row.renewalRequestedAt
          ? Math.min(MANUAL_GRACE_MS, Math.max(row.periodDays, 1) * DAY_MS)
          : 0;
    if (end + grace > now.getTime()) continue;
    if (await endAddon(row, 'expired', { ifPaidUntil: row.paidUntil! })) {
      stats.expired++;
      await audit({ userId: row.userId, serverId: row.serverId, actor: 'system', action: 'addon.expired', message: `Extra „${row.name.de}“ (${row.ref}) abgelaufen und beendet` });
    }
  }

  // 8) Abgleich der Wirkung „24/7“: nie ohne laufende Buchung, und jede laufende Buchung wirkt
  const flagged = await db
    .select({ id: servers.id })
    .from(servers)
    .where(and(isNotNull(servers.alwaysOnSince), ne(servers.status, 'deleted'), sql`not exists (select 1 from ${serverAddons} where ${serverAddons.serverId} = ${servers.id} and ${serverAddons.effect} = 'always_on' and ${serverAddons.status} = 'active')`))
    .limit(100);
  for (const s of flagged) {
    // Endete das letzte 24/7 durch eine zurückgeholte Zahlung oder war es nur eine Testzahlung, gibt es keinen fairen Neustart
    const [last] = await db
      .select({ endReason: serverAddons.endReason, note: serverAddons.adminNote })
      .from(serverAddons)
      .where(and(eq(serverAddons.serverId, s.id), eq(serverAddons.effect, 'always_on'), eq(serverAddons.status, 'ended')))
      .orderBy(desc(serverAddons.endedAt))
      .limit(1);
    await deactivateAlwaysOn(s.id, now, { fair: !(last && (last.endReason === 'refunded' || last.note?.startsWith('Testzahlung'))) });
    stats.healed++;
  }
  const missing = await db
    .select({ id: servers.id })
    .from(servers)
    .innerJoin(serverAddons, eq(serverAddons.serverId, servers.id))
    .where(and(eq(serverAddons.effect, 'always_on'), eq(serverAddons.status, 'active'), ne(servers.status, 'deleted'), or(isNull(servers.alwaysOnSince), ne(servers.cycleEndsAt, NO_CYCLE_END))))
    .limit(100);
  for (const s of missing) {
    // Bleibt ein Server vorerst gesperrt (Auszeit, Discord-Pflicht …), nicht jede Minute neu prüfen
    const tried = healTried.get(s.id);
    if (tried && now.getTime() - tried < HEAL_RETRY_MS) continue;
    if ((await activateAlwaysOn(s.id, now)) === null) {
      healTried.delete(s.id);
      stats.healed++;
    } else {
      if (healTried.size > 5000) healTried.clear();
      healTried.set(s.id, now.getTime());
    }
  }
  return stats;
}

/* ------------------------------------------------------------ Admin */

function paging(page: number | undefined, total: number): PageInfo & { offset: number } {
  const pages = Math.max(1, Math.ceil(total / ADMIN_PAGE_SIZE));
  const p = Math.min(Math.max(1, Math.floor(page ?? 1)), pages);
  return { page: p, pageSize: ADMIN_PAGE_SIZE, total, pages, offset: (p - 1) * ADMIN_PAGE_SIZE };
}

const escapeLike = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

/** Echte Zahlungen (ohne Testzahlungen) – für Einnahmen und „bezahlt“-Summen */
const realMoney = sql`(${addonPayments.providerRef} is null or ${addonPayments.providerRef} not like ${TEST_REF})`;
/** Vorgänge, die das Team sehen soll (Admin → Extras → Hinweise) */
const NOTICE_URGENT = ['addon.refund_failed', 'addon.chargeback', 'addon.oversold', 'addon.renewal_stuck'];
const NOTICE_INFO = ['addon.payment_refunded', 'addon.cancel_request_unmatched', 'addon.ended_server_deleted', 'addon.renewal_failed', 'addon.test_ended', 'addon.always_on_waiting'];

const countsSelect = {
  active: sql<number>`sum(case when ${serverAddons.status} = 'active' then 1 else 0 end)`,
  awaiting: sql<number>`sum(case when ${serverAddons.status} = 'pending' or (${serverAddons.status} = 'active' and ${serverAddons.renewalRequestedAt} is not null) then 1 else 0 end)`,
  tasks: sql<number>`sum(case when ${serverAddons.fulfilment} in ('todo','revoke') then 1 else 0 end)`,
  subscriptions: sql<number>`sum(case when ${serverAddons.status} = 'active' and ${serverAddons.autoRenew} = 1 then 1 else 0 end)`,
  runRate: sql<number>`sum(case when ${serverAddons.status} = 'active' and ${serverAddons.periodDays} > 0 then ${serverAddons.priceCents} * 30.0 / ${serverAddons.periodDays} else 0 end)`,
};

/** Zahlen für die Admin-Übersicht */
export async function addonCounts(): Promise<{ active: number; awaitingPayment: number; tasks: number }> {
  const [a] = await db.select(countsSelect).from(serverAddons);
  return { active: Number(a?.active ?? 0), awaitingPayment: Number(a?.awaiting ?? 0), tasks: Number(a?.tasks ?? 0) };
}

export async function listAdminAddons(filter: { q?: string; status?: string; page?: number }): Promise<AdminAddonsDTO> {
  const settings = await getSettings();
  const now = new Date();
  const q = filter.q?.trim();
  const conds = [];
  if (filter.status === 'pending') conds.push(or(eq(serverAddons.status, 'pending'), and(eq(serverAddons.status, 'active'), isNotNull(serverAddons.renewalRequestedAt))));
  else if (filter.status === 'active') conds.push(eq(serverAddons.status, 'active'));
  else if (filter.status === 'subscriptions') conds.push(and(eq(serverAddons.status, 'active'), eq(serverAddons.autoRenew, true)));
  else if (filter.status === 'ended') conds.push(eq(serverAddons.status, 'ended'));
  else if (filter.status === 'tasks') conds.push(inArray(serverAddons.fulfilment, ['todo', 'revoke']));
  if (q) {
    const p = `%${escapeLike(q)}%`;
    const has = (col: Parameters<typeof eq>[0]) => sql`${col} like ${p} escape '\\'`;
    conds.push(or(has(serverAddons.ref), has(users.email), has(servers.name), has(serverAddons.addonId)));
  }
  const where = conds.length ? and(...conds) : undefined;
  // Konto und Server können inzwischen gelöscht sein – die Buchung bleibt für Aufgaben und Buchhaltung sichtbar
  const [totalRow] = await db.select({ n: count() }).from(serverAddons).leftJoin(users, eq(users.id, serverAddons.userId)).leftJoin(servers, eq(servers.id, serverAddons.serverId)).where(where);
  const { offset, ...info } = paging(filter.page, Number(totalRow?.n ?? 0));
  const list = await db
    .select({ row: serverAddons, email: users.email, serverName: servers.name, serverStatus: servers.status, kind: servers.kind, planId: servers.planId })
    .from(serverAddons)
    .leftJoin(users, eq(users.id, serverAddons.userId))
    .leftJoin(servers, eq(servers.id, serverAddons.serverId))
    .where(where)
    // Zuerst, was etwas von uns braucht: Aufgaben und offene Zahlungen
    .orderBy(sql`case when ${serverAddons.fulfilment} in ('todo','revoke') then 0 when ${serverAddons.status} = 'pending' or ${serverAddons.renewalRequestedAt} is not null then 1 when ${serverAddons.status} = 'active' then 2 else 3 end`, desc(serverAddons.createdAt))
    .limit(ADMIN_PAGE_SIZE)
    .offset(offset);
  const ids = list.map((l) => l.row.id);
  const paid = ids.length
    ? await db
        .select({ id: addonPayments.serverAddonId, cents: sql<number>`sum(${addonPayments.amountCents})`, n: sql<number>`sum(case when ${addonPayments.amountCents} >= 0 then 1 else 0 end)` })
        .from(addonPayments)
        .where(and(inArray(addonPayments.serverAddonId, ids), realMoney))
        .groupBy(addonPayments.serverAddonId)
    : [];
  const paidBy = new Map(paid.map((p) => [p.id, p]));
  const rows: AdminAddonRowDTO[] = list.map(({ row, email, serverName, serverStatus, kind, planId }) => {
    const { payment: _payment, canRenew: _canRenew, canSubscribe: _canSubscribe, ...dto } = toDTO(row, settings, 'de', now, kind && planId ? { kind, planId } : null);
    return { ...dto, userId: row.userId, userEmail: email ?? '', serverId: row.serverId, serverName: serverName ?? '', serverStatus: serverStatus ?? 'deleted', adminNote: row.adminNote, paidCents: Number(paidBy.get(row.id)?.cents ?? 0), payments: Number(paidBy.get(row.id)?.n ?? 0), checkoutPending: row.checkoutId !== null, chargebackBlocked: false };
  });
  const [a] = await db.select(countsSelect).from(serverAddons);
  const [rev] = await db
    .select({ cents: sql<number>`coalesce(sum(${addonPayments.amountCents}), 0)` })
    .from(addonPayments)
    .where(and(gt(addonPayments.createdAt, new Date(now.getTime() - 30 * DAY_MS)), realMoney));
  // Was das Team wissen muss, steht sonst nur im Protokoll: nicht zuordenbare Zahlungen, Rückbuchungen, Kündigungen ohne Treffer …
  // Dringendes und bloß Informatives getrennt – viele unwichtige Einträge können Wichtiges nicht verdrängen
  const noticesOf = (actions: string[], limit: number) =>
    db
      .select({ at: auditLogs.createdAt, action: auditLogs.action, message: auditLogs.message })
      .from(auditLogs)
      .where(and(inArray(auditLogs.action, actions), gt(auditLogs.createdAt, new Date(now.getTime() - 14 * DAY_MS))))
      .orderBy(desc(auditLogs.id))
      .limit(limit);
  const noticeRows = [...(await noticesOf(NOTICE_URGENT, 20)), ...(await noticesOf(NOTICE_INFO, 10))];
  // Offene Erstattungen bleiben stehen, bis das Geld wirklich zurück ist
  const due = await refundsDue(now);
  const blocked = new Set<string>();
  for (const userId of new Set(list.map((l) => l.row.userId))) if (await chargebackBlocked(userId, now)) blocked.add(userId);
  for (const r of rows) r.chargebackBlocked = blocked.has(r.userId);
  return {
    rows,
    notices: noticeRows.map((n) => ({ at: n.at.toISOString(), action: n.action, message: n.message, urgent: NOTICE_URGENT.includes(n.action) })),
    refundsDue: due.map((d) => ({ ref: d.payment.ref, name: d.payment.addonName, cents: d.openCents, paymentId: d.payment.providerRef?.split(':')[1] ?? '', since: d.payment.createdAt.toISOString() })),
    ...info,
    stats: { active: Number(a?.active ?? 0), awaitingPayment: Number(a?.awaiting ?? 0), tasks: Number(a?.tasks ?? 0), subscriptions: Number(a?.subscriptions ?? 0), revenue30dCents: Number(rev?.cents ?? 0), monthlyRunRateCents: Math.round(Number(a?.runRate ?? 0)) },
    payment: { online: online(), testMode: mollieTestMode(), webhookUrl: paymentWebhookUrl() },
  };
}

async function adminRow(rowId: string): Promise<ServerAddon> {
  const [row] = await db.select().from(serverAddons).where(eq(serverAddons.id, rowId)).limit(1);
  if (!row) throw Errors.notFound(L('Buchung nicht gefunden.', 'Booking not found.'));
  return row;
}

/**
 * Zahlungseingang von Hand bestätigen: schaltet eine Bestellung frei bzw. verlängert eine laufende Buchung, für die
 * der Kunde die Verlängerung angefragt hat. Ohne offene Zahlung passiert nichts (kein doppeltes Verlängern).
 */
export async function adminConfirmAddonPayment(admin: Pick<User, 'email'>, rowId: string, amountCents?: number): Promise<void> {
  const row = await adminRow(rowId);
  // Läuft dazu gerade eine Online-Zahlung, zuerst deren Stand holen (sonst doppelte Verlängerung)
  if (row.checkoutId) {
    const state = await checkAddonPayment(row.id);
    if (state === 'paid') return;
    if (state === 'processing') throw Errors.conflict('payment_processing', L('Für diese Buchung läuft gerade eine Online-Zahlung, die die Bank noch verarbeitet. Bitte abwarten.', 'An online payment for this booking is currently being processed by the bank. Please wait.'));
    if (unsure(state)) throw paymentUnavailable();
  }
  await applyPayment(row.id, { provider: 'manual', providerRef: null, amountCents: amountCents ?? row.priceCents, confirmedBy: admin.email });
}

/** Buchung beenden. `refundCents`: von Hand erstatteter Betrag (bei Online-Zahlungen verbucht das System die Erstattung selbst) */
export async function adminEndAddon(admin: Pick<User, 'email'>, rowId: string, input: { refunded: boolean; note: string; refundCents?: number }, ip?: string): Promise<void> {
  const row = await adminRow(rowId);
  if (row.status === 'ended') throw Errors.conflict('already_ended', L('Diese Buchung ist schon beendet.', 'This booking has already ended.'));
  if (!(await endAddon(row, input.refunded ? 'refunded' : 'admin', { note: input.note }))) throw Errors.conflict('state_changed', L('Der Stand hat sich geändert. Bitte lade die Seite neu.', 'The state has changed. Please reload the page.'));
  const refund = input.refunded ? Math.max(0, Math.round(input.refundCents ?? 0)) : 0;
  if (refund > 0) {
    await db.insert(addonPayments).values({ id: uuid(), serverAddonId: row.id, ref: row.ref, userId: row.userId, serverId: row.serverId, addonId: row.addonId, addonName: row.name.de, amountCents: -refund, periodDays: 0, provider: 'manual', providerRef: null, confirmedBy: admin.email });
  }
  await audit({ userId: row.userId, serverId: row.serverId, actor: 'admin', action: 'admin.addon_ended', message: `Extra „${row.name.de}“ (${row.ref}) beendet${input.refunded ? ` (erstattet${refund > 0 ? `: ${formatAddonPrice(refund, 'de')}` : ''})` : ''}${input.note ? `: ${input.note.slice(0, 200)}` : ''} (durch ${admin.email})`, ip });
}

/** Laufzeit verschenken bzw. kürzen (Tage, auch negativ) – ohne Zahlung */
export async function adminExtendAddon(admin: Pick<User, 'email'>, rowId: string, days: number, ip?: string): Promise<void> {
  const row = await adminRow(rowId);
  if (row.status !== 'active' || !row.paidUntil) throw Errors.conflict('not_extendable', L('Nur laufende Buchungen mit Enddatum lassen sich verlängern.', 'Only running bookings with an end date can be extended.'));
  const paidUntil = new Date(Math.max(Date.now() + 60_000, row.paidUntil.getTime() + days * DAY_MS));
  const res = await db.update(serverAddons).set({ paidUntil }).where(and(eq(serverAddons.id, row.id), eq(serverAddons.status, 'active'), eq(serverAddons.paidUntil, row.paidUntil)));
  if (affectedRows(res) !== 1) throw Errors.conflict('state_changed', L('Der Stand hat sich geändert. Bitte lade die Seite neu.', 'The state has changed. Please reload the page.'));
  await audit({ userId: row.userId, serverId: row.serverId, actor: 'admin', action: 'admin.addon_extended', message: `Extra „${row.name.de}“ (${row.ref}) um ${days} Tage ${days >= 0 ? 'verlängert' : 'gekürzt'} – läuft bis ${when(paidUntil, 'de')} (durch ${admin.email})`, ip });
}

/** Aufgabe des Teams abhaken: eingerichtet (todo → done, Kunde wird benachrichtigt) bzw. zurückgenommen (revoke → none) */
export async function adminFulfilAddon(admin: Pick<User, 'email'>, rowId: string, ip?: string): Promise<void> {
  const row = await adminRow(rowId);
  if (row.fulfilment === 'todo') {
    const res = await db.update(serverAddons).set({ fulfilment: 'done' }).where(and(eq(serverAddons.id, row.id), eq(serverAddons.fulfilment, 'todo')));
    if (affectedRows(res) !== 1) return;
    const [server] = await db.select({ name: servers.name }).from(servers).where(eq(servers.id, row.serverId)).limit(1);
    await tell(row, {
      serverId: row.serverId,
      type: 'addon.fulfilled',
      title: L(`Eingerichtet: ${row.name.de}`, `Set up: ${row.name.en || row.name.de}`),
      body: (l) => (l === 'en' ? `We have set up “${row.name.en || row.name.de}” for your server “${server?.name ?? ''}”. Have fun!` : `Wir haben „${row.name.de}“ für deinen Server „${server?.name ?? ''}“ eingerichtet. Viel Spaß damit!`),
      dedupeKey: `addon-fulfilled:${row.id}:${row.activatedAt?.getTime() ?? 0}`,
      email: true,
    });
    await audit({ userId: row.userId, serverId: row.serverId, actor: 'admin', action: 'admin.addon_fulfilled', message: `Extra „${row.name.de}“ (${row.ref}) eingerichtet (durch ${admin.email})`, ip });
  } else if (row.fulfilment === 'revoke') {
    await db.update(serverAddons).set({ fulfilment: 'none' }).where(and(eq(serverAddons.id, row.id), eq(serverAddons.fulfilment, 'revoke')));
    await audit({ userId: row.userId, serverId: row.serverId, actor: 'admin', action: 'admin.addon_revoked', message: `Extra „${row.name.de}“ (${row.ref}) nach dem Ende zurückgenommen (durch ${admin.email})`, ip });
  } else throw Errors.conflict('nothing_to_do', L('Für diese Buchung ist nichts zu erledigen.', 'There is nothing to do for this booking.'));
}

/** Extra kostenlos vergeben (z. B. Aktion, Entschädigung, Gewinnspiel) – ohne Bestellung und Zahlung */
export async function adminGrantAddon(admin: Pick<User, 'email'>, input: { serverId: string; addonId: string; days: number | null }, ip?: string): Promise<void> {
  const settings = await getSettings();
  const addon = settings.addons.items.find((a) => a.id === input.addonId);
  if (!addon) throw Errors.conflict('addon_unknown', L('Dieses Extra gibt es nicht (mehr).', 'This extra does not exist (any more).'));
  // Volle Server-ID oder ihr Anfang, wie er im Reiter „Server“ steht (mindestens 8 Zeichen, muss eindeutig sein)
  const wanted = input.serverId.trim().toLowerCase();
  if (!/^[0-9a-f-]{8,36}$/.test(wanted)) throw Errors.notFound(L('Server nicht gefunden.', 'Server not found.'));
  const found = await db
    .select()
    .from(servers)
    .where(wanted.length === 36 ? eq(servers.id, wanted) : sql`${servers.id} like ${`${wanted}%`}`)
    .limit(2);
  const server = found.length === 1 ? found[0] : undefined;
  if (!server || server.status === 'deleted' || server.partnerId) throw Errors.notFound(L('Server nicht gefunden.', 'Server not found.'));
  const id = uuid();
  const periodDays = input.days === null ? 0 : Math.max(1, Math.min(3660, Math.round(input.days)));
  await writeTx(async (tx) => {
    const [same] = await tx
      .select({ id: serverAddons.id })
      .from(serverAddons)
      .where(and(eq(serverAddons.serverId, server.id), eq(serverAddons.addonId, addon.id), inArray(serverAddons.status, ['pending', 'active'])))
      .limit(1);
    if (same) throw Errors.conflict('already_booked', L('Dieses Extra läuft für diesen Server schon bzw. ist bestellt.', 'This extra is already running or ordered for this server.'));
    await tx.insert(serverAddons).values({ id, ref: newRef(), userId: server.userId, serverId: server.id, addonId: addon.id, name: addon.name, icon: addon.icon, effect: addon.effect, priceCents: 0, periodDays, status: 'pending' });
  });
  await applyPayment(id, { provider: 'admin', providerRef: null, amountCents: 0, confirmedBy: admin.email, periodDays });
  await audit({ userId: server.userId, serverId: server.id, actor: 'admin', action: 'admin.addon_granted', message: `Extra „${addon.name.de}“ kostenlos für „${server.name}“ vergeben (${periodDays ? `${periodDays} Tage` : 'unbefristet'}) (durch ${admin.email})`, ip });
}

export async function adminAddonNote(rowId: string, note: string): Promise<void> {
  const row = await adminRow(rowId);
  await db.update(serverAddons).set({ adminNote: note.trim().slice(0, 500) || null }).where(eq(serverAddons.id, row.id));
}

/** Sperre nach einer zurückgeholten Zahlung aufheben (z. B. nachdem der Kunde den Betrag nachgezahlt hat) */
export async function adminClearChargeback(admin: Pick<User, 'email'>, userId: string, ip?: string): Promise<void> {
  if (!(await chargebackBlocked(userId))) throw Errors.conflict('nothing_to_do', L('Für dieses Konto besteht keine Sperre.', 'There is no block for this account.'));
  await db.insert(addonPayments).values({ id: uuid(), serverAddonId: '', ref: '', userId, serverId: '', addonId: '', addonName: 'Sperre nach Rücklastschrift aufgehoben', amountCents: 0, periodDays: 0, provider: 'admin', providerRef: `chargeback-cleared:${uuid()}`, confirmedBy: admin.email });
  await audit({ userId, actor: 'admin', action: 'admin.addon_chargeback_cleared', message: `Sperre nach Rücklastschrift aufgehoben – das Konto kann wieder Extras buchen (durch ${admin.email})`, ip });
}
