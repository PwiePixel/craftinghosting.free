/**
 * Belohnungen für Einladungen auf Discord (Admin → Discord → Einladungs-Belohnungen).
 *
 * Der Bot merkt sich, über wessen Einladungslink ein Mitglied beigetreten ist. Eine Einladung „zählt“, wenn die
 * eingeladene Person
 *  – noch Mitglied des Discord-Servers ist (und, falls eingestellt, schon lange genug),
 *  – ihr Discord-Konto mit einem Website-Account verknüpft hat und
 *  – einen Server hat, der in den letzten N Tagen online war.
 * Erreicht jemand eine Stufe (z. B. 10 zählende Einladungen), schaltet das System eine Belohnung frei und der Bot
 * schreibt eine Direktnachricht mit einem Button zum Einlösen. Kommt die Nachricht nicht an (Direktnachrichten
 * deaktiviert), erwähnt der Bot die Person im eingestellten Kanal. Mit „!rewards“ per Direktnachricht zeigt der
 * Bot jederzeit den Stand.
 *
 * Eine eingelöste Belohnung ist ein zusätzlicher Slot für den verknüpften Website-Account (siehe server-limits).
 */
import { and, count, eq, isNull, sql } from 'drizzle-orm';
import { type BonusSlot, type InviteRewardSettings, type InviteRewardTier, type Localized, type ProductKind, type SiteSettings } from '@chfree/shared';
import { affectedRows, db } from '../db/client';
import { discordInvites, inviteRewards, users, type InviteReward } from '../db/schema';
import { env } from '../env';
import { uuid } from '../lib/crypto';
import { audit } from '../services/audit.service';
import { getSettings } from '../services/settings.service';
import { discordRequest, type DiscordUser } from './rest';
import { botRequest, discordConfig } from './service';

const COLOR = 0xf59e0b;
const DAY_MS = 86_400_000;
const both = (t: Localized) => `🇩🇪 ${t.de}\n🇬🇧 ${t.en}`;

/* ------------------------------------------------------------ Einladungen merken */

/** Beitritt über den Einladungslink einer Person. Jedes Konto zählt nur für die erste Person, die es eingeladen hat. */
export async function recordInvite(inviteeId: string, inviterId: string, code: string | null): Promise<void> {
  if (inviteeId === inviterId) return;
  const [known] = await db.select().from(discordInvites).where(eq(discordInvites.inviteeId, inviteeId)).limit(1);
  // Wiederkehrer: zählt wieder – weiterhin für die ursprüngliche Person
  if (known) return void (await db.update(discordInvites).set({ leftAt: null }).where(eq(discordInvites.inviteeId, inviteeId)));
  await db.insert(discordInvites).values({ inviteeId, inviterId, code, joinedAt: new Date() }).onConflictDoNothing();
}

/** Mitglied hat den Server verlassen: Die Einladung zählt nicht mehr (bis es zurückkommt) */
export async function recordLeave(discordId: string): Promise<void> {
  await db.update(discordInvites).set({ leftAt: new Date() }).where(and(eq(discordInvites.inviteeId, discordId), isNull(discordInvites.leftAt)));
}

/** Kommt ein Mitglied ohne Einladungslink zurück (z. B. über die Website), zählt eine frühere Einladung wieder */
export async function recordReturn(discordId: string): Promise<void> {
  await db.update(discordInvites).set({ leftAt: null }).where(eq(discordInvites.inviteeId, discordId));
}

/* ------------------------------------------------------------ Zählen */

export interface InviteStats {
  /** Eingeladene, die noch Mitglied sind */
  total: number;
  /** davon mit verknüpftem Account und aktivem Server – nur diese zählen für Belohnungen */
  qualified: number;
}

export async function inviteStats(inviterId: string, cfg: InviteRewardSettings, now = new Date()): Promise<InviteStats> {
  const activeSince = now.getTime() - cfg.activeDays * DAY_MS;
  const memberBefore = now.getTime() - cfg.minMemberDays * DAY_MS;
  const [total] = await db
    .select({ n: count() })
    .from(discordInvites)
    .where(and(eq(discordInvites.inviterId, inviterId), isNull(discordInvites.leftAt)));
  const [qualified] = await db
    .select({ n: count() })
    .from(discordInvites)
    .innerJoin(users, eq(users.discordId, discordInvites.inviteeId))
    .where(
      and(
        eq(discordInvites.inviterId, inviterId),
        isNull(discordInvites.leftAt),
        sql`${discordInvites.joinedAt} <= ${memberBefore}`,
        eq(users.status, 'active'),
        // Mindestens ein Server, der gerade läuft oder in den letzten Tagen online war
        sql`exists (
          select 1 from servers s
          where s.user_id = ${users.id} and s.status in ('active', 'expiring')
            and (s.power_state in ('running', 'starting')
              or exists (select 1 from server_sessions ss where ss.server_id = s.id and (ss.ended_at is null or ss.ended_at >= ${activeSince})))
        )`,
      ),
    );
  return { total: Number(total?.n ?? 0), qualified: Number(qualified?.n ?? 0) };
}

/* ------------------------------------------------------------ Texte */

const KIND_NAME: Record<ProductKind, Localized> = { minecraft: { de: 'Minecraft-Server', en: 'Minecraft server' }, discord: { de: 'Discord-Bot', en: 'Discord bot' } };

/** Kleinstes aktives Paket eines Angebots (nach Arbeitsspeicher) */
function smallestPlan(settings: SiteSettings, kind: ProductKind) {
  return [...settings.products[kind].plans].filter((p) => p.enabled).sort((a, b) => a.memoryMb - b.memoryMb)[0] ?? null;
}

/** Welches Paket gilt für einen Slot dieser Stufe? null = jedes Paket */
function resolvePlan(settings: SiteSettings, kind: ProductKind, rule: string): { id: string; name: string } | null {
  if (!rule) return null;
  const plans = settings.products[kind].plans;
  const plan = rule === 'smallest' ? smallestPlan(settings, kind) : (plans.find((p) => p.id === rule) ?? smallestPlan(settings, kind));
  return plan ? { id: plan.id, name: plan.name } : null;
}

/** „einen zusätzlichen Discord-Bot im kleinsten Paket (Bot 256 MB)“ */
function rewardText(settings: SiteSettings, t: Pick<InviteRewardTier, 'reward' | 'planId'>): Localized {
  if (t.reward === 'choice') {
    return t.planId === 'smallest'
      ? { de: 'einen zusätzlichen Slot deiner Wahl – für einen Minecraft-Server oder einen Discord-Bot im jeweils kleinsten Paket', en: 'an extra slot of your choice – for a Minecraft server or a Discord bot in the smallest plan' }
      : { de: 'einen zusätzlichen Slot deiner Wahl – für einen Minecraft-Server oder einen Discord-Bot', en: 'an extra slot of your choice – for a Minecraft server or a Discord bot' };
  }
  const plan = resolvePlan(settings, t.reward, t.planId);
  const name = KIND_NAME[t.reward];
  if (!plan) return { de: `einen zusätzlichen ${name.de}`, en: `an extra ${name.en}` };
  return t.planId === 'smallest'
    ? { de: `einen zusätzlichen ${name.de} im kleinsten Paket (${plan.name})`, en: `an extra ${name.en} in the smallest plan (${plan.name})` }
    : { de: `einen zusätzlichen ${name.de} im Paket ${plan.name}`, en: `an extra ${name.en} in the ${plan.name} plan` };
}

const REWARD_BUTTON = /^reward:([0-9a-f-]{36}):(m|d)$/i;
export const isRewardButton = (customId: string | undefined) => !!customId && REWARD_BUTTON.test(customId);

/** Buttons zum Einlösen einer Belohnung (bei freier Wahl zwei) */
function redeemButtons(grant: Pick<InviteReward, 'id' | 'reward' | 'invites'>, withCount: boolean) {
  const prefix = withCount ? `${grant.invites}: ` : '';
  if (grant.reward === 'choice') {
    return [
      { type: 2, style: 3, label: `${prefix}Minecraft-Server`, emoji: { name: '⛏️' }, custom_id: `reward:${grant.id}:m` },
      { type: 2, style: 3, label: `${prefix}Discord-Bot`, emoji: { name: '🤖' }, custom_id: `reward:${grant.id}:d` },
    ];
  }
  return [{ type: 2, style: 3, label: `${prefix}Geschenk einlösen · Redeem gift`, emoji: { name: '🎁' }, custom_id: `reward:${grant.id}:${grant.reward === 'minecraft' ? 'm' : 'd'}` }];
}

/* ------------------------------------------------------------ Stufen prüfen und benachrichtigen */

/** Schickt eine Direktnachricht. false = nicht zustellbar (z. B. Direktnachrichten deaktiviert) */
export async function sendDm(discordId: string, message: unknown): Promise<boolean> {
  try {
    const channel = await botRequest<{ id: string }>('POST', '/users/@me/channels', { json: { recipient_id: discordId } });
    await botRequest('POST', `/channels/${channel.id}/messages`, { json: message });
    return true;
  } catch {
    return false;
  }
}

async function notifyGrant(grant: InviteReward, settings: SiteSettings): Promise<'dm' | 'channel' | 'none'> {
  const cfg = settings.discord.inviteRewards;
  const reward = rewardText(settings, { reward: grant.reward, planId: grant.planRule });
  const dm = await sendDm(grant.discordId, {
    embeds: [
      {
        title: '🎉 Herzlichen Glückwunsch! · Congratulations!',
        color: COLOR,
        description: both({
          de: `Du hast **${grant.invites} Nutzer** eingeladen, die unseren Service aktiv nutzen. Als Dankeschön bekommst du ${reward.de}.\n${grant.reward === 'choice' ? 'Wähle unten, wofür du den Slot möchtest.' : 'Klicke auf den Button, um dein Geschenk einzulösen.'}`,
          en: `You have invited **${grant.invites} users** who actively use our service. As a thank-you you get ${reward.en}.\n${grant.reward === 'choice' ? 'Choose below what you want the slot for.' : 'Click the button to redeem your gift.'}`,
        }),
        footer: { text: 'CraftingHosting.free · !rewards' },
      },
    ],
    components: [{ type: 1, components: redeemButtons(grant, false) }],
  });
  if (dm) return 'dm';
  if (!cfg.fallbackChannelId) return 'none';
  try {
    await botRequest('POST', `/channels/${cfg.fallbackChannelId}/messages`, {
      json: {
        content: `<@${grant.discordId}>\n${both({
          de: `🎁 Du hast eine Einladungs-Belohnung freigeschaltet (${grant.invites} aktive Einladungen)! Weil deine Direktnachrichten deaktiviert sind, melde ich mich hier: Schreibe mir per Direktnachricht \`!rewards\`, um dein Geschenk einzulösen.`,
          en: `🎁 You have unlocked an invite reward (${grant.invites} active invites)! Because your direct messages are disabled, I am letting you know here: send me \`!rewards\` as a direct message to redeem your gift.`,
        })}`,
        allowed_mentions: { parse: [], users: [grant.discordId] },
      },
    });
    return 'channel';
  } catch {
    return 'none';
  }
}

/**
 * Prüft die Stufen einer Person und schaltet neu erreichte Belohnungen frei (jede Stufe nur einmal).
 * `notify` = die Person per Direktnachricht bzw. im Ersatz-Kanal benachrichtigen.
 */
export async function evaluateInviter(discordId: string, settings: SiteSettings, opts: { notify: boolean }): Promise<{ stats: InviteStats; unlocked: InviteReward[] }> {
  const cfg = settings.discord.inviteRewards;
  const stats = await inviteStats(discordId, cfg);
  const unlocked: InviteReward[] = [];
  if (!cfg.enabled) return { stats, unlocked };
  for (const tier of cfg.tiers) {
    if (stats.qualified < tier.invites) continue;
    const id = uuid();
    const res = await db
      .insert(inviteRewards)
      .values({ id, discordId, tierId: tier.id, invites: tier.invites, reward: tier.reward, planRule: tier.planId })
      .onConflictDoNothing();
    if (affectedRows(res) !== 1) continue; // diese Stufe wurde schon vergeben
    const [grant] = await db.select().from(inviteRewards).where(eq(inviteRewards.id, id)).limit(1);
    if (!grant) continue;
    const [account] = await db.select({ id: users.id }).from(users).where(eq(users.discordId, discordId)).limit(1);
    await audit({ userId: account?.id ?? null, actor: 'system', action: 'discord.reward_unlocked', message: `Einladungs-Belohnung freigeschaltet: ${tier.invites} aktive Einladungen (Discord-Konto ${discordId})` });
    if (opts.notify) {
      const via = await notifyGrant(grant, settings);
      await db.update(inviteRewards).set({ notifiedVia: via }).where(eq(inviteRewards.id, id));
      grant.notifiedVia = via;
    }
    unlocked.push(grant);
  }
  return { stats, unlocked };
}

/** Job: alle Personen prüfen, die genug Einladungen für die kleinste Stufe haben könnten */
export async function evaluateAllInviters(): Promise<{ checked: number; unlocked: number }> {
  if (env.BETA_MODE) return { checked: 0, unlocked: 0 };
  const dc = await discordConfig();
  const settings = await getSettings();
  const cfg = settings.discord.inviteRewards;
  if (!dc.botReady || !cfg.enabled || cfg.tiers.length === 0) return { checked: 0, unlocked: 0 };
  const lowest = Math.min(...cfg.tiers.map((t) => t.invites));
  const candidates = await db
    .select({ inviterId: discordInvites.inviterId, n: count() })
    .from(discordInvites)
    .where(isNull(discordInvites.leftAt))
    .groupBy(discordInvites.inviterId)
    .having(sql`count(*) >= ${lowest}`)
    .limit(500);
  let unlocked = 0;
  for (const c of candidates) unlocked += (await evaluateInviter(c.inviterId, settings, { notify: true })).unlocked.length;
  return { checked: candidates.length, unlocked };
}

/* ------------------------------------------------------------ „!rewards“ per Direktnachricht */

export const isRewardsCommand = (content: string | undefined) => /^!?\s*(rewards?|geschenke?|belohnung(en)?|einladungen|invites?)\s*[!.]?$/i.test((content ?? '').trim());

/** Baustein für die Übersicht („!rewards“): Stand der Einladungen, Stufen und Buttons zum Einlösen */
export async function inviteOverview(discordId: string, settings: SiteSettings): Promise<{ text: string; components: unknown[] }> {
  const cfg = settings.discord.inviteRewards;
  if (!cfg.enabled || cfg.tiers.length === 0) return { text: '', components: [] };
  const { stats } = await evaluateInviter(discordId, settings, { notify: false });
  const grants = await db.select().from(inviteRewards).where(eq(inviteRewards.discordId, discordId));
  const line = (lang: 'de' | 'en') =>
    cfg.tiers
      .map((t) => {
        const grant = grants.find((g) => g.tierId === t.id);
        const what = rewardText(settings, grant ? { reward: grant.reward, planId: grant.planRule } : t)[lang];
        const n = lang === 'de' ? `${t.invites} Einladungen` : `${t.invites} invites`;
        if (grant?.status === 'redeemed') return `✅ **${n}** – ${what} (${lang === 'de' ? 'eingelöst' : 'redeemed'})`;
        if (grant) return `🎁 **${n}** – ${what} (${lang === 'de' ? 'bereit zum Einlösen' : 'ready to redeem'})`;
        const missing = Math.max(0, t.invites - stats.qualified);
        return `🔒 **${n}** – ${what} (${lang === 'de' ? `noch ${missing}` : `${missing} to go`})`;
      })
      .join('\n');
  const available = grants.filter((g) => g.status === 'available').sort((a, b) => a.invites - b.invites);
  const text = [
    `🇩🇪 **Einladungen** – aktiv: **${stats.qualified}** (eingeladen und noch auf dem Server: ${stats.total})\n${line('de')}`,
    `Eine Einladung zählt, sobald die Person ihr Discord-Konto mit CraftingHosting.free verknüpft hat und ihr Server in den letzten ${cfg.activeDays} Tagen online war. Nutze dafür deinen eigenen Einladungslink.`,
    '',
    `🇬🇧 **Invites** – active: **${stats.qualified}** (invited and still on the server: ${stats.total})\n${line('en')}`,
    `An invite counts as soon as the person has linked their Discord account with CraftingHosting.free and their server was online within the last ${cfg.activeDays} days. Use your own invite link.`,
  ].join('\n');
  // Höchstens vier Reihen – je einlösbarer Belohnung eine
  return { text, components: available.slice(0, 4).map((g) => ({ type: 1, components: redeemButtons(g, true) })) };
}

/** Stufen der Einladungs-Belohnungen als Text (für die Ankündigung) */
export function inviteTierLines(settings: SiteSettings, lang: 'de' | 'en'): string[] {
  return settings.discord.inviteRewards.tiers.map((t) => `**${t.invites} ${lang === 'de' ? 'Einladungen' : 'invites'}** → ${rewardText(settings, t)[lang]}`);
}

/* ------------------------------------------------------------ Einlösen */

interface RewardInteraction {
  id: string;
  token: string;
  user?: DiscordUser;
  member?: { user?: DiscordUser };
  data?: { custom_id?: string };
}

/** Klick auf „Geschenk einlösen“ bzw. auf die Wahl Minecraft-Server / Discord-Bot */
export async function onRewardButton(i: RewardInteraction): Promise<void> {
  const discordUser = i.user ?? i.member?.user;
  const match = REWARD_BUTTON.exec(i.data?.custom_id ?? '');
  if (!discordUser || !match) return;
  const reply = (text: Localized) =>
    discordRequest('POST', `/interactions/${i.id}/${i.token}/callback`, { json: { type: 4, data: { content: both(text), allowed_mentions: { parse: [] } } } }).catch(() => null);

  const settings = await getSettings();
  const [grant] = await db
    .select()
    .from(inviteRewards)
    .where(and(eq(inviteRewards.id, match[1]!), eq(inviteRewards.discordId, discordUser.id)))
    .limit(1);
  if (!grant) return void (await reply({ de: '❌ Diese Belohnung gehört nicht zu deinem Konto.', en: '❌ This reward does not belong to your account.' }));
  if (grant.status === 'redeemed') {
    return void (await reply({ de: '✅ Diese Belohnung hast du bereits eingelöst. Mit `!rewards` siehst du deinen Stand.', en: '✅ You have already redeemed this reward. Use `!rewards` to see your status.' }));
  }
  const [account] = await db.select().from(users).where(eq(users.discordId, discordUser.id)).limit(1);
  if (!account) {
    return void (await reply({
      de: `Zum Einlösen brauchst du einen CraftingHosting.free-Account, der mit diesem Discord-Konto verknüpft ist: ${env.APP_URL}/de/meine-server – danach einfach noch einmal auf den Button klicken.`,
      en: `To redeem you need a CraftingHosting.free account linked to this Discord account: ${env.APP_URL}/my-servers – then simply click the button again.`,
    }));
  }
  // Bei fester Belohnung zählt die Stufe, nicht der Button
  const kind: ProductKind = grant.reward === 'choice' ? (match[2]!.toLowerCase() === 'm' ? 'minecraft' : 'discord') : grant.reward;
  const plan = resolvePlan(settings, kind, grant.planRule);
  const res = await db
    .update(inviteRewards)
    .set({ status: 'redeemed', userId: account.id, kind, planId: plan?.id ?? null, redeemedAt: new Date() })
    .where(and(eq(inviteRewards.id, grant.id), eq(inviteRewards.status, 'available')));
  if (affectedRows(res) !== 1) return void (await reply({ de: '✅ Diese Belohnung wurde bereits eingelöst.', en: '✅ This reward has already been redeemed.' }));
  await audit({
    userId: account.id,
    actor: 'user',
    action: 'discord.reward_redeemed',
    message: `Einladungs-Belohnung eingelöst (${grant.invites} Einladungen): zusätzlicher Slot für ${KIND_NAME[kind].de}${plan ? `, Paket ${plan.name}` : ''}`,
  });
  const type = kind === 'discord' ? '?type=discord' : '';
  await reply({
    de: `✅ Eingelöst! Du kannst jetzt einen zusätzlichen ${KIND_NAME[kind].de}${plan ? ` im Paket **${plan.name}**` : ''} erstellen: ${env.APP_URL}/de/start${type}`,
    en: `✅ Redeemed! You can now create an extra ${KIND_NAME[kind].en}${plan ? ` in the **${plan.name}** plan` : ''}: ${env.APP_URL}/start${type}`,
  });
}

/* ------------------------------------------------------------ Für Website und Admin */

/** Eingelöste Einladungs-Belohnungen eines Accounts als zusätzliche Slots */
export async function inviteBonusSlots(userId: string): Promise<BonusSlot[]> {
  const rows = await db
    .select({ kind: inviteRewards.kind, planId: inviteRewards.planId })
    .from(inviteRewards)
    .where(and(eq(inviteRewards.userId, userId), eq(inviteRewards.status, 'redeemed')));
  return rows.filter((r): r is { kind: ProductKind; planId: string | null } => r.kind !== null);
}

export interface InviteLeaderRow {
  discordId: string;
  /** Name, falls das Konto mit einem Website-Account verknüpft ist */
  username: string | null;
  email: string | null;
  total: number;
  qualified: number;
  rewards: number;
  redeemed: number;
}

/** Die 25 Personen mit den meisten Einladungen (für den Admin-Bereich) */
export async function inviteLeaderboard(): Promise<InviteLeaderRow[]> {
  const cfg = (await getSettings()).discord.inviteRewards;
  const top = await db
    .select({ inviterId: discordInvites.inviterId, n: count() })
    .from(discordInvites)
    .where(isNull(discordInvites.leftAt))
    .groupBy(discordInvites.inviterId)
    .orderBy(sql`count(*) desc`)
    .limit(25);
  const out: InviteLeaderRow[] = [];
  for (const row of top) {
    const [account] = await db.select({ email: users.email, name: users.discordUsername }).from(users).where(eq(users.discordId, row.inviterId)).limit(1);
    const grants = await db.select({ status: inviteRewards.status }).from(inviteRewards).where(eq(inviteRewards.discordId, row.inviterId));
    const stats = await inviteStats(row.inviterId, cfg);
    out.push({
      discordId: row.inviterId,
      username: account?.name ?? null,
      email: account?.email ?? null,
      total: stats.total,
      qualified: stats.qualified,
      rewards: grants.length,
      redeemed: grants.filter((g) => g.status === 'redeemed').length,
    });
  }
  return out;
}

