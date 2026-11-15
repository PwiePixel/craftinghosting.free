import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { emailSchema, newsletterSubscribeSchema, newsletterTokenSchema } from '@chfree/shared';
import { env } from '../env';
import { explainSmtpError } from '../services/mail/mailer';
import { currentUser, requireAdmin } from '../plugins/auth';
import {
  cancelCampaign,
  confirmSubscription,
  deleteCampaign,
  deleteSubscriber,
  listSubscribers,
  newsletterOverview,
  saveCampaign,
  sendCampaignTest,
  startCampaign,
  subscribe,
  unsubscribeByToken,
} from '../services/newsletter.service';

const idParams = z.object({ id: z.string().uuid() });
const text = (max: number) => z.object({ de: z.string().max(max).default(''), en: z.string().max(max).default('') });
const campaignSchema = z
  .object({
    subject: text(160),
    body: text(20_000),
    audience: z.enum(['subscribers', 'all_users']).default('subscribers'),
    ctaLabel: text(60).default({ de: '', en: '' }),
    ctaUrl: z
      .string()
      .trim()
      .max(500)
      .refine((v) => v === '' || /^https?:\/\/\S+$/.test(v), 'Der Link muss mit http:// oder https:// beginnen.')
      .default(''),
  })
  .refine((c) => !!(c.subject.de.trim() || c.subject.en.trim()), { message: 'Bitte einen Betreff angeben.' })
  .refine((c) => !!(c.body.de.trim() || c.body.en.trim()), { message: 'Bitte einen Text angeben.' });

/** Öffentlich: anmelden (Double-Opt-in), bestätigen, abmelden */
export async function newsletterRoutes(app: FastifyInstance) {
  app.post('/newsletter/subscribe', { config: { rateLimit: { max: 5, timeWindow: '15 minutes' } } }, async (request) => {
    const { email } = newsletterSubscribeSchema.parse(request.body);
    await subscribe(email, request.lang, { ip: request.ip, source: 'website' });
    return { ok: true };
  });
  app.post('/newsletter/confirm', { config: { rateLimit: { max: 20, timeWindow: '15 minutes' } } }, async (request) => {
    const { token } = newsletterTokenSchema.parse(request.body);
    return { ok: true, ...(await confirmSubscription(token)) };
  });
  app.post('/newsletter/unsubscribe', { config: { rateLimit: { max: 20, timeWindow: '15 minutes' } } }, async (request) => {
    const { token } = newsletterTokenSchema.parse(request.body);
    return { ok: true, ...(await unsubscribeByToken(token)) };
  });
}

/** Admin: Abonnenten und Ausgaben */
export async function newsletterAdminRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireAdmin);

  app.get('/admin/newsletter', async () => ({ newsletter: await newsletterOverview() }));
  app.get('/admin/newsletter/subscribers', async (request) => {
    const q = z
      .object({ q: z.string().max(100).optional(), status: z.string().max(16).optional(), page: z.coerce.number().int().min(1).max(1_000_000).optional() })
      .parse(request.query);
    return listSubscribers(q);
  });
  app.post('/admin/newsletter/subscribers/:id/delete', async (request) => {
    const { id } = idParams.parse(request.params);
    await deleteSubscriber(currentUser(request), id, request.ip);
    return { ok: true };
  });

  app.post('/admin/newsletter/campaigns', async (request) => ({ campaign: await saveCampaign(currentUser(request), null, campaignSchema.parse(request.body), request.ip) }));
  app.post('/admin/newsletter/campaigns/:id', async (request) => {
    const { id } = idParams.parse(request.params);
    return { campaign: await saveCampaign(currentUser(request), id, campaignSchema.parse(request.body), request.ip) };
  });
  app.post('/admin/newsletter/campaigns/:id/delete', async (request) => {
    const { id } = idParams.parse(request.params);
    await deleteCampaign(currentUser(request), id, request.ip);
    return { ok: true };
  });
  app.post('/admin/newsletter/campaigns/:id/test', { config: { rateLimit: { max: 10, timeWindow: '5 minutes' } } }, async (request) => {
    const { id } = idParams.parse(request.params);
    const { to } = z.object({ to: emailSchema.optional() }).parse(request.body ?? {});
    try {
      await sendCampaignTest(id, to ?? currentUser(request).email);
      return { ok: true, logged: !env.SMTP_HOST };
    } catch (err) {
      return { ok: false, error: explainSmtpError(err) };
    }
  });
  app.post('/admin/newsletter/campaigns/:id/send', async (request) => {
    const { id } = idParams.parse(request.params);
    return { campaign: await startCampaign(currentUser(request), id, request.ip) };
  });
  app.post('/admin/newsletter/campaigns/:id/cancel', async (request) => {
    const { id } = idParams.parse(request.params);
    return { campaign: await cancelCampaign(currentUser(request), id, request.ip) };
  });
}
