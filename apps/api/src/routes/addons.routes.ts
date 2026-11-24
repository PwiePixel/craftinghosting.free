import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { isLocale, serverPagePath, type Locale } from '@chfree/shared';
import { env } from '../env';
import { assertNotMaintenance } from '../lib/maintenance';
import { currentUser, requireAdmin, requireAuth } from '../plugins/auth';
import {
  adminAddonNote,
  adminConfirmAddonPayment,
  adminEndAddon,
  adminExtendAddon,
  adminFulfilAddon,
  adminGrantAddon,
  cancelAddonOrder,
  cancelSubscription,
  checkServerPayments,
  handlePaymentWebhook,
  requestCancellation,
  listAdminAddons,
  listServerAddons,
  orderAddon,
  payAddon,
  renewAddon,
  checkAddonPayment,
} from '../services/addons.service';
import { db } from '../db/client';
import { audit } from '../services/audit.service';
import { getSettings, invalidatePublicSite, saveSettings } from '../services/settings.service';
import { serverAddons } from '../db/schema';
import { and, eq, inArray, isNotNull } from 'drizzle-orm';

const idParams = z.object({ id: z.string().uuid() });
const rowParams = z.object({ id: z.string().uuid(), rowId: z.string().uuid() });
const consent = { acceptTerms: z.boolean().optional().default(false), acceptEarlyStart: z.boolean().optional().default(false), adult: z.boolean().optional(), acceptRecurring: z.boolean().optional() };
// Preis und Laufzeit schickt der Browser nur mit, damit der Server merkt, wenn der Kunde etwas anderes gesehen hat –
// berechnet wird immer mit dem Katalog auf dem Server
const seen = { subscribe: z.boolean().optional(), priceCents: z.number().int().min(0).max(1_000_000).optional(), periodDays: z.number().int().min(0).max(3660).optional() };
const orderBody = z.object({ addonId: z.string().min(2).max(32), ...consent, ...seen });
const renewBody = z.object({ ...consent, ...seen });
const orderInput = (b: z.infer<typeof renewBody>) => ({ consent: { acceptTerms: b.acceptTerms, acceptEarlyStart: b.acceptEarlyStart, adult: b.adult, acceptRecurring: b.acceptRecurring }, subscribe: b.subscribe, priceCents: b.priceCents, periodDays: b.periodDays });
const strict = (max: number, timeWindow: string) => ({ config: { rateLimit: { max, timeWindow } } });

/** Extras eines Servers: ansehen, bestellen, bezahlen, verlängern, stornieren (angemeldete Kunden) */
export async function addonRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireAuth);

  app.get('/servers/:id/addons', strict(60, '1 minute'), async (request) => {
    const { id } = idParams.parse(request.params);
    return { addons: await listServerAddons(currentUser(request), id, request.lang) };
  });

  app.post('/servers/:id/addons', strict(10, '10 minutes'), async (request) => {
    await assertNotMaintenance(request);
    const { id } = idParams.parse(request.params);
    const { addonId, ...b } = orderBody.parse(request.body);
    return orderAddon(currentUser(request), id, addonId, orderInput(b), request.lang, request.ip);
  });

  app.post('/servers/:id/addons/:rowId/pay', strict(20, '10 minutes'), async (request) => {
    const { id, rowId } = rowParams.parse(request.params);
    return payAddon(currentUser(request), id, rowId, request.lang);
  });

  app.post('/servers/:id/addons/:rowId/renew', strict(10, '10 minutes'), async (request) => {
    await assertNotMaintenance(request);
    const { id, rowId } = rowParams.parse(request.params);
    return renewAddon(currentUser(request), id, rowId, orderInput(renewBody.parse(request.body)), request.lang, request.ip);
  });

  app.post('/servers/:id/addons/:rowId/cancel', strict(20, '10 minutes'), async (request) => {
    const { id, rowId } = rowParams.parse(request.params);
    return { addons: await cancelAddonOrder(currentUser(request), id, rowId, request.lang, request.ip) };
  });

  /** Abo kündigen: keine weitere Abbuchung, die bezahlte Laufzeit läuft zu Ende (geht auch während Wartungsarbeiten) */
  app.post('/servers/:id/addons/:rowId/unsubscribe', strict(20, '10 minutes'), async (request) => {
    const { id, rowId } = rowParams.parse(request.params);
    return { addons: await cancelSubscription(currentUser(request), id, rowId, request.lang, request.ip) };
  });

  /** Nach der Rückkehr von der Bezahlseite: Stand der Zahlung gleich prüfen */
  app.post('/servers/:id/addons/check', strict(20, '10 minutes'), async (request) => {
    const { id } = idParams.parse(request.params);
    return { addons: await checkServerPayments(currentUser(request), id, request.lang) };
  });
}

/**
 * Öffentliche Adressen (ohne Anmeldung):
 *  – Rückmeldung von Mollie. Sie enthält nur die ID einer Zahlung und beweist nichts; ob bezahlt wurde, fragt das
 *    System selbst bei Mollie ab. Unbekannte IDs werden still übergangen.
 *  – Rückweg des Kunden nach dem Bezahlen: prüft offene Zahlungen des Servers und leitet auf die Server-Seite.
 *  – Kündigung eines Abos über die Kündigungsseite der Website.
 */
export async function paymentRoutes(app: FastifyInstance) {
  // Mollie sendet die Rückmeldung als Formular (id=tr_…), nicht als JSON
  app.addContentTypeParser('application/x-www-form-urlencoded', { parseAs: 'string', bodyLimit: 2048 }, (_request, body, done) => {
    done(null, Object.fromEntries(new URLSearchParams(String(body))));
  });

  app.post('/payments/mollie/webhook', strict(240, '1 minute'), async (request, reply) => {
    const body = z.object({ id: z.string().min(1).max(64) }).safeParse(request.body);
    if (!body.success) return reply.status(200).send();
    let done = false;
    try {
      done = await handlePaymentWebhook(body.data.id);
    } catch (err) {
      request.log.warn({ err }, 'Mollie-Rückmeldung konnte nicht verarbeitet werden – Mollie wiederholt sie, der Job fragt nach');
    }
    // 200 = erledigt (auch bei unbekannter ID). Alles andere lässt Mollie die Rückmeldung später wiederholen.
    return reply.status(done ? 200 : 503).send();
  });

  /** Kündigung ohne Anmeldung. Die Antwort ist immer dieselbe – sie verrät nicht, ob es zu einer Adresse ein Konto gibt. */
  app.post('/payments/cancel-subscription', strict(5, '1 hour'), async (request) => {
    const body = z.object({ email: z.string().trim().email().max(200), ref: z.string().trim().max(20).optional() }).parse(request.body);
    await requestCancellation(body, request.ip);
    return { ok: true };
  });

  app.get('/payments/return', strict(30, '1 minute'), async (request, reply) => {
    const q = z.object({ s: z.string().uuid(), lang: z.string().optional() }).safeParse(request.query);
    const lang: Locale = q.success && isLocale(q.data.lang) ? q.data.lang : 'de';
    const base = env.APP_URL.replace(/\/$/, '');
    if (!q.success) return reply.redirect(`${base}/`);
    const open = await db
      .select({ id: serverAddons.id })
      .from(serverAddons)
      .where(and(eq(serverAddons.serverId, q.data.s), isNotNull(serverAddons.checkoutId), inArray(serverAddons.status, ['pending', 'active'])))
      .limit(5);
    for (const r of open) await checkAddonPayment(r.id).catch(() => {});
    return reply.redirect(`${base}${serverPagePath(lang, q.data.s)}?paid=1#extras`);
  });
}

/** Admin → Extras: Buchungen, Zahlungen bestätigen, Aufgaben, kostenlos vergeben */
export async function addonAdminRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireAdmin);
  const listQuery = z.object({ q: z.string().max(100).optional(), status: z.string().max(32).optional(), page: z.coerce.number().int().min(1).max(1_000_000).optional() });
  const row = z.object({ rowId: z.string().uuid() });

  app.get('/admin/addons', async (request) => listAdminAddons(listQuery.parse(request.query)));

  /** Katalog und Einstellungen der Extras speichern – getrennt von den übrigen Einstellungen, damit kein anderes Formular sie überschreibt */
  app.post('/admin/addons/settings', async (request) => {
    const { addons } = z.object({ addons: z.unknown() }).parse(request.body);
    const before = await getSettings();
    const settings = await saveSettings({ ...before, addons }, { addons: true });
    invalidatePublicSite();
    await audit({ userId: currentUser(request).id, actor: 'admin', action: 'admin.addons_saved', message: `Extras gespeichert: ${settings.addons.enabled ? 'eingeschaltet' : 'ausgeschaltet'}, ${settings.addons.items.filter((a) => a.enabled && a.priceCents > 0).length} buchbar (durch ${currentUser(request).email})`, ip: request.ip });
    return { addons: settings.addons };
  });

  app.post('/admin/addons/grant', async (request) => {
    const input = z.object({ serverId: z.string().min(8).max(36), addonId: z.string().min(2).max(32), days: z.number().int().min(1).max(3660).nullable() }).parse(request.body);
    await adminGrantAddon(currentUser(request), input, request.ip);
    return { ok: true };
  });

  app.post('/admin/addons/:rowId/confirm', async (request) => {
    const { rowId } = row.parse(request.params);
    const { amountCents } = z.object({ amountCents: z.number().int().min(0).max(1_000_000).optional() }).parse(request.body ?? {});
    await adminConfirmAddonPayment(currentUser(request), rowId, amountCents);
    return { ok: true };
  });

  app.post('/admin/addons/:rowId/end', async (request) => {
    const { rowId } = row.parse(request.params);
    const input = z.object({ refunded: z.boolean().default(false), note: z.string().max(500).default(''), refundCents: z.number().int().min(0).max(1_000_000).optional() }).parse(request.body ?? {});
    await adminEndAddon(currentUser(request), rowId, input, request.ip);
    return { ok: true };
  });

  app.post('/admin/addons/:rowId/extend', async (request) => {
    const { rowId } = row.parse(request.params);
    const { days } = z.object({ days: z.number().int().min(-366).max(366).refine((d) => d !== 0) }).parse(request.body);
    await adminExtendAddon(currentUser(request), rowId, days, request.ip);
    return { ok: true };
  });

  app.post('/admin/addons/:rowId/fulfil', async (request) => {
    const { rowId } = row.parse(request.params);
    await adminFulfilAddon(currentUser(request), rowId, request.ip);
    return { ok: true };
  });

  app.post('/admin/addons/:rowId/note', async (request) => {
    const { rowId } = row.parse(request.params);
    const { note } = z.object({ note: z.string().max(500) }).parse(request.body);
    await adminAddonNote(rowId, note);
    return { ok: true };
  });
}
