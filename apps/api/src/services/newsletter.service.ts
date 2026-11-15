/**
 * Newsletter: Anmeldung mit Double-Opt-in, Abmeldung per Link, Ausgaben aus dem Admin-Bereich.
 *
 *  – Anmelden:   Eintrag „pending“ + Bestätigungs-Mail. Erst der Klick auf den Link macht ihn „active“.
 *  – Abmelden:   signierter Link in jeder Ausgabe (ohne Anmeldung, ein Klick).
 *  – Versenden:  Beim Start einer Ausgabe entsteht je Empfänger eine Zeile in `newsletter_deliveries`;
 *                der Worker-Job arbeitet sie in kleinen Portionen ab (Höchstzahl pro Minute im Admin einstellbar).
 *                Dadurch bekommt jeder Empfänger jede Ausgabe genau einmal – auch nach einem Neustart.
 *
 * Link-Tokens sind signiert (HMAC) und brauchen keinen eigenen Datenbankeintrag.
 */
import { and, asc, count, desc, eq, inArray, isNotNull, lt, sql, type SQL } from 'drizzle-orm';
import {
  ADMIN_PAGE_SIZE,
  isEmailBlocked,
  localePath,
  type AdminCampaignDTO,
  type AdminNewsletterDTO,
  type AdminSubscriberDTO,
  type CampaignInput,
  type Locale,
  type NewsletterStatus,
  type PageInfo,
} from '@chfree/shared';
import { affectedRows, db } from '../db/client';
import { newsletterCampaigns, newsletterDeliveries, newsletterSubscribers, users, type User } from '../db/schema';
import { env } from '../env';
import { encryptField, signToken, uuid, verifySignedToken } from '../lib/crypto';
import { Errors, L } from '../lib/errors';
import { audit } from './audit.service';
import { sendMail } from './mail/mailer';
import { campaignMail, newsletterConfirmMail } from './mail/templates';
import { getSettings } from './settings.service';

const CONFIRM = 'newsletter-confirm';
const UNSUBSCRIBE = 'newsletter-unsubscribe';
const MAX_ATTEMPTS = 3;

const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);
const pageUrl = (locale: Locale, query: Record<string, string>) => `${env.APP_URL}${localePath(locale, 'newsletter', query)}`;
export const confirmUrl = (id: string, locale: Locale) => pageUrl(locale, { confirm: signToken(id, CONFIRM) });
export const unsubscribeUrl = (id: string, locale: Locale) => pageUrl(locale, { unsubscribe: signToken(id, UNSUBSCRIBE) });

const disabled = () => Errors.conflict('newsletter_disabled', L('Der Newsletter ist derzeit nicht verfügbar.', 'The newsletter is currently not available.'));
const blocked = () => {
  const msg = L('Diese E-Mail-Adresse kann nicht verwendet werden. Bitte nimm eine andere.', 'This email address cannot be used. Please use a different one.');
  return Errors.badRequest('email_blocked', msg, { email: msg });
};
const invalidLink = () => Errors.badRequest('invalid_link', L('Dieser Link ist ungültig oder abgelaufen.', 'This link is invalid or has expired.'));

/* ------------------------------------------------------------ Anmelden / Abmelden */

/**
 * Meldet eine Adresse an. Die Antwort verrät nicht, ob die Adresse schon eingetragen ist.
 * `sendMail: false` (Häkchen beim Erstellen eines Servers): Die Bestätigung passiert dann über die E-Mail-Bestätigung des Kontos.
 */
export async function subscribe(email: string, locale: Locale, opts: { ip?: string; source?: 'website' | 'signup'; sendMail?: boolean } = {}): Promise<void> {
  const settings = await getSettings();
  if (!settings.newsletter.enabled) throw disabled();
  if (isEmailBlocked(email, settings.blocklist)) throw blocked();
  const [existing] = await db.select().from(newsletterSubscribers).where(eq(newsletterSubscribers.email, email)).limit(1);
  if (existing?.status === 'active') return;
  const id = existing?.id ?? uuid();
  if (existing) {
    // Erneute Anmeldung (noch nicht bestätigt oder früher abgemeldet) → wieder auf „pending“ und neue Bestätigungs-Mail
    await db
      .update(newsletterSubscribers)
      .set({ status: 'pending', locale, unsubscribedAt: null, ip: encryptField(opts.ip?.slice(0, 64)), source: opts.source ?? existing.source })
      .where(eq(newsletterSubscribers.id, id));
  } else {
    await db
      .insert(newsletterSubscribers)
      .values({ id, email, locale, status: 'pending', source: opts.source ?? 'website', ip: encryptField(opts.ip?.slice(0, 64)) })
      .onConflictDoNothing();
  }
  if (opts.sendMail !== false) await sendMail(email, newsletterConfirmMail(confirmUrl(id, locale), locale));
}

export async function confirmSubscription(token: string): Promise<{ email: string }> {
  const id = verifySignedToken(token, CONFIRM);
  if (!id) throw invalidLink();
  const [row] = await db.select().from(newsletterSubscribers).where(eq(newsletterSubscribers.id, id)).limit(1);
  if (!row) throw invalidLink();
  if (row.status !== 'active') {
    await db.update(newsletterSubscribers).set({ status: 'active', confirmedAt: new Date(), unsubscribedAt: null }).where(eq(newsletterSubscribers.id, id));
  }
  return { email: row.email };
}

export async function unsubscribeByToken(token: string): Promise<{ email: string }> {
  const id = verifySignedToken(token, UNSUBSCRIBE);
  if (!id) throw invalidLink();
  const [row] = await db.select().from(newsletterSubscribers).where(eq(newsletterSubscribers.id, id)).limit(1);
  if (!row) throw invalidLink();
  if (row.status !== 'unsubscribed') {
    await db.update(newsletterSubscribers).set({ status: 'unsubscribed', unsubscribedAt: new Date() }).where(eq(newsletterSubscribers.id, id));
  }
  return { email: row.email };
}

/** Konto hat seine E-Mail-Adresse bestätigt → eine beim Erstellen angehakte Newsletter-Anmeldung wird aktiv */
export async function activateSignupSubscription(email: string): Promise<void> {
  await db
    .update(newsletterSubscribers)
    .set({ status: 'active', confirmedAt: new Date() })
    .where(and(eq(newsletterSubscribers.email, email), eq(newsletterSubscribers.status, 'pending'), eq(newsletterSubscribers.source, 'signup')));
}

/** Konto gelöscht → auch der Newsletter-Eintrag verschwindet */
export async function removeSubscriberByEmail(email: string): Promise<void> {
  await db.delete(newsletterSubscribers).where(eq(newsletterSubscribers.email, email));
}

/* ------------------------------------------------------------ Admin: Abonnenten */

const escapeLike = (q: string) => `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

export async function listSubscribers(filter: { q?: string; status?: string; page?: number }): Promise<{ subscribers: AdminSubscriberDTO[] } & PageInfo> {
  const conds: SQL[] = [];
  if (filter.status === 'pending' || filter.status === 'active' || filter.status === 'unsubscribed') conds.push(eq(newsletterSubscribers.status, filter.status));
  if (filter.q?.trim()) conds.push(sql`${newsletterSubscribers.email} like ${escapeLike(filter.q.trim())} escape '\\'`);
  const where = conds.length ? and(...conds) : undefined;
  const [totalRow] = await db.select({ n: count() }).from(newsletterSubscribers).where(where);
  const total = Number(totalRow?.n ?? 0);
  const pages = Math.max(1, Math.ceil(total / ADMIN_PAGE_SIZE));
  const page = Math.min(Math.max(1, Math.floor(filter.page ?? 1)), pages);
  const rows = await db
    .select()
    .from(newsletterSubscribers)
    .where(where)
    .orderBy(desc(newsletterSubscribers.createdAt), desc(newsletterSubscribers.id))
    .limit(ADMIN_PAGE_SIZE)
    .offset((page - 1) * ADMIN_PAGE_SIZE);
  return {
    subscribers: rows.map((r) => ({
      id: r.id,
      email: r.email,
      locale: r.locale,
      status: r.status,
      source: r.source,
      createdAt: r.createdAt.toISOString(),
      confirmedAt: iso(r.confirmedAt),
      unsubscribedAt: iso(r.unsubscribedAt),
    })),
    page,
    pageSize: ADMIN_PAGE_SIZE,
    total,
    pages,
  };
}

export async function deleteSubscriber(admin: Pick<User, 'email'>, id: string, ip?: string): Promise<void> {
  const [row] = await db.select().from(newsletterSubscribers).where(eq(newsletterSubscribers.id, id)).limit(1);
  if (!row) throw Errors.notFound(L('Eintrag nicht gefunden.', 'Entry not found.'));
  await db.delete(newsletterSubscribers).where(eq(newsletterSubscribers.id, id));
  await audit({ actor: 'admin', action: 'newsletter.subscriber_removed', message: `Newsletter-Eintrag ${row.email} entfernt (durch ${admin.email})`, ip });
}

/* ------------------------------------------------------------ Admin: Ausgaben */

function toCampaignDTO(c: typeof newsletterCampaigns.$inferSelect): AdminCampaignDTO {
  return {
    id: c.id,
    subject: { de: c.subjectDe, en: c.subjectEn },
    body: { de: c.bodyDe, en: c.bodyEn },
    audience: c.audience,
    ctaLabel: { de: c.ctaLabelDe, en: c.ctaLabelEn },
    ctaUrl: c.ctaUrl,
    status: c.status,
    total: c.total,
    sent: c.sent,
    failed: c.failed,
    createdAt: c.createdAt.toISOString(),
    startedAt: iso(c.startedAt),
    finishedAt: iso(c.finishedAt),
  };
}

export async function newsletterOverview(): Promise<AdminNewsletterDTO> {
  const rows = await db.select({ status: newsletterSubscribers.status, n: count() }).from(newsletterSubscribers).groupBy(newsletterSubscribers.status);
  const counts: Record<NewsletterStatus, number> = { pending: 0, active: 0, unsubscribed: 0 };
  for (const r of rows) counts[r.status] = Number(r.n);
  const [u] = await db.select({ n: count() }).from(users).where(and(isNotNull(users.emailVerifiedAt), eq(users.status, 'active')));
  const campaigns = await db.select().from(newsletterCampaigns).orderBy(desc(newsletterCampaigns.createdAt)).limit(50);
  return { counts, verifiedUsers: Number(u?.n ?? 0), campaigns: campaigns.map(toCampaignDTO), smtpConfigured: !!env.SMTP_HOST };
}

function campaignValues(input: CampaignInput) {
  // Fehlt eine Sprache, gilt die andere – niemand bekommt eine leere Mail
  const pick = (v: { de: string; en: string }) => ({ de: v.de.trim() || v.en.trim(), en: v.en.trim() || v.de.trim() });
  const subject = pick(input.subject);
  const body = pick(input.body);
  const cta = pick(input.ctaLabel);
  return {
    subjectDe: subject.de,
    subjectEn: subject.en,
    bodyDe: body.de,
    bodyEn: body.en,
    ctaLabelDe: cta.de,
    ctaLabelEn: cta.en,
    ctaUrl: input.ctaUrl.trim(),
    audience: input.audience,
  };
}

async function getCampaign(id: string) {
  const [c] = await db.select().from(newsletterCampaigns).where(eq(newsletterCampaigns.id, id)).limit(1);
  if (!c) throw Errors.notFound(L('Ausgabe nicht gefunden.', 'Issue not found.'));
  return c;
}

const notDraft = () => Errors.conflict('not_draft', L('Diese Ausgabe wurde bereits versendet und kann nicht mehr geändert werden.', 'This issue has already been sent.'));

export async function saveCampaign(admin: Pick<User, 'email'>, id: string | null, input: CampaignInput, ip?: string): Promise<AdminCampaignDTO> {
  const values = campaignValues(input);
  if (id) {
    const res = await db.update(newsletterCampaigns).set(values).where(and(eq(newsletterCampaigns.id, id), eq(newsletterCampaigns.status, 'draft')));
    if (affectedRows(res) !== 1) throw notDraft();
    return toCampaignDTO(await getCampaign(id));
  }
  const newId = uuid();
  await db.insert(newsletterCampaigns).values({ id: newId, ...values, createdBy: admin.email });
  await audit({ actor: 'admin', action: 'newsletter.campaign_created', message: `Newsletter-Entwurf „${values.subjectDe}“ angelegt (durch ${admin.email})`, ip });
  return toCampaignDTO(await getCampaign(newId));
}

export async function deleteCampaign(admin: Pick<User, 'email'>, id: string, ip?: string): Promise<void> {
  const c = await getCampaign(id);
  if (c.status === 'sending') throw Errors.conflict('sending', L('Der Versand läuft noch – bitte zuerst abbrechen.', 'Sending is still in progress – cancel it first.'));
  await db.delete(newsletterCampaigns).where(eq(newsletterCampaigns.id, id));
  await audit({ actor: 'admin', action: 'newsletter.campaign_deleted', message: `Newsletter „${c.subjectDe}“ gelöscht (durch ${admin.email})`, ip });
}

function mailFor(c: typeof newsletterCampaigns.$inferSelect, locale: Locale, subscriberId: string | null) {
  const de = locale === 'de';
  const label = de ? c.ctaLabelDe : c.ctaLabelEn;
  return campaignMail(
    {
      subject: de ? c.subjectDe : c.subjectEn,
      body: de ? c.bodyDe : c.bodyEn,
      cta: label && c.ctaUrl ? { label, url: c.ctaUrl } : undefined,
      unsubscribeUrl: subscriberId ? unsubscribeUrl(subscriberId, locale) : undefined,
    },
    locale,
  );
}

/** Testversand an eine Adresse (beide Sprachen, Abmeldelink ist ein Beispiel) */
export async function sendCampaignTest(id: string, to: string): Promise<void> {
  const c = await getCampaign(id);
  for (const locale of ['de', 'en'] as const) {
    const mail = mailFor(c, locale, c.audience === 'subscribers' ? 'test' : null);
    await sendMail(to, { ...mail, subject: `[Test ${locale.toUpperCase()}] ${mail.subject}` });
  }
}

/** Startet den Versand: legt je Empfänger eine Zeile an; den Rest erledigt der Worker. */
export async function startCampaign(admin: Pick<User, 'email'>, id: string, ip?: string): Promise<AdminCampaignDTO> {
  const c = await getCampaign(id);
  if (c.status !== 'draft') throw notDraft();
  if (!c.subjectDe || !c.bodyDe) throw Errors.badRequest('empty', L('Betreff und Text dürfen nicht leer sein.', 'Subject and text must not be empty.'));
  const claim = await db
    .update(newsletterCampaigns)
    .set({ status: 'sending', startedAt: new Date() })
    .where(and(eq(newsletterCampaigns.id, id), eq(newsletterCampaigns.status, 'draft')));
  if (affectedRows(claim) !== 1) throw notDraft();

  const recipients =
    c.audience === 'subscribers'
      ? await db
          .select({ email: newsletterSubscribers.email, locale: newsletterSubscribers.locale, subscriberId: newsletterSubscribers.id })
          .from(newsletterSubscribers)
          .where(eq(newsletterSubscribers.status, 'active'))
      : (
          await db
            .select({ email: users.email, locale: users.locale })
            .from(users)
            .where(and(isNotNull(users.emailVerifiedAt), eq(users.status, 'active')))
        ).map((u) => ({ ...u, subscriberId: null as string | null }));
  for (let i = 0; i < recipients.length; i += 200) {
    await db
      .insert(newsletterDeliveries)
      .values(recipients.slice(i, i + 200).map((r) => ({ campaignId: id, email: r.email, locale: r.locale, subscriberId: r.subscriberId })))
      .onConflictDoNothing();
  }
  await db.update(newsletterCampaigns).set({ total: recipients.length }).where(eq(newsletterCampaigns.id, id));
  await audit({
    actor: 'admin',
    action: 'newsletter.campaign_started',
    message: `Versand „${c.subjectDe}“ an ${recipients.length} ${c.audience === 'subscribers' ? 'Abonnenten' : 'Konten'} gestartet (durch ${admin.email})`,
    ip,
  });
  return toCampaignDTO(await getCampaign(id));
}

export async function cancelCampaign(admin: Pick<User, 'email'>, id: string, ip?: string): Promise<AdminCampaignDTO> {
  const res = await db
    .update(newsletterCampaigns)
    .set({ status: 'cancelled', finishedAt: new Date() })
    .where(and(eq(newsletterCampaigns.id, id), eq(newsletterCampaigns.status, 'sending')));
  if (affectedRows(res) === 1) {
    await db.delete(newsletterDeliveries).where(and(eq(newsletterDeliveries.campaignId, id), eq(newsletterDeliveries.status, 'pending')));
    await audit({ actor: 'admin', action: 'newsletter.campaign_cancelled', message: `Versand abgebrochen (durch ${admin.email})`, ip });
  }
  return toCampaignDTO(await getCampaign(id));
}

/* ------------------------------------------------------------ Worker */

/** Versendet die nächste Portion aller laufenden Ausgaben. `budget` = Höchstzahl E-Mails in diesem Lauf. */
export async function processCampaigns(budget: number): Promise<{ sent: number; failed: number; finished: number }> {
  const stats = { sent: 0, failed: 0, finished: 0 };
  const sending = await db.select().from(newsletterCampaigns).where(eq(newsletterCampaigns.status, 'sending')).orderBy(asc(newsletterCampaigns.startedAt));
  for (const c of sending) {
    if (budget <= 0) break;
    const batch = await db
      .select()
      .from(newsletterDeliveries)
      .where(and(eq(newsletterDeliveries.campaignId, c.id), eq(newsletterDeliveries.status, 'pending'), lt(newsletterDeliveries.attempts, MAX_ATTEMPTS)))
      .orderBy(asc(newsletterDeliveries.id))
      .limit(budget);
    // Wer sich zwischen Start und Versand abgemeldet hat, bekommt nichts mehr
    const ids = batch.map((d) => d.subscriberId).filter((x): x is string => !!x);
    const stillActive = new Set(
      ids.length
        ? (await db.select({ id: newsletterSubscribers.id }).from(newsletterSubscribers).where(and(inArray(newsletterSubscribers.id, ids), eq(newsletterSubscribers.status, 'active')))).map((r) => r.id)
        : [],
    );
    for (const d of batch) {
      budget--;
      if (d.subscriberId && !stillActive.has(d.subscriberId)) {
        await db.delete(newsletterDeliveries).where(eq(newsletterDeliveries.id, d.id));
        await db.update(newsletterCampaigns).set({ total: sql`max(${newsletterCampaigns.total} - 1, 0)` }).where(eq(newsletterCampaigns.id, c.id));
        continue;
      }
      try {
        const headers = d.subscriberId ? { 'List-Unsubscribe': `<${unsubscribeUrl(d.subscriberId, d.locale)}>` } : undefined;
        await sendMail(d.email, mailFor(c, d.locale, d.subscriberId), headers);
        await db.update(newsletterDeliveries).set({ status: 'sent', sentAt: new Date(), error: null }).where(eq(newsletterDeliveries.id, d.id));
        await db.update(newsletterCampaigns).set({ sent: sql`${newsletterCampaigns.sent} + 1` }).where(eq(newsletterCampaigns.id, c.id));
        stats.sent++;
      } catch (err) {
        const attempts = d.attempts + 1;
        const giveUp = attempts >= MAX_ATTEMPTS;
        await db
          .update(newsletterDeliveries)
          .set({ attempts, status: giveUp ? 'failed' : 'pending', error: (err as Error).message.slice(0, 300) })
          .where(eq(newsletterDeliveries.id, d.id));
        if (giveUp) {
          await db.update(newsletterCampaigns).set({ failed: sql`${newsletterCampaigns.failed} + 1` }).where(eq(newsletterCampaigns.id, c.id));
          stats.failed++;
        }
      }
    }
    const [open] = await db
      .select({ n: count() })
      .from(newsletterDeliveries)
      .where(and(eq(newsletterDeliveries.campaignId, c.id), eq(newsletterDeliveries.status, 'pending')));
    if (Number(open?.n ?? 0) === 0) {
      await db.update(newsletterCampaigns).set({ status: 'sent', finishedAt: new Date() }).where(and(eq(newsletterCampaigns.id, c.id), eq(newsletterCampaigns.status, 'sending')));
      stats.finished++;
    }
  }
  return stats;
}
