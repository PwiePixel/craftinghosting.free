/**
 * Extras (kostenpflichtige Add-ons) für kostenlose Server: bestellen, bezahlen, freischalten, verlängern, ablaufen.
 *
 * Grundsätze:
 *  – Bezahlt wird im Voraus für eine Laufzeit. Es gibt keine automatische Verlängerung; ohne neue Zahlung endet das
 *    Extra von selbst, und für den Server gelten wieder die normalen Regeln des kostenlosen Angebots.
 *  – Freigeschaltet wird nur durch eine bestätigte Zahlung: entweder prüft das System sie selbst beim Zahlungsanbieter
 *    (SumUp – die Rückmeldung des Anbieters allein genügt nie), oder das Team bestätigt den Zahlungseingang.
 *  – Preis, Laufzeit und Wirkung kommen immer aus dem Katalog auf dem Server, nie aus der Anfrage des Kunden.
 *  – Die Wirkung „24/7“ hängt an genau einer Stelle am Server (alwaysOnSince); ein Abgleich im Job stellt sicher, dass
 *    sie nie ohne laufende Buchung bestehen bleibt.
 */
import { randomInt } from 'node:crypto';
import { and, count, desc, eq, gt, inArray, isNotNull, isNull, like, lte, ne, or, sql } from 'drizzle-orm';
import {
  ADMIN_PAGE_SIZE,
  NO_CYCLE_END,
  addonFits,
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
import { addonPayments, serverAddons, servers, users, type Server, type ServerAddon, type User } from '../db/schema';
import { env } from '../env';
import { uuid } from '../lib/crypto';
import { ApiError, Errors, L } from '../lib/errors';
import { createSumupCheckout, getSumupCheckout, sumupConfigured, SumupError } from '../payments/sumup';
import { pterodactyl } from '../pterodactyl';
import { audit } from './audit.service';
import { notify } from './notification.service';
import { trySyncPanelDescription } from './panel';
import { assertNoTimeout } from './sanction-gate';
import { getSettings } from './settings.service';

const DAY_MS = 86_400_000;
/** Eine SumUp-Bezahlseite gilt 30 Minuten – danach legen wir eine neue an */
const CHECKOUT_TTL_MS = 25 * 60_000;
/** So lange fragen wir eine offene Bezahlseite selbst nach (falls die Rückmeldung des Anbieters ausbleibt) */
const CHECKOUT_POLL_MS = 2 * 60 * 60_000;
/** Höchstzahl offener (unbezahlter) Bestellungen je Konto */
const MAX_PENDING_PER_USER = 5;
/** Nachfrist, wenn der Kunde eine Verlängerung angekündigt hat (Zeit für die Bestätigung des Zahlungseingangs) */
const RENEWAL_GRACE_MS = 2 * DAY_MS;

const tz = () => freeHostingConfig.fairUse.timezone;
const when = (d: Date, l: Locale) => formatDateTime(d, tz(), l);

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

/** Wie viele Buchungen eines Extras laufen bzw. sind bestellt (für die Höchstzahl) */
async function occupied(addonId: string): Promise<number> {
  const [r] = await db
    .select({ n: count() })
    .from(serverAddons)
    .where(and(eq(serverAddons.addonId, addonId), inArray(serverAddons.status, ['pending', 'active'])));
  return Number(r?.n ?? 0);
}

/* ------------------------------------------------------------ Ansicht für Kunden */

const usesCheckout = (): boolean => sumupConfigured();

function paymentFor(row: ServerAddon, settings: SiteSettings, lang: Locale): AddonPaymentDTO | null {
  const open = row.status === 'pending' || (row.status === 'active' && row.renewalRequestedAt !== null);
  if (!open) return null;
  if (usesCheckout()) {
    const fresh = row.checkoutUrl && row.checkoutAt && Date.now() - row.checkoutAt.getTime() < CHECKOUT_TTL_MS;
    return { mode: 'checkout', url: fresh ? row.checkoutUrl : null, reference: row.ref, amountCents: row.priceCents, note: '' };
  }
  const addon = settings.addons.items.find((a) => a.id === row.addonId);
  return { mode: 'link', url: addon?.paymentUrl || null, reference: row.ref, amountCents: row.priceCents, note: settings.addons.paymentNote[lang] || settings.addons.paymentNote.de };
}

function canRenew(row: ServerAddon, settings: SiteSettings, now: Date): boolean {
  if (row.status !== 'active' || !row.paidUntil || row.priceCents <= 0) return false;
  const addon = settings.addons.items.find((a) => a.id === row.addonId);
  if (!settings.addons.enabled || !addon || !addon.enabled || addon.periodDays <= 0 || addon.priceCents <= 0) return false;
  // Nicht beliebig weit im Voraus: höchstens drei Laufzeiten
  return row.paidUntil.getTime() - now.getTime() < 3 * addon.periodDays * DAY_MS;
}

function toDTO(row: ServerAddon, settings: SiteSettings, lang: Locale, now: Date): ServerAddonDTO {
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
    canRenew: canRenew(row, settings, now),
    payment: paymentFor(row, settings, lang),
  };
}

async function viewFor(server: Server, lang: Locale): Promise<ServerAddonsDTO> {
  const settings = await getSettings();
  const now = new Date();
  const rows = await db.select().from(serverAddons).where(eq(serverAddons.serverId, server.id)).orderBy(desc(serverAddons.createdAt)).limit(60);
  const open = rows.filter((r) => r.status !== 'ended');
  const ended = rows.filter((r) => r.status === 'ended').slice(0, 5);
  const catalog = settings.addons.enabled ? settings.addons.items.filter((a) => a.enabled && a.priceCents > 0 && addonFits(a, server)) : [];
  const offers: AddonOfferDTO[] = [];
  for (const a of catalog) {
    const booked = open.some((r) => r.addonId === a.id);
    const soldOut = !booked && a.maxActive !== null && (await occupied(a.id)) >= a.maxActive;
    offers.push({ ...publicAddon(a), available: !booked && !soldOut && orderable(server), unavailable: booked ? 'booked' : soldOut ? 'sold_out' : null });
  }
  return {
    enabled: settings.addons.enabled,
    priceNote: settings.addons.priceNote[lang] || settings.addons.priceNote.de,
    requireAdultConfirm: settings.addons.requireAdultConfirm,
    offers,
    booked: [...open, ...ended].map((r) => toDTO(r, settings, lang, now)),
  };
}

export async function listServerAddons(user: User, serverId: string, lang: Locale): Promise<ServerAddonsDTO> {
  return viewFor(await ownServer(user, serverId), lang);
}

/* ------------------------------------------------------------ Bestellen, verlängern, bezahlen */

export interface AddonConsent {
  acceptTerms: boolean;
  acceptEarlyStart: boolean;
  adult?: boolean;
}

function assertConsent(c: AddonConsent, settings: SiteSettings): void {
  const fields: Record<string, ReturnType<typeof L>> = {};
  if (c.acceptTerms !== true) fields.acceptTerms = L('Bitte stimme den Bedingungen zu.', 'Please accept the terms.');
  if (c.acceptEarlyStart !== true) fields.acceptEarlyStart = L('Bitte bestätige, dass wir sofort mit der Leistung beginnen dürfen.', 'Please confirm that we may start the service immediately.');
  if (settings.addons.requireAdultConfirm && c.adult !== true) fields.adult = L('Bitte bestätige, dass du volljährig bist oder die Zustimmung deiner Erziehungsberechtigten hast.', 'Please confirm that you are of legal age or have the consent of your legal guardian.');
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

/**
 * Bezahlweg für eine offene Bestellung bzw. Verlängerung öffnen. Mit SumUp: Bezahlseite anlegen (oder die noch gültige
 * wiederverwenden) und ihre Adresse zurückgeben. Ohne: null – dann gilt der Zahlungslink aus den Einstellungen.
 */
async function openCheckout(row: ServerAddon, lang: Locale): Promise<string | null> {
  if (!usesCheckout()) return null;
  if (row.checkoutUrl && row.checkoutAt && Date.now() - row.checkoutAt.getTime() < CHECKOUT_TTL_MS) return row.checkoutUrl;
  const n = row.checkoutCount + 1;
  const base = env.APP_URL.replace(/\/$/, '');
  let checkout;
  try {
    checkout = await createSumupCheckout({
      reference: `${row.ref}-${n}`,
      amountCents: row.priceCents,
      description: `${row.name.de} (${row.ref})`,
      webhookUrl: `${base}/api/v1/payments/sumup/webhook`,
      redirectUrl: `${base}/api/v1/payments/return?s=${encodeURIComponent(row.serverId)}&lang=${lang}`,
    });
  } catch (err) {
    console.warn('[addons] Bezahlseite konnte nicht angelegt werden:', (err as Error).message);
    throw new ApiError(503, 'payment_unavailable', L('Die Bezahlseite ist gerade nicht erreichbar. Bitte versuche es gleich noch einmal.', 'The payment page is not available right now. Please try again shortly.'));
  }
  await db.update(serverAddons).set({ checkoutId: checkout.id, checkoutUrl: checkout.hostedUrl, checkoutAt: new Date(), checkoutCount: n }).where(eq(serverAddons.id, row.id));
  return checkout.hostedUrl;
}

export async function orderAddon(user: User, serverId: string, addonId: string, consent: AddonConsent, lang: Locale, ip?: string): Promise<{ addons: ServerAddonsDTO; orderId: string; checkoutUrl: string | null }> {
  assertNoTimeout(user);
  const server = await ownServer(user, serverId);
  const settings = await getSettings();
  const addon = catalogItem(settings, addonId, server);
  assertConsent(consent, settings);
  if (!orderable(server)) throw Errors.conflict('server_not_eligible', L('Für diesen Server lassen sich gerade keine Extras buchen (gesperrt oder noch nicht eingerichtet).', 'Extras cannot be booked for this server right now (suspended or not set up yet).'));

  const id = uuid();
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
    if (addon.maxActive !== null) {
      const [used] = await tx
        .select({ n: count() })
        .from(serverAddons)
        .where(and(eq(serverAddons.addonId, addon.id), inArray(serverAddons.status, ['pending', 'active'])));
      if (Number(used?.n ?? 0) >= addon.maxActive) throw Errors.conflict('sold_out', L('Dieses Extra ist gerade ausgebucht.', 'This extra is fully booked at the moment.'));
    }
    for (let attempt = 0; ; attempt++) {
      try {
        await tx.insert(serverAddons).values({ id, ref: newRef(), userId: user.id, serverId: server.id, addonId: addon.id, name: addon.name, icon: addon.icon, effect: addon.effect, priceCents: addon.priceCents, periodDays: addon.periodDays, status: 'pending', consentAt: new Date() });
        break;
      } catch (err) {
        if (!isUniqueViolation(err) || attempt >= 4) throw err;
      }
    }
  });
  const [row] = await db.select().from(serverAddons).where(eq(serverAddons.id, id)).limit(1);
  await audit({ userId: user.id, serverId: server.id, actor: 'user', action: 'addon.ordered', message: `Extra „${addon.name.de}“ für „${server.name}“ bestellt (${formatAddonPrice(addon.priceCents, 'de')}, ${formatAddonPeriod(addon.periodDays, 'de')}, Verwendungszweck ${row!.ref})`, ip });
  let checkoutUrl: string | null = null;
  try {
    checkoutUrl = await openCheckout(row!, lang);
  } catch {
    // Die Bestellung steht – bezahlt wird dann über „Jetzt bezahlen“ in der Liste
  }
  return { addons: await viewFor(server, lang), orderId: id, checkoutUrl };
}

/** „Jetzt bezahlen“ für eine offene Bestellung oder angefragte Verlängerung */
export async function payAddon(user: User, serverId: string, rowId: string, lang: Locale): Promise<{ addons: ServerAddonsDTO; checkoutUrl: string | null }> {
  const { server, row } = await ownRow(user, serverId, rowId);
  const open = row.status === 'pending' || (row.status === 'active' && row.renewalRequestedAt !== null);
  if (!open) throw Errors.conflict('nothing_to_pay', L('Für diese Buchung ist keine Zahlung offen.', 'No payment is due for this booking.'));
  const checkoutUrl = await openCheckout(row, lang);
  return { addons: await viewFor(server, lang), checkoutUrl };
}

/** Verlängerung anfragen: gilt zum aktuellen Preis des Katalogs und schließt an die laufende Zeit an */
export async function renewAddon(user: User, serverId: string, rowId: string, consent: AddonConsent, lang: Locale, ip?: string): Promise<{ addons: ServerAddonsDTO; checkoutUrl: string | null }> {
  assertNoTimeout(user);
  const { server, row } = await ownRow(user, serverId, rowId);
  const settings = await getSettings();
  if (!canRenew(row, settings, new Date())) throw Errors.conflict('not_renewable', L('Diese Buchung lässt sich gerade nicht verlängern.', 'This booking cannot be renewed right now.'));
  const addon = catalogItem(settings, row.addonId, server);
  assertConsent(consent, settings);
  // Preis oder Laufzeit haben sich geändert: Die Verlängerung gilt zu den neuen Bedingungen – eine alte Bezahlseite verfällt
  const changed = addon.priceCents !== row.priceCents || addon.periodDays !== row.periodDays;
  const res = await db
    .update(serverAddons)
    .set({ renewalRequestedAt: new Date(), priceCents: addon.priceCents, periodDays: addon.periodDays, consentAt: new Date(), ...(changed ? { checkoutId: null, checkoutUrl: null, checkoutAt: null } : {}) })
    .where(and(eq(serverAddons.id, row.id), eq(serverAddons.status, 'active')));
  if (affectedRows(res) !== 1) throw Errors.conflict('state_changed', L('Der Stand hat sich geändert. Bitte lade die Seite neu.', 'The state has changed. Please reload the page.'));
  const [fresh] = await db.select().from(serverAddons).where(eq(serverAddons.id, row.id)).limit(1);
  await audit({ userId: user.id, serverId: server.id, actor: 'user', action: 'addon.renewal_requested', message: `Verlängerung von „${row.name.de}“ für „${server.name}“ angefragt (${formatAddonPrice(addon.priceCents, 'de')}, Verwendungszweck ${row.ref})`, ip });
  let checkoutUrl: string | null = null;
  try {
    checkoutUrl = await openCheckout(fresh!, lang);
  } catch {
    /* Bezahlen später über „Jetzt bezahlen“ */
  }
  return { addons: await viewFor(server, lang), checkoutUrl };
}

/** Offene Bestellung stornieren bzw. angefragte Verlängerung zurücknehmen (nichts bezahlt → nichts zu erstatten) */
export async function cancelAddonOrder(user: User, serverId: string, rowId: string, lang: Locale, ip?: string): Promise<ServerAddonsDTO> {
  const { server, row } = await ownRow(user, serverId, rowId);
  // Läuft gerade eine Zahlung über die Bezahlseite, erst deren Ergebnis holen – sonst würde eine bezahlte Bestellung storniert
  if (row.checkoutId) await checkAddonPayment(row.id).catch(() => {});
  const [now] = await db.select().from(serverAddons).where(eq(serverAddons.id, row.id)).limit(1);
  if (now?.status === 'pending') {
    await endAddon(now, 'canceled', { silent: true });
    await audit({ userId: user.id, serverId: server.id, actor: 'user', action: 'addon.canceled', message: `Bestellung „${row.name.de}“ (${row.ref}) storniert`, ip });
  } else if (now?.status === 'active' && now.renewalRequestedAt) {
    await db.update(serverAddons).set({ renewalRequestedAt: null, checkoutId: null, checkoutUrl: null, checkoutAt: null }).where(eq(serverAddons.id, row.id));
  }
  return viewFor(server, lang);
}

/* ------------------------------------------------------------ Zahlung bestätigen */

type PaymentSource = { provider: 'manual' | 'sumup' | 'admin'; providerRef: string | null; amountCents: number; confirmedBy: string; periodDays?: number };

/**
 * Bestätigte Zahlung verbuchen und das Extra freischalten bzw. verlängern. Jede Zahlung des Anbieters zählt genau
 * einmal (eindeutige providerRef) – eine doppelt gemeldete Zahlung verlängert nicht doppelt.
 */
async function applyPayment(rowId: string, pay: PaymentSource): Promise<'applied' | 'duplicate' | 'orphan'> {
  const now = new Date();
  let outcome = 'applied' as 'applied' | 'duplicate' | 'orphan';
  let activated = false;
  let row: ServerAddon | undefined;
  let server: Server | undefined;
  await writeTx(async (tx) => {
    [row] = await tx.select().from(serverAddons).where(eq(serverAddons.id, rowId)).limit(1);
    if (!row) {
      outcome = 'orphan';
      return;
    }
    [server] = await tx.select().from(servers).where(eq(servers.id, row.serverId)).limit(1);
    const periodDays = pay.periodDays ?? row.periodDays;
    try {
      await tx.insert(addonPayments).values({ id: uuid(), serverAddonId: row.id, ref: row.ref, userId: row.userId, serverId: row.serverId, addonId: row.addonId, addonName: row.name.de, amountCents: pay.amountCents, periodDays, provider: pay.provider, providerRef: pay.providerRef, confirmedBy: pay.confirmedBy });
    } catch (err) {
      if (isUniqueViolation(err)) {
        outcome = 'duplicate';
        return;
      }
      throw err;
    }
    // Server inzwischen gelöscht: Die Zahlung ist verbucht, freischalten lässt sich nichts mehr – das Team erstattet
    if (!server || server.status === 'deleted') {
      outcome = 'orphan';
      return;
    }
    const running = row.status === 'active' && row.paidUntil !== null && row.paidUntil > now;
    const base = running ? row.paidUntil! : now;
    const unlimited = row.status === 'active' && row.paidUntil === null;
    const paidUntil = periodDays > 0 && !unlimited ? new Date(base.getTime() + periodDays * DAY_MS) : null;
    activated = row.status !== 'active';
    const fulfilment = row.effect !== 'manual' ? 'none' : row.fulfilment === 'none' ? 'todo' : row.fulfilment === 'revoke' ? 'done' : row.fulfilment;
    await tx
      .update(serverAddons)
      .set({ status: 'active', paidUntil, activatedAt: row.activatedAt && !activated ? row.activatedAt : now, renewalRequestedAt: null, checkoutId: null, checkoutUrl: null, checkoutAt: null, endedAt: null, endReason: null, fulfilment })
      .where(eq(serverAddons.id, row.id));
    row = { ...row, status: 'active', paidUntil, fulfilment };
  });
  if (!row) return 'orphan';
  if (outcome === 'duplicate') return outcome;
  if (outcome === 'orphan') {
    await audit({ userId: row.userId, serverId: row.serverId, actor: 'system', action: 'addon.payment_orphan', message: `Zahlung für „${row.name.de}“ (${row.ref}, ${formatAddonPrice(pay.amountCents, 'de')}) eingegangen, aber den Server gibt es nicht mehr – bitte erstatten` });
    return outcome;
  }
  if (row.effect === 'always_on') await activateAlwaysOn(row.serverId, now);
  const until = row.paidUntil;
  await audit({
    userId: row.userId,
    serverId: row.serverId,
    actor: pay.provider === 'sumup' ? 'system' : 'admin',
    action: activated ? 'addon.activated' : 'addon.renewed',
    message: `Extra „${row.name.de}“ (${row.ref}) für „${server!.name}“ ${activated ? 'freigeschaltet' : 'verlängert'}${until ? ` bis ${when(until, 'de')}` : ' (unbefristet)'} – ${pay.provider === 'admin' ? 'kostenlos vom Team' : `Zahlung ${formatAddonPrice(pay.amountCents, 'de')}`} (${pay.confirmedBy})`,
  });
  await notify({
    userId: row.userId,
    serverId: row.serverId,
    type: activated ? 'addon.activated' : 'addon.renewed',
    title: activated ? L(`Extra aktiv: ${row.name.de}`, `Extra active: ${row.name.en || row.name.de}`) : L(`Extra verlängert: ${row.name.de}`, `Extra renewed: ${row.name.en || row.name.de}`),
    body: (l) => {
      const name = row!.name[l] || row!.name.de;
      const till = until ? when(until, l) : null;
      const manual = row!.effect === 'manual' && row!.fulfilment === 'todo';
      return l === 'en'
        ? `${pay.provider === 'admin' ? 'We have added' : 'Thank you – we have received your payment for'} “${name}” for your server “${server!.name}”.\n${till ? `It runs until ${till}.` : 'It has no end date.'}${manual ? '\nOur team sets it up for you and lets you know as soon as it is done.' : ''}\nThere is no automatic renewal – we remind you in good time before it ends.`
        : `${pay.provider === 'admin' ? 'Wir haben' : 'Danke – deine Zahlung ist eingegangen. Wir haben'} „${name}“ für deinen Server „${server!.name}“ ${activated ? 'freigeschaltet' : 'verlängert'}.\n${till ? `Es läuft bis ${till}.` : 'Es hat kein Enddatum.'}${manual ? '\nUnser Team richtet es für dich ein und meldet sich, sobald es erledigt ist.' : ''}\nEs gibt keine automatische Verlängerung – wir erinnern dich rechtzeitig vor dem Ende.`;
    },
    dedupeKey: `addon-paid:${row.id}:${until?.getTime() ?? 'unlimited'}:${activated ? 'a' : 'r'}`,
    email: true,
  });
  return outcome;
}

/**
 * Stand einer SumUp-Zahlung bei SumUp abfragen und, wenn bezahlt, verbuchen. Aufgerufen nach der Rückmeldung des
 * Anbieters, nach der Rückkehr des Kunden und regelmäßig vom Job – maßgeblich ist immer die Abfrage bei SumUp.
 */
export async function checkAddonPayment(rowId: string): Promise<'paid' | 'open' | 'failed' | 'none'> {
  if (!sumupConfigured()) return 'none';
  const [row] = await db.select().from(serverAddons).where(eq(serverAddons.id, rowId)).limit(1);
  if (!row?.checkoutId) return 'none';
  const checkoutId = row.checkoutId;
  let checkout;
  try {
    checkout = await getSumupCheckout(checkoutId);
  } catch (err) {
    if (err instanceof SumupError && err.status === 404) {
      await db.update(serverAddons).set({ checkoutId: null, checkoutUrl: null, checkoutAt: null }).where(and(eq(serverAddons.id, row.id), eq(serverAddons.checkoutId, checkoutId)));
      return 'failed';
    }
    return 'open';
  }
  if (checkout.status === 'PAID') {
    const cents = Math.round(checkout.amount * 100);
    // Nur was zu dieser Buchung gehört und vollständig bezahlt ist: Referenz, Währung, Betrag, Händler
    const ok = checkout.id === checkoutId && checkout.checkoutReference.startsWith(`${row.ref}-`) && checkout.currency === 'EUR' && cents === row.priceCents && (!checkout.merchantCode || checkout.merchantCode === env.SUMUP_MERCHANT_CODE);
    if (!ok) {
      await audit({ userId: row.userId, serverId: row.serverId, actor: 'system', action: 'addon.payment_mismatch', message: `Zahlung zu „${row.name.de}“ (${row.ref}) passt nicht zur Bestellung (Betrag ${checkout.amount} ${checkout.currency}, Referenz ${checkout.checkoutReference}) – bitte prüfen` });
      await db.update(serverAddons).set({ checkoutId: null, checkoutUrl: null, checkoutAt: null }).where(and(eq(serverAddons.id, row.id), eq(serverAddons.checkoutId, checkoutId)));
      return 'failed';
    }
    await applyPayment(row.id, { provider: 'sumup', providerRef: `sumup:${checkout.id}`, amountCents: cents, confirmedBy: 'SumUp' });
    return 'paid';
  }
  if (checkout.status === 'FAILED' || checkout.status === 'EXPIRED') {
    // Neue Bezahlseite beim nächsten Versuch
    await db.update(serverAddons).set({ checkoutId: null, checkoutUrl: null, checkoutAt: null }).where(and(eq(serverAddons.id, row.id), eq(serverAddons.checkoutId, checkoutId)));
    return 'failed';
  }
  return 'open';
}

/** Rückmeldung von SumUp: enthält nur die ID der Bezahlseite – geprüft wird über checkAddonPayment */
export async function handleSumupWebhook(checkoutId: string): Promise<void> {
  const [row] = await db.select({ id: serverAddons.id }).from(serverAddons).where(eq(serverAddons.checkoutId, checkoutId)).limit(1);
  if (row) await checkAddonPayment(row.id);
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
  return viewFor(server, lang);
}

/* ------------------------------------------------------------ Wirkung „24/7“ */

/**
 * „24/7“ einschalten: keine Fair-Use-Pausen, kein 30-Tage-Zyklus. Eine laufende Pause endet sofort; ein Server, der
 * wegen des Zyklus abläuft oder ruht, läuft wieder. Sperren wegen Verstößen bleiben unberührt.
 */
export async function activateAlwaysOn(serverId: string, now = new Date()): Promise<void> {
  const [server] = await db.select().from(servers).where(eq(servers.id, serverId)).limit(1);
  if (!server || server.status === 'deleted') return;
  const cycleHeld = server.status === 'expiring' || (server.status === 'suspended' && server.suspensionReason === 'cycle_expired');
  await db
    .update(servers)
    .set({
      alwaysOnSince: server.alwaysOnSince ?? now,
      cycleEndsAt: NO_CYCLE_END,
      pausedUntil: null,
      pauseReason: null,
      pausedAt: null,
      ...(cycleHeld ? { status: 'active' as const, suspensionReason: null, suspendedAt: null, expiringSince: null } : {}),
    })
    .where(and(eq(servers.id, server.id), eq(servers.status, server.status)));
  if (cycleHeld && server.status === 'suspended' && server.pteroServerId) await pterodactyl().unsuspendServer(server.pteroServerId).catch(() => {});
  await trySyncPanelDescription(server.id);
}

/**
 * „24/7“ ausschalten – mit fairem Neustart: frischer 30-Tage-Zyklus ab jetzt, und die Laufzeit aus der Zeit mit dem
 * Extra zählt nicht gegen die Fair-Use-Regeln. Nur wenn keine andere 24/7-Buchung für den Server mehr läuft.
 */
export async function deactivateAlwaysOn(serverId: string, now = new Date()): Promise<void> {
  const [other] = await db
    .select({ id: serverAddons.id })
    .from(serverAddons)
    .where(and(eq(serverAddons.serverId, serverId), eq(serverAddons.effect, 'always_on'), eq(serverAddons.status, 'active')))
    .limit(1);
  if (other) return;
  const [server] = await db.select().from(servers).where(eq(servers.id, serverId)).limit(1);
  if (!server?.alwaysOnSince) return;
  await db
    .update(servers)
    .set({
      alwaysOnSince: null,
      fairUseResetAt: now,
      cycleNumber: server.cycleNumber + 1,
      cycleStartedAt: now,
      cycleEndsAt: cycleEndFor(server.kind, now, freeHostingConfig.cycle),
      pausedUntil: null,
      pauseReason: null,
      pausedAt: null,
      // Bots: Die Offline-Zeit zählt ab jetzt neu (Inaktivitäts-Regel)
      ...(server.kind === 'discord' ? { powerStateAt: now } : {}),
    })
    .where(and(eq(servers.id, server.id), isNotNull(servers.alwaysOnSince)));
  await trySyncPanelDescription(server.id);
}

/* ------------------------------------------------------------ Ende */

type EndReason = NonNullable<ServerAddon['endReason']>;

/** Buchung beenden: Wirkung zurücknehmen, ggf. Aufgabe „zurücknehmen“ für das Team, Nachricht an den Kunden */
export async function endAddon(row: ServerAddon, reason: EndReason, opts: { silent?: boolean; note?: string } = {}): Promise<boolean> {
  const now = new Date();
  const wasActive = row.status === 'active';
  const fulfilment = row.effect === 'manual' && wasActive && row.fulfilment === 'done' ? 'revoke' : 'none';
  const res = await db
    .update(serverAddons)
    .set({ status: 'ended', endedAt: now, endReason: reason, renewalRequestedAt: null, checkoutId: null, checkoutUrl: null, checkoutAt: null, fulfilment, ...(opts.note ? { adminNote: opts.note.slice(0, 500) } : {}) })
    .where(and(eq(serverAddons.id, row.id), eq(serverAddons.status, row.status)));
  if (affectedRows(res) !== 1) return false;
  if (wasActive && row.effect === 'always_on') await deactivateAlwaysOn(row.serverId, now);
  if (opts.silent || !wasActive || reason === 'server_deleted') return true;
  const [server] = await db.select({ name: servers.name }).from(servers).where(eq(servers.id, row.serverId)).limit(1);
  await notify({
    userId: row.userId,
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
            ? '\nThe normal rules of the free offer apply again from now on (fair-use breaks and the 30-day runtime, starting fresh today).'
            : '\nAb jetzt gelten wieder die normalen Regeln des kostenlosen Angebots (Fair-Use-Pausen und die 30-Tage-Laufzeit – sie beginnt heute neu).'
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

/** Regelmäßiger Lauf: verwerfen, erinnern, beenden, Zahlungen nachfragen, Wirkung abgleichen */
export async function runAddons(now = new Date()): Promise<{ expired: number; unpaid: number; reminded: number; paid: number; healed: number }> {
  const stats = { expired: 0, unpaid: 0, reminded: 0, paid: 0, healed: 0 };
  const settings = await getSettings();

  // 1) Offene Zahlungen über die Bezahlseite nachfragen (falls die Rückmeldung des Anbieters ausblieb)
  if (sumupConfigured()) {
    const open = await db
      .select({ id: serverAddons.id })
      .from(serverAddons)
      .where(and(isNotNull(serverAddons.checkoutId), gt(serverAddons.checkoutAt, new Date(now.getTime() - CHECKOUT_POLL_MS)), inArray(serverAddons.status, ['pending', 'active'])))
      .orderBy(desc(serverAddons.checkoutAt))
      .limit(25);
    for (const r of open) if ((await checkAddonPayment(r.id).catch(() => 'open')) === 'paid') stats.paid++;
  }

  // 2) Buchungen gelöschter Server beenden
  const gone = await db
    .select({ row: serverAddons })
    .from(serverAddons)
    .innerJoin(servers, eq(servers.id, serverAddons.serverId))
    .where(and(inArray(serverAddons.status, ['pending', 'active']), eq(servers.status, 'deleted')))
    .limit(200);
  for (const { row } of gone) await endAddon(row, 'server_deleted', { silent: true });

  // 3) Unbezahlte Bestellungen verwerfen
  const stale = await db
    .select()
    .from(serverAddons)
    .where(and(eq(serverAddons.status, 'pending'), lte(serverAddons.createdAt, new Date(now.getTime() - settings.addons.pendingDays * DAY_MS))))
    .limit(200);
  for (const row of stale) {
    // Vorher noch einmal beim Anbieter nachsehen – eine bezahlte Bestellung wird nie verworfen
    if (row.checkoutId && (await checkAddonPayment(row.id).catch(() => 'open')) === 'paid') continue;
    if (await endAddon(row, 'unpaid', { silent: true })) stats.unpaid++;
  }

  // 4) Abgelaufene Buchungen beenden (mit Nachfrist, wenn eine Verlängerung angekündigt ist)
  const due = await db
    .select()
    .from(serverAddons)
    .where(and(eq(serverAddons.status, 'active'), isNotNull(serverAddons.paidUntil), lte(serverAddons.paidUntil, now)))
    .limit(300);
  for (const row of due) {
    if (row.checkoutId && (await checkAddonPayment(row.id).catch(() => 'open')) === 'paid') continue;
    const grace = row.renewalRequestedAt && row.renewalRequestedAt.getTime() > row.paidUntil!.getTime() - 14 * DAY_MS ? RENEWAL_GRACE_MS : 0;
    if (row.paidUntil!.getTime() + grace > now.getTime()) continue;
    if (await endAddon(row, 'expired')) {
      stats.expired++;
      await audit({ userId: row.userId, serverId: row.serverId, actor: 'system', action: 'addon.expired', message: `Extra „${row.name.de}“ (${row.ref}) abgelaufen und beendet` });
    }
  }

  // 5) Erinnern, bevor die Laufzeit endet
  if (settings.addons.remindDaysBefore > 0) {
    const soon = await db
      .select({ row: serverAddons, serverName: servers.name })
      .from(serverAddons)
      .innerJoin(servers, eq(servers.id, serverAddons.serverId))
      .where(and(eq(serverAddons.status, 'active'), isNotNull(serverAddons.paidUntil), gt(serverAddons.paidUntil, now), lte(serverAddons.paidUntil, new Date(now.getTime() + settings.addons.remindDaysBefore * DAY_MS)), isNull(serverAddons.renewalRequestedAt)))
      .limit(300);
    for (const { row, serverName } of soon) {
      const renewable = canRenew(row, settings, now);
      const created = await notify({
        userId: row.userId,
        serverId: row.serverId,
        type: 'addon.expiring',
        title: L(`Dein Extra endet bald: ${row.name.de}`, `Your extra ends soon: ${row.name.en || row.name.de}`),
        body: (l) => {
          const name = row.name[l] || row.name.de;
          return l === 'en'
            ? `“${name}” for your server “${serverName}” runs until ${when(row.paidUntil!, l)}.\n${renewable ? `To keep it, renew it under “My servers” → Manage → Extras (${formatAddonPrice(row.priceCents, l)} for ${formatAddonPeriod(row.periodDays, l)}).` : 'It cannot be renewed at the moment.'}\nNothing is charged automatically. If you do not renew, the extra simply ends and the free offer continues as usual.`
            : `„${name}“ für deinen Server „${serverName}“ läuft bis ${when(row.paidUntil!, l)}.\n${renewable ? `Wenn du es behalten möchtest, verlängere es unter „Meine Server“ → Verwalten → Extras (${formatAddonPrice(row.priceCents, l)} für ${formatAddonPeriod(row.periodDays, l)}).` : 'Es lässt sich derzeit nicht verlängern.'}\nEs wird nichts automatisch abgebucht. Wenn du nicht verlängerst, endet das Extra einfach, und das kostenlose Angebot läuft normal weiter.`;
        },
        dedupeKey: `addon-expiring:${row.id}:${row.paidUntil!.getTime()}`,
        email: true,
      });
      if (created) stats.reminded++;
    }
  }

  // 6) Abgleich der Wirkung „24/7“: nie ohne laufende Buchung, und jede laufende Buchung wirkt
  const flagged = await db
    .select({ id: servers.id })
    .from(servers)
    .where(and(isNotNull(servers.alwaysOnSince), ne(servers.status, 'deleted'), sql`not exists (select 1 from ${serverAddons} where ${serverAddons.serverId} = ${servers.id} and ${serverAddons.effect} = 'always_on' and ${serverAddons.status} = 'active')`))
    .limit(100);
  for (const s of flagged) {
    await deactivateAlwaysOn(s.id, now);
    stats.healed++;
  }
  const missing = await db
    .select({ id: servers.id })
    .from(servers)
    .innerJoin(serverAddons, eq(serverAddons.serverId, servers.id))
    .where(and(eq(serverAddons.effect, 'always_on'), eq(serverAddons.status, 'active'), ne(servers.status, 'deleted'), or(isNull(servers.alwaysOnSince), ne(servers.cycleEndsAt, NO_CYCLE_END))))
    .limit(100);
  for (const s of missing) {
    await activateAlwaysOn(s.id, now);
    stats.healed++;
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

/** Zahlen für die Admin-Übersicht */
export async function addonCounts(): Promise<{ active: number; awaitingPayment: number; tasks: number }> {
  const [a] = await db
    .select({
      active: sql<number>`sum(case when ${serverAddons.status} = 'active' then 1 else 0 end)`,
      awaiting: sql<number>`sum(case when ${serverAddons.status} = 'pending' or (${serverAddons.status} = 'active' and ${serverAddons.renewalRequestedAt} is not null) then 1 else 0 end)`,
      tasks: sql<number>`sum(case when ${serverAddons.fulfilment} in ('todo','revoke') then 1 else 0 end)`,
    })
    .from(serverAddons);
  return { active: Number(a?.active ?? 0), awaitingPayment: Number(a?.awaiting ?? 0), tasks: Number(a?.tasks ?? 0) };
}

export async function listAdminAddons(filter: { q?: string; status?: string; page?: number }): Promise<AdminAddonsDTO> {
  const settings = await getSettings();
  const now = new Date();
  const q = filter.q?.trim();
  const conds = [];
  if (filter.status === 'pending') conds.push(or(eq(serverAddons.status, 'pending'), and(eq(serverAddons.status, 'active'), isNotNull(serverAddons.renewalRequestedAt))));
  else if (filter.status === 'active') conds.push(eq(serverAddons.status, 'active'));
  else if (filter.status === 'ended') conds.push(eq(serverAddons.status, 'ended'));
  else if (filter.status === 'tasks') conds.push(inArray(serverAddons.fulfilment, ['todo', 'revoke']));
  if (q) {
    const p = `%${escapeLike(q)}%`;
    conds.push(or(like(serverAddons.ref, p), like(users.email, p), like(servers.name, p), like(serverAddons.addonId, p)));
  }
  const where = conds.length ? and(...conds) : undefined;
  const base = () => db.select({ n: count() }).from(serverAddons).innerJoin(users, eq(users.id, serverAddons.userId)).innerJoin(servers, eq(servers.id, serverAddons.serverId));
  const [totalRow] = await base().where(where);
  const { offset, ...info } = paging(filter.page, Number(totalRow?.n ?? 0));
  const list = await db
    .select({ row: serverAddons, email: users.email, serverName: servers.name, serverStatus: servers.status })
    .from(serverAddons)
    .innerJoin(users, eq(users.id, serverAddons.userId))
    .innerJoin(servers, eq(servers.id, serverAddons.serverId))
    .where(where)
    // Zuerst, was etwas von uns braucht: Aufgaben und offene Zahlungen
    .orderBy(sql`case when ${serverAddons.fulfilment} in ('todo','revoke') then 0 when ${serverAddons.status} = 'pending' or ${serverAddons.renewalRequestedAt} is not null then 1 when ${serverAddons.status} = 'active' then 2 else 3 end`, desc(serverAddons.createdAt))
    .limit(ADMIN_PAGE_SIZE)
    .offset(offset);
  const ids = list.map((l) => l.row.id);
  const paid = ids.length
    ? await db
        .select({ id: addonPayments.serverAddonId, cents: sql<number>`sum(${addonPayments.amountCents})`, n: count() })
        .from(addonPayments)
        .where(inArray(addonPayments.serverAddonId, ids))
        .groupBy(addonPayments.serverAddonId)
    : [];
  const paidBy = new Map(paid.map((p) => [p.id, p]));
  const rows: AdminAddonRowDTO[] = list.map(({ row, email, serverName, serverStatus }) => {
    const { payment: _payment, canRenew: _canRenew, ...dto } = toDTO(row, settings, 'de', now);
    return { ...dto, userId: row.userId, userEmail: email, serverId: row.serverId, serverName, serverStatus, adminNote: row.adminNote, paidCents: Number(paidBy.get(row.id)?.cents ?? 0), payments: Number(paidBy.get(row.id)?.n ?? 0), checkoutPending: row.checkoutId !== null };
  });
  const [a] = await db
    .select({
      active: sql<number>`sum(case when ${serverAddons.status} = 'active' then 1 else 0 end)`,
      awaiting: sql<number>`sum(case when ${serverAddons.status} = 'pending' or (${serverAddons.status} = 'active' and ${serverAddons.renewalRequestedAt} is not null) then 1 else 0 end)`,
      tasks: sql<number>`sum(case when ${serverAddons.fulfilment} in ('todo','revoke') then 1 else 0 end)`,
      runRate: sql<number>`sum(case when ${serverAddons.status} = 'active' and ${serverAddons.periodDays} > 0 then ${serverAddons.priceCents} * 30.0 / ${serverAddons.periodDays} else 0 end)`,
    })
    .from(serverAddons);
  const [rev] = await db
    .select({ cents: sql<number>`coalesce(sum(${addonPayments.amountCents}), 0)` })
    .from(addonPayments)
    .where(gt(addonPayments.createdAt, new Date(now.getTime() - 30 * DAY_MS)));
  return {
    rows,
    ...info,
    stats: { active: Number(a?.active ?? 0), awaitingPayment: Number(a?.awaiting ?? 0), tasks: Number(a?.tasks ?? 0), revenue30dCents: Number(rev?.cents ?? 0), monthlyRunRateCents: Math.round(Number(a?.runRate ?? 0)) },
    payment: { sumup: sumupConfigured(), webhookUrl: `${env.APP_URL.replace(/\/$/, '')}/api/v1/payments/sumup/webhook` },
  };
}

async function adminRow(rowId: string): Promise<ServerAddon> {
  const [row] = await db.select().from(serverAddons).where(eq(serverAddons.id, rowId)).limit(1);
  if (!row) throw Errors.notFound(L('Buchung nicht gefunden.', 'Booking not found.'));
  return row;
}

/** Zahlungseingang von Hand bestätigen: schaltet eine Bestellung frei bzw. verlängert eine laufende Buchung um eine Laufzeit */
export async function adminConfirmAddonPayment(admin: Pick<User, 'email'>, rowId: string, amountCents?: number): Promise<void> {
  const row = await adminRow(rowId);
  if (row.status === 'ended' && row.endReason !== 'unpaid' && row.endReason !== 'canceled') {
    throw Errors.conflict('not_confirmable', L('Diese Buchung ist beendet – bitte lass den Kunden neu bestellen.', 'This booking has ended – please let the customer order again.'));
  }
  // Läuft dazu gerade eine Zahlung über die Bezahlseite, zuerst deren Stand holen (sonst doppelte Verlängerung)
  if (row.checkoutId && (await checkAddonPayment(row.id).catch(() => 'open')) === 'paid') return;
  const outcome = await applyPayment(row.id, { provider: 'manual', providerRef: null, amountCents: amountCents ?? row.priceCents, confirmedBy: admin.email });
  if (outcome === 'orphan') throw Errors.conflict('server_gone', L('Den Server gibt es nicht mehr – die Zahlung wurde nur verbucht.', 'The server no longer exists – the payment was only recorded.'));
}

export async function adminEndAddon(admin: Pick<User, 'email'>, rowId: string, input: { refunded: boolean; note: string }, ip?: string): Promise<void> {
  const row = await adminRow(rowId);
  if (row.status === 'ended') throw Errors.conflict('already_ended', L('Diese Buchung ist schon beendet.', 'This booking has already ended.'));
  await endAddon(row, input.refunded ? 'refunded' : 'admin', { note: input.note });
  await audit({ userId: row.userId, serverId: row.serverId, actor: 'admin', action: 'admin.addon_ended', message: `Extra „${row.name.de}“ (${row.ref}) beendet${input.refunded ? ' (erstattet)' : ''}${input.note ? `: ${input.note.slice(0, 200)}` : ''} (durch ${admin.email})`, ip });
}

/** Laufzeit verschenken bzw. kürzen (Tage, auch negativ) – ohne Zahlung */
export async function adminExtendAddon(admin: Pick<User, 'email'>, rowId: string, days: number, ip?: string): Promise<void> {
  const row = await adminRow(rowId);
  if (row.status !== 'active' || !row.paidUntil) throw Errors.conflict('not_extendable', L('Nur laufende Buchungen mit Enddatum lassen sich verlängern.', 'Only running bookings with an end date can be extended.'));
  const paidUntil = new Date(Math.max(Date.now() + 60_000, row.paidUntil.getTime() + days * DAY_MS));
  await db.update(serverAddons).set({ paidUntil }).where(and(eq(serverAddons.id, row.id), eq(serverAddons.status, 'active')));
  await audit({ userId: row.userId, serverId: row.serverId, actor: 'admin', action: 'admin.addon_extended', message: `Extra „${row.name.de}“ (${row.ref}) um ${days} Tage ${days >= 0 ? 'verlängert' : 'gekürzt'} – läuft bis ${when(paidUntil, 'de')} (durch ${admin.email})`, ip });
}

/** Aufgabe des Teams abhaken: eingerichtet (todo → done, Kunde wird benachrichtigt) bzw. zurückgenommen (revoke → none) */
export async function adminFulfilAddon(admin: Pick<User, 'email'>, rowId: string, ip?: string): Promise<void> {
  const row = await adminRow(rowId);
  if (row.fulfilment === 'todo') {
    await db.update(serverAddons).set({ fulfilment: 'done' }).where(and(eq(serverAddons.id, row.id), eq(serverAddons.fulfilment, 'todo')));
    const [server] = await db.select({ name: servers.name }).from(servers).where(eq(servers.id, row.serverId)).limit(1);
    await notify({
      userId: row.userId,
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
  const found = await db.select().from(servers).where(wanted.length === 36 ? eq(servers.id, wanted) : like(servers.id, `${wanted}%`)).limit(2);
  const server = found.length === 1 ? found[0] : undefined;
  if (!server || server.status === 'deleted' || server.partnerId) throw Errors.notFound(L('Server nicht gefunden.', 'Server not found.'));
  const [same] = await db
    .select({ id: serverAddons.id })
    .from(serverAddons)
    .where(and(eq(serverAddons.serverId, server.id), eq(serverAddons.addonId, addon.id), inArray(serverAddons.status, ['pending', 'active'])))
    .limit(1);
  if (same) throw Errors.conflict('already_booked', L('Dieses Extra läuft für diesen Server schon bzw. ist bestellt.', 'This extra is already running or ordered for this server.'));
  const id = uuid();
  const periodDays = input.days === null ? 0 : Math.max(1, Math.min(3660, Math.round(input.days)));
  await db.insert(serverAddons).values({ id, ref: newRef(), userId: server.userId, serverId: server.id, addonId: addon.id, name: addon.name, icon: addon.icon, effect: addon.effect, priceCents: 0, periodDays, status: 'pending' });
  await applyPayment(id, { provider: 'admin', providerRef: null, amountCents: 0, confirmedBy: admin.email, periodDays });
  await audit({ userId: server.userId, serverId: server.id, actor: 'admin', action: 'admin.addon_granted', message: `Extra „${addon.name.de}“ kostenlos für „${server.name}“ vergeben (${periodDays ? `${periodDays} Tage` : 'unbefristet'}) (durch ${admin.email})`, ip });
}

export async function adminAddonNote(rowId: string, note: string): Promise<void> {
  const row = await adminRow(rowId);
  await db.update(serverAddons).set({ adminNote: note.trim().slice(0, 500) || null }).where(eq(serverAddons.id, row.id));
}
