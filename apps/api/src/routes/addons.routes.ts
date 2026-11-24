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
  checkServerPayments,
  handleSumupWebhook,
  listAdminAddons,
  listServerAddons,
  orderAddon,
  payAddon,
  renewAddon,
  checkAddonPayment,
} from '../services/addons.service';
import { db } from '../db/client';
import { serverAddons } from '../db/schema';
import { and, eq, inArray, isNotNull } from 'drizzle-orm';

const idParams = z.object({ id: z.string().uuid() });
const rowParams = z.object({ id: z.string().uuid(), rowId: z.string().uuid() });
const consent = { acceptTerms: z.boolean().optional().default(false), acceptEarlyStart: z.boolean().optional().default(false), adult: z.boolean().optional() };
const orderBody = z.object({ addonId: z.string().min(2).max(32), ...consent });
const renewBody = z.object(consent);
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
    const { addonId, ...c } = orderBody.parse(request.body);
    return orderAddon(currentUser(request), id, addonId, c, request.lang, request.ip);
  });

  app.post('/servers/:id/addons/:rowId/pay', strict(20, '10 minutes'), async (request) => {
    const { id, rowId } = rowParams.parse(request.params);
    return payAddon(currentUser(request), id, rowId, request.lang);
  });

  app.post('/servers/:id/addons/:rowId/renew', strict(10, '10 minutes'), async (request) => {
    await assertNotMaintenance(request);
    const { id, rowId } = rowParams.parse(request.params);
    return renewAddon(currentUser(request), id, rowId, renewBody.parse(request.body), request.lang, request.ip);
  });

  app.post('/servers/:id/addons/:rowId/cancel', strict(20, '10 minutes'), async (request) => {
    const { id, rowId } = rowParams.parse(request.params);
    return { addons: await cancelAddonOrder(currentUser(request), id, rowId, request.lang, request.ip) };
  });

  /** Nach der Rückkehr von der Bezahlseite: Stand der Zahlung gleich prüfen */
  app.post('/servers/:id/addons/check', strict(20, '10 minutes'), async (request) => {
    const { id } = idParams.parse(request.params);
    return { addons: await checkServerPayments(currentUser(request), id, request.lang) };
  });
}

/**
 * Öffentliche Adressen für den Zahlungsanbieter (ohne Anmeldung):
 *  – Rückmeldung von SumUp. Sie enthält nur die ID der Bezahlseite und beweist nichts; ob bezahlt wurde, fragt das
 *    System selbst bei SumUp ab. Unbekannte IDs werden still übergangen.
 *  – Rückweg des Kunden nach dem Bezahlen: prüft offene Zahlungen des Servers und leitet auf die Server-Seite.
 */
export async function paymentRoutes(app: FastifyInstance) {
  app.post('/payments/sumup/webhook', strict(120, '1 minute'), async (request, reply) => {
    const body = z.object({ event_type: z.string().max(64).optional(), id: z.string().min(1).max(128) }).safeParse(request.body);
    if (body.success && (!body.data.event_type || body.data.event_type === 'CHECKOUT_STATUS_CHANGED')) {
      await handleSumupWebhook(body.data.id).catch((err) => request.log.warn({ err }, 'SumUp-Rückmeldung konnte nicht verarbeitet werden – der Job fragt nach'));
    }
    return reply.status(204).send();
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
    const input = z.object({ refunded: z.boolean().default(false), note: z.string().max(500).default('') }).parse(request.body ?? {});
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
