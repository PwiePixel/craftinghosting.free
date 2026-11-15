/**
 * Warteliste für die erste Startphase (Early Access).
 *  – Anfrage im Modus „preregistration“ → Eintrag mit Status „waitlist“ (noch ohne Platz)
 *  – E-Mail bestätigt → fortlaufender Platz (Position), Rang bestimmt EPYC oder Xeon
 *  – Freischalten im Admin → Status „pending“ → Server wird erstellt, sobald der Panel-Zugang steht
 */
import { and, asc, eq, inArray, isNotNull, isNull, sql } from 'drizzle-orm';
import { freeHostingConfig, getPlan, tierForPosition, websiteEpycSlots, type Locale } from '@chfree/shared';
import { db } from '../db/client';
import { servers, users, type Server, type User } from '../db/schema';
import { uuid } from '../lib/crypto';
import { L } from '../lib/errors';
import { audit } from './audit.service';
import { notify } from './notification.service';
import { manageUrl, manageUrlShort } from './panel';
import { activatePendingServers, assertConfigAvailable, countOwnedServers, savePendingServer } from './server.service';
import { getSettings, invalidatePublicSite, planAvailability, waitlistRank } from './settings.service';

export async function hasWaitlistEntry(userId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: servers.id })
    .from(servers)
    .where(and(eq(servers.userId, userId), eq(servers.status, 'waitlist'), isNotNull(servers.waitlistPosition)))
    .limit(1);
  return !!row;
}

/** Vergibt bestätigten Einträgen eines Nutzers den nächsten freien Platz (sicher bei parallelen Anfragen). */
export async function confirmWaitlist(userId: string): Promise<void> {
  const open = await db
    .select({ id: servers.id })
    .from(servers)
    .where(and(eq(servers.userId, userId), eq(servers.status, 'waitlist'), isNull(servers.waitlistPosition)));
  for (const { id } of open) {
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        await db.execute(
          sql`UPDATE ${servers} SET ${servers.waitlistPosition} = (SELECT next FROM (SELECT COALESCE(MAX(${servers.waitlistPosition}), 0) + 1 AS next FROM ${servers}) AS t), ${servers.waitlistJoinedAt} = NOW(3) WHERE ${servers.id} = ${id} AND ${servers.waitlistPosition} IS NULL`,
        );
        break;
      } catch (err) {
        // Gleichzeitige Bestätigung → gleiche Nummer → Unique-Index greift → erneut versuchen
        if ((err as { code?: string }).code !== 'ER_DUP_ENTRY' || attempt === 4) throw err;
      }
    }
  }
  invalidatePublicSite();
}

export async function waitlistForUser(userId: string) {
  const [entry] = await db
    .select()
    .from(servers)
    .where(and(eq(servers.userId, userId), eq(servers.status, 'waitlist'), isNotNull(servers.waitlistPosition)))
    .limit(1);
  if (entry?.waitlistPosition == null) return null;
  const [rank, s] = await Promise.all([waitlistRank(entry.waitlistPosition), getSettings()]);
  return { position: rank, tier: tierForPosition(rank, websiteEpycSlots(s.waitlist)) };
}

/**
 * Schaltet Wartelisten-Plätze frei. Mit Panel-Zugang wird der Server sofort erstellt,
 * sonst bekommt der Nutzer eine E-Mail, dass sein Platz bereit ist.
 */
export async function releaseWaitlist(
  ids: string[],
  admin: Pick<User, 'email'>,
  ip?: string,
): Promise<{ released: number; created: number; skippedFull: number }> {
  const settings = await getSettings();
  let released = 0;
  let created = 0;
  let skippedFull = 0;
  // Freie Plätze je Paket – freigeschaltete, noch nicht erstellte Server zählen mit, damit nicht zu viele freigeschaltet werden
  const pendingRows = await db
    .select({ planId: servers.planId })
    .from(servers)
    .where(eq(servers.status, 'pending'));
  const pendingByPlan: Record<string, number> = {};
  for (const r of pendingRows) pendingByPlan[r.planId] = (pendingByPlan[r.planId] ?? 0) + 1;
  const remaining = Object.fromEntries((await planAvailability(settings, pendingByPlan)).map((p) => [p.id, p.remaining]));
  const rows = await db
    .select({ s: servers, u: users })
    .from(servers)
    .innerJoin(users, eq(users.id, servers.userId))
    .where(and(inArray(servers.id, ids), eq(servers.status, 'waitlist'), isNotNull(servers.waitlistPosition)))
    .orderBy(asc(servers.waitlistPosition));
  for (const { s, u } of rows) {
    const left = remaining[s.planId];
    if (left !== null && left !== undefined && left <= 0) {
      skippedFull++;
      continue;
    }
    if (typeof left === 'number') remaining[s.planId] = left - 1;
    const rank = await waitlistRank(s.waitlistPosition!);
    const tier = tierForPosition(rank, websiteEpycSlots(settings.waitlist));
    const now = new Date();
    await db
      .update(servers)
      .set({ status: 'pending', nodeTier: tier, cycleStartedAt: now, cycleEndsAt: new Date(now.getTime() + freeHostingConfig.cycle.days * 86_400_000) })
      .where(and(eq(servers.id, s.id), eq(servers.status, 'waitlist')));
    released++;
    await audit({
      userId: u.id,
      serverId: s.id,
      actor: 'admin',
      action: 'waitlist.released',
      message: `Wartelisten-Platz #${rank} (${tier === 'epyc' ? 'AMD EPYC' : 'Intel Xeon'}) freigeschaltet (durch ${admin.email})`,
      ip,
    });
    if (u.emailVerifiedAt && u.pteroUserId) {
      const done = await activatePendingServers(u, ip);
      created += done.length;
    } else {
      await notify({
        userId: u.id,
        serverId: s.id,
        type: 'waitlist.released',
        title: L('Dein Platz ist frei – jetzt Server erstellen', 'Your spot is ready – create your server now'),
        body: (l) =>
          l === 'en'
            ? `Good news: your early-access spot for “${s.name}” is ready. Sign in at ${manageUrlShort(l)}, set up your panel access and your server will be created right away.`
            : `Gute Nachricht: Dein Platz in der ersten Startphase für „${s.name}“ ist frei. Melde dich unter ${manageUrlShort(l)} an, lege deinen Panel-Zugang fest und dein Server wird sofort erstellt.`,
        dedupeKey: `waitlist-released:${s.id}`,
        email: true,
      });
    }
  }
  invalidatePublicSite();
  return { released, created, skippedFull };
}

/** Die nächsten N bestätigten Einträge (nach Platz) */
export async function nextWaitlistIds(n: number): Promise<string[]> {
  const rows = await db
    .select({ id: servers.id })
    .from(servers)
    .where(and(eq(servers.status, 'waitlist'), isNotNull(servers.waitlistPosition)))
    .orderBy(asc(servers.waitlistPosition))
    .limit(Math.max(0, Math.min(500, n)));
  return rows.map((r) => r.id);
}

export async function removeWaitlistEntry(id: string, admin: Pick<User, 'email'>, ip?: string): Promise<void> {
  const [s] = await db.select().from(servers).where(and(eq(servers.id, id), eq(servers.status, 'waitlist'))).limit(1);
  if (!s) return;
  await db.delete(servers).where(and(eq(servers.id, id), eq(servers.status, 'waitlist')));
  await audit({ userId: s.userId, actor: 'admin', action: 'waitlist.removed', message: `Wartelisten-Eintrag „${s.name}“ entfernt (durch ${admin.email})`, ip });
  invalidatePublicSite();
}

export type WaitlistRow = Server;


/* ------------------------------------------------------------ Manuell hinzufügen */

export interface ManualWaitlistInput {
  entries: { email: string; name?: string }[];
  planId: string;
  serverType: string;
  version: string;
  /** Sprache für E-Mails an neu angelegte Konten */
  locale: Locale;
  /** true = vor allen bisherigen Einträgen einreihen (z. B. Vormerkungen aus dem alten System) */
  priority: boolean;
  /** Betroffene per E-Mail über ihren Platz informieren */
  notify: boolean;
}

export interface ManualWaitlistResult {
  added: { email: string; position: number }[];
  skipped: { email: string; reason: string }[];
}

/** Vergibt einem Eintrag einen Platz vor allen bisherigen (kleinste Nummer − 1, sicher bei parallelen Anfragen). */
async function assignFrontPosition(serverId: string): Promise<void> {
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      await db.execute(
        sql`UPDATE ${servers} SET ${servers.waitlistPosition} = (SELECT next FROM (SELECT COALESCE(MIN(${servers.waitlistPosition}), 1) - 1 AS next FROM ${servers}) AS t), ${servers.waitlistJoinedAt} = NOW(3) WHERE ${servers.id} = ${serverId} AND ${servers.waitlistPosition} IS NULL`,
      );
      return;
    } catch (err) {
      if ((err as { code?: string }).code !== 'ER_DUP_ENTRY' || attempt === 4) throw err;
    }
  }
}

/**
 * Übernimmt Personen, die sich schon vorher eingetragen haben (z. B. im alten System oder per Discord),
 * auf die Warteliste. Fehlende Konten werden angelegt; wer schon einen Server oder Platz hat, wird übersprungen.
 */
export async function addWaitlistEntries(input: ManualWaitlistInput, admin: Pick<User, 'email'>, ip?: string): Promise<ManualWaitlistResult> {
  const result: ManualWaitlistResult = { added: [], skipped: [] };
  const addedIds: { email: string; id: string }[] = [];
  const plan = getPlan(input.planId);
  if (!plan) throw new Error('Unbekanntes Paket');
  // Vom Admin übernommene Vormerkungen dürfen auch in ein volles Paket – belegt wird erst beim Freischalten
  await assertConfigAvailable({ planId: input.planId, serverType: input.serverType, version: input.version, name: 'x' }, { ignoreCapacity: true });

  // Doppelte Adressen: erste Nennung zählt. Bei Priorität rückwärts einreihen, damit die Reihenfolge der Liste erhalten bleibt.
  const seen = new Set<string>();
  const unique = input.entries
    .map((e) => ({ ...e, email: e.email.trim().toLowerCase() }))
    .filter((e) => (seen.has(e.email) ? false : (seen.add(e.email), true)));
  const list = input.priority ? [...unique].reverse() : unique;
  for (const entry of list) {
    const email = entry.email;

    let [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);
    if (!user) {
      await db.insert(users).ignore().values({ id: uuid(), email, acceptedTermsAt: new Date(), locale: input.locale });
      [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);
      if (!user) {
        result.skipped.push({ email, reason: 'Konto konnte nicht angelegt werden' });
        continue;
      }
      await audit({ userId: user.id, actor: 'admin', action: 'account.created', message: `Konto für die Warteliste angelegt (durch ${admin.email})`, ip });
    }
    if (user.status !== 'active') {
      result.skipped.push({ email, reason: 'Konto ist gesperrt' });
      continue;
    }
    if ((await countOwnedServers(user.id)) > 0) {
      result.skipped.push({ email, reason: 'hat bereits einen Server' });
      continue;
    }
    if (await hasWaitlistEntry(user.id)) {
      result.skipped.push({ email, reason: 'steht bereits auf der Warteliste' });
      continue;
    }

    const name = entry.name?.trim() || 'Minecraft Server';
    const id = await savePendingServer(user.id, { planId: input.planId, serverType: input.serverType, version: input.version, name }, 'waitlist');
    if (input.priority) await assignFrontPosition(id);
    else await confirmWaitlist(user.id);

    addedIds.push({ email, id });
    await audit({
      userId: user.id,
      serverId: id,
      actor: 'admin',
      action: 'waitlist.added',
      message: `Auf die Warteliste übernommen${input.priority ? ' (vorne eingereiht)' : ''} (durch ${admin.email})`,
      ip,
    });

    if (input.notify) {
      await notify({
        userId: user.id,
        serverId: id,
        type: 'waitlist.added',
        title: L('Dein Platz in der ersten Startphase ist reserviert', 'Your spot in the first launch phase is reserved'),
        body: (l) =>
          l === 'en'
            ? `We have carried over your earlier registration: you are on the waitlist for the first launch phase of CraftingHosting.free – you do not need to do anything else. As soon as your spot is unlocked, you will get an email and can set up your panel access. You can view or delete your spot at any time at ${manageUrl(l)} (sign-in via email link).`
            : `Wir haben deine frühere Anmeldung übernommen: Du stehst auf der Warteliste für die erste Startphase von CraftingHosting.free – du musst nichts weiter tun. Sobald dein Platz freigeschaltet ist, bekommst du eine E-Mail und kannst deinen Panel-Zugang festlegen. Deinen Platz ansehen oder löschen kannst du jederzeit unter ${manageUrl(l)} (Anmeldung per E-Mail-Link).`,
        dedupeKey: `waitlist-added:${id}`,
        email: true,
      });
    }
  }
  // Plätze erst am Ende bestimmen – vorne eingereihte Einträge verschieben sich gegenseitig
  if (input.priority) addedIds.reverse();
  for (const { email, id } of addedIds) {
    const [row] = await db.select({ position: servers.waitlistPosition }).from(servers).where(eq(servers.id, id)).limit(1);
    result.added.push({ email, position: row?.position != null ? await waitlistRank(row.position) : 0 });
  }
  invalidatePublicSite();
  return result;
}
