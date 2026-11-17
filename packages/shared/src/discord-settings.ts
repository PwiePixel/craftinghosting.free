/**
 * Einstellungen der Discord-Anbindung (Admin → Discord). Geheimnisse (Bot-Token, Client-Secret)
 * stehen NICHT hier – sie liegen getrennt und zusätzlich verschlüsselt in der Datenbank.
 */
import type { ProductKind } from './config/freehosting.config';
import type { Localized } from './i18n';

/** Ein Button eines Rollen-Panels: Klick gibt bzw. nimmt die Rolle */
export interface DiscordRoleButton {
  label: string;
  /** Emoji vor dem Text, z. B. 📢 (leer = keins) */
  emoji: string;
  /** ID der Discord-Rolle */
  roleId: string;
}

/** Nachricht mit Buttons, über die sich Mitglieder selbst Rollen geben (z. B. Ankündigungen, Free/Paid Hosting) */
export interface DiscordRolePanel {
  id: string;
  title: string;
  /** Text im Embed (Zeilenumbrüche erlaubt) */
  text: string;
  /** true = nur eine Rolle dieses Panels gleichzeitig (die anderen werden entfernt) */
  exclusive: boolean;
  buttons: DiscordRoleButton[];
}

export interface DiscordWelcomeSettings {
  enabled: boolean;
  /** Kanal für die Willkommensnachricht */
  channelId: string;
  /** Text über dem Embed. Platzhalter siehe discordWelcomePlaceholders */
  content: string;
  title: string;
  description: string;
  /** Farbe des Embeds (#rrggbb) */
  color: string;
  /** Banner des Mitglieds als großes Bild zeigen */
  showBanner: boolean;
  /** Bild, wenn das Mitglied kein eigenes Banner hat (leer = kein Bild) */
  fallbackImageUrl: string;
  footer: string;
}

export interface DiscordSettings {
  /** Anbindung eingeschaltet (Verknüpfung, Rollen, Tickets, Bot) */
  enabled: boolean;
  /** Nur wer sein Discord-Konto verknüpft hat und Mitglied des Servers ist, bekommt kostenlose Server */
  required: boolean;
  /** Wichtige Benachrichtigungen (die auch per E-Mail gehen) zusätzlich als Direktnachricht vom Bot schicken */
  notifyByDm: boolean;
  /** Application ID der Discord-Anwendung (= Client ID) */
  clientId: string;
  /** ID des Discord-Servers */
  guildId: string;
  /** Beim Verknüpfen automatisch dem Discord-Server beitreten (OAuth-Berechtigung guilds.join) */
  autoJoin: boolean;
  /** Mindestalter des Discord-Kontos in Tagen (0 = egal) – Schutz vor frisch angelegten Konten */
  minAccountAgeDays: number;
  /** Rolle für alle, die einen Server oder Bot bei uns haben */
  customerRoleId: string;
  /** Rollen, die jedes neue Mitglied beim Betreten automatisch bekommt */
  autoRoleIds: string[];
  /** Kanal, für den der Bot den Einladungslink erstellt (leer = Systemkanal bzw. erster Textkanal) */
  inviteChannelId: string;
  /** Tickets: Rolle des Support-Teams und Kategorie für Ticket-Kanäle (leer = Bot legt „Tickets“ an) */
  supportRoleId: string;
  ticketCategoryId: string;
  /** Höchstzahl offener Tickets je Mitglied */
  maxOpenTickets: number;
  /** Mitglieder können dem Bot per Direktnachricht „!start“ schreiben und ihren Server starten */
  dmStart: boolean;
  /** Status-Meldungen: Der Bot postet Änderungen der Statusseite in einen Kanal (gelbes Embed, Deutsch und Englisch) */
  statusFeed: {
    /** Kanal für die Meldungen (leer = aus) */
    channelId: string;
    /** Rolle, die bei jeder Meldung erwähnt wird (leer = niemand) */
    pingRoleId: string;
    /** Auch Zustandswechsel melden, die die automatischen Prüfungen erkennen (z. B. Panel nicht erreichbar) */
    announceAuto: boolean;
  };
  /** Belohnungen für Einladungen: Wer aktive Nutzer auf den Discord-Server bringt, bekommt zusätzliche Slots */
  inviteRewards: InviteRewardSettings;
  /** Belohnungen für Server-Boosts: zusätzliche Server, solange jemand den Discord-Server boostet */
  boostRewards: BoostRewardSettings;
  /** Honeypot-Kanal zur Bot-Erkennung: Wer dort schreibt, wird automatisch gebannt */
  honeypot: { enabled: boolean; channelId: string };
  /** Social Ping: Der Bot meldet neue Videos hinterlegter Konten in einem Kanal */
  socialPing: SocialPingSettings;
  /** Hinweis auf der Website, warum Discord nötig ist (leer = Standardtext) */
  requiredNote: Localized;
  welcome: DiscordWelcomeSettings;
  rolePanels: DiscordRolePanel[];
}

export const discordLimits = { autoRoles: 20, rolePanels: 8, buttonsPerPanel: 20, maxOpenTickets: 5, rewardTiers: 10, boostTiers: 8, boostSlots: 4, socialAccounts: 10 } as const;

/** Konto, dessen neue Videos der Bot meldet (YouTube-Kanal, TikTok-Profil oder ein beliebiger RSS-/Atom-Feed) */
export interface SocialAccount {
  id: string;
  /** Link, wie er im Admin-Bereich eingegeben wurde */
  url: string;
  /** Feed, den der Bot abfragt – wird beim Hinzufügen aus dem Link ermittelt */
  feedUrl: string;
  /** Anzeigename in der Nachricht */
  name: string;
}

export interface SocialPingSettings {
  enabled: boolean;
  /** Kanal für die Meldungen */
  channelId: string;
  /** Rolle, die bei jeder Meldung erwähnt wird (leer = niemand) */
  pingRoleId: string;
  /** Text der Nachricht. Platzhalter: {name}, {title}, {url} – der Link sorgt für die Vorschau mit Player */
  message: string;
  accounts: SocialAccount[];
}

export const socialPingPlaceholders: [string, string][] = [
  ['{name}', 'Name des Kontos'],
  ['{title}', 'Titel des Videos'],
  ['{url}', 'Link zum Video'],
];

export function defaultSocialPing(): SocialPingSettings {
  return {
    enabled: false,
    channelId: '',
    pingRoleId: '',
    message: '🇩🇪 **{name}** hat ein neues Video hochgeladen!\n🇬🇧 **{name}** just uploaded a new video!\n\n**{title}**\n{url}',
    accounts: [],
  };
}

const httpUrl = (v: unknown): string => {
  if (typeof v !== 'string') return '';
  try {
    const u = new URL(v.trim());
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.toString().slice(0, 500) : '';
  } catch {
    return '';
  }
};

function normalizeSocialPing(input: unknown): SocialPingSettings {
  const i = obj(input);
  const d = defaultSocialPing();
  const used = new Set<string>();
  const accounts = (Array.isArray(i.accounts) ? i.accounts : [])
    .slice(0, discordLimits.socialAccounts)
    .map((raw, index): SocialAccount | null => {
      const a = obj(raw);
      const feedUrl = httpUrl(a.feedUrl);
      if (!feedUrl) return null;
      let id = /^[a-z0-9][a-z0-9-]{0,23}$/.test(String(a.id ?? '')) ? String(a.id) : `konto-${index + 1}`;
      for (let n = 2; used.has(id); n++) id = `${id.replace(/-x\d+$/, '').slice(0, 19)}-x${n}`;
      used.add(id);
      return { id, url: httpUrl(a.url) || feedUrl, feedUrl, name: text(a.name, '', 80).trim() || 'Kanal' };
    })
    .filter((a): a is SocialAccount => a !== null);
  const message = text(i.message, d.message, 1000).trim();
  return {
    enabled: bool(i.enabled, d.enabled),
    channelId: snowflake(i.channelId),
    pingRoleId: snowflake(i.pingRoleId),
    // Ohne Link gäbe es keine Vorschau – dann gilt der Standardtext
    message: message.includes('{url}') ? message : d.message,
    accounts,
  };
}

/** choice = der Nutzer wählt beim Einlösen zwischen Minecraft-Server und Discord-Bot */
export type InviteRewardKind = 'choice' | 'minecraft' | 'discord';

export interface InviteRewardTier {
  /** Bleibt gleich, auch wenn die Stufe geändert wird – so wird jede Stufe nur einmal vergeben */
  id: string;
  /** So viele aktive Eingeladene braucht es */
  invites: number;
  reward: InviteRewardKind;
  /** '' = Slot für jedes Paket · 'smallest' = nur das kleinste Paket des Angebots · sonst die ID eines Pakets */
  planId: string;
}

export interface InviteRewardSettings {
  enabled: boolean;
  /** Kanal, in dem der Bot die Person erwähnt, wenn er ihr keine Direktnachricht schicken kann (leer = keine Meldung) */
  fallbackChannelId: string;
  /** Eine Einladung zählt, wenn der Server der eingeladenen Person in den letzten N Tagen online war */
  activeDays: number;
  /** … und die Person mindestens so viele Tage Mitglied ist (0 = sofort) */
  minMemberDays: number;
  tiers: InviteRewardTier[];
  /** Ankündigung des Belohnungssystems: Kanal und Rolle, die dabei erwähnt wird (beides für den Knopf „Ankündigung senden“) */
  announceChannelId: string;
  announceRoleId: string;
}

/** Zusätzlicher Server als Boost-Belohnung. planId: 'smallest' | 'largest' (kleinstes/größtes Paket des Angebots) oder eine Paket-ID */
export interface BoostRewardSlot {
  kind: ProductKind;
  planId: string;
}

export interface BoostRewardTier {
  /** Ab so vielen Boosts gilt diese Stufe (die höchste erreichte Stufe zählt – Stufen addieren sich nicht) */
  boosts: number;
  slots: BoostRewardSlot[];
}

export interface BoostRewardSettings {
  enabled: boolean;
  tiers: BoostRewardTier[];
}

export function defaultBoostRewards(): BoostRewardSettings {
  const mc = (planId: string): BoostRewardSlot => ({ kind: 'minecraft', planId });
  return {
    enabled: false,
    tiers: [
      { boosts: 1, slots: [mc('smallest')] },
      { boosts: 2, slots: [mc('largest')] },
      { boosts: 3, slots: [mc('largest'), mc('smallest')] },
      { boosts: 4, slots: [mc('largest'), mc('largest')] },
    ],
  };
}

function normalizeBoostRewards(input: unknown): BoostRewardSettings {
  const i = obj(input);
  const d = defaultBoostRewards();
  const seen = new Set<number>();
  const tiers = (Array.isArray(i.tiers) ? i.tiers : d.tiers)
    .slice(0, discordLimits.boostTiers)
    .map((raw): BoostRewardTier | null => {
      const t = obj(raw);
      const boosts = int(t.boosts, 0, 0, 50);
      if (boosts < 1 || seen.has(boosts)) return null;
      const slots = (Array.isArray(t.slots) ? t.slots : [])
        .slice(0, discordLimits.boostSlots)
        .map((s): BoostRewardSlot | null => {
          const o = obj(s);
          const plan = typeof o.planId === 'string' ? o.planId.trim() : '';
          if (plan !== 'smallest' && plan !== 'largest' && !/^[a-z0-9][a-z0-9-]{0,39}$/.test(plan)) return null;
          return { kind: o.kind === 'discord' ? 'discord' : 'minecraft', planId: plan };
        })
        .filter((s): s is BoostRewardSlot => s !== null);
      if (slots.length === 0) return null;
      seen.add(boosts);
      return { boosts, slots };
    })
    .filter((t): t is BoostRewardTier => t !== null)
    .sort((a, b) => a.boosts - b.boosts);
  return { enabled: bool(i.enabled, d.enabled), tiers };
}

/** Die Stufe, die für eine Anzahl Boosts gilt (die höchste erreichte) – null = keine */
export function boostTierFor(cfg: BoostRewardSettings, boosts: number): BoostRewardTier | null {
  if (!cfg.enabled) return null;
  return [...cfg.tiers].reverse().find((t) => boosts >= t.boosts) ?? null;
}

export function defaultInviteRewards(): InviteRewardSettings {
  return {
    enabled: false,
    fallbackChannelId: '',
    activeDays: 7,
    minMemberDays: 0,
    tiers: [
      { id: 'stufe-10', invites: 10, reward: 'choice', planId: '' },
      { id: 'stufe-15', invites: 15, reward: 'discord', planId: 'smallest' },
    ],
    announceChannelId: '',
    announceRoleId: '',
  };
}

function normalizeInviteRewards(input: unknown): InviteRewardSettings {
  const i = obj(input);
  const d = defaultInviteRewards();
  const used = new Set<string>();
  const tiers = (Array.isArray(i.tiers) ? i.tiers : d.tiers)
    .slice(0, discordLimits.rewardTiers)
    .map((raw): InviteRewardTier | null => {
      const t = obj(raw);
      const invites = int(t.invites, 0, 0, 10_000);
      if (invites < 1) return null;
      const reward: InviteRewardKind = t.reward === 'minecraft' || t.reward === 'discord' ? t.reward : 'choice';
      const plan = typeof t.planId === 'string' ? t.planId.trim() : '';
      // Ein bestimmtes Paket passt nur zu einem festen Angebot
      const planId = plan === 'smallest' ? plan : reward !== 'choice' && /^[a-z0-9][a-z0-9-]{0,39}$/.test(plan) ? plan : '';
      let id = /^[a-z0-9][a-z0-9-]{0,23}$/.test(String(t.id ?? '')) ? String(t.id) : `stufe-${invites}`;
      for (let n = 2; used.has(id); n++) id = `${id.replace(/-x\d+$/, '').slice(0, 19)}-x${n}`;
      used.add(id);
      return { id, invites, reward, planId };
    })
    .filter((t): t is InviteRewardTier => t !== null)
    .sort((a, b) => a.invites - b.invites);
  return {
    enabled: bool(i.enabled, d.enabled),
    fallbackChannelId: snowflake(i.fallbackChannelId),
    activeDays: int(i.activeDays, d.activeDays, 1, 90),
    minMemberDays: int(i.minMemberDays, d.minMemberDays, 0, 90),
    tiers,
    announceChannelId: snowflake(i.announceChannelId),
    announceRoleId: snowflake(i.announceRoleId),
  };
}

/** Platzhalter für die Willkommensnachricht */
export const discordWelcomePlaceholders: [string, string][] = [
  ['{user}', 'Name des Mitglieds'],
  ['{mention}', 'Erwähnung des Mitglieds (@Name)'],
  ['{server}', 'Name des Discord-Servers'],
  ['{inviter}', 'Wer eingeladen hat (oder „Vanity / Unknown“)'],
  ['{invites}', 'Anzahl der Einladungen dieser Person'],
  ['{joinDate}', 'Beitrittsdatum'],
  ['{joinTime}', 'Uhrzeit des Beitritts'],
  ['{memberCount}', 'Mitgliederzahl, z. B. 166th'],
];

export function defaultDiscordWelcome(): DiscordWelcomeSettings {
  return {
    enabled: false,
    channelId: '',
    content: 'Welcome to **{server}**!',
    title: 'Welcome to {server}!',
    description: "Welcome to **{server}**, {user}!\nWe're excited to have you on board\n\nInvited By » {inviter} ({invites} invites)\nJoin Date » {joinDate} ({joinTime})\nMembers » {memberCount} member",
    color: '#2563eb',
    showBanner: true,
    fallbackImageUrl: '',
    footer: '{server}',
  };
}

export function defaultDiscordRolePanels(): DiscordRolePanel[] {
  return [
    {
      id: 'roles',
      title: 'Roles',
      text: 'EN: If you want one of the roles listed below, just click on the corresponding button.\n\nDE: Wenn du eine der unten gelisteten Rollen möchtest klicke einfach auf den dazugehörigen Button.',
      exclusive: false,
      buttons: [
        { label: 'News', emoji: '📢', roleId: '' },
        { label: 'Giveaway', emoji: '🎉', roleId: '' },
        { label: 'Spoiler', emoji: '👀', roleId: '' },
        { label: 'Status', emoji: '✅', roleId: '' },
      ],
    },
    {
      id: 'hosting',
      title: 'Hosting',
      text: 'EN: Choose which hosting area you want to see – you can pick one or both.\n\nDE: Wähle aus, welchen Hosting-Bereich du sehen möchtest – du kannst einen oder beide wählen.',
      exclusive: false,
      buttons: [
        { label: 'Free Hosting', emoji: '🆓', roleId: '' },
        { label: 'Paid Hosting', emoji: '💎', roleId: '' },
      ],
    },
  ];
}

export function defaultDiscordSettings(): DiscordSettings {
  return {
    enabled: false,
    required: false,
    notifyByDm: true,
    clientId: '',
    guildId: '',
    autoJoin: true,
    minAccountAgeDays: 0,
    customerRoleId: '',
    autoRoleIds: [],
    inviteChannelId: '',
    supportRoleId: '',
    ticketCategoryId: '',
    maxOpenTickets: 2,
    dmStart: true,
    statusFeed: { channelId: '', pingRoleId: '', announceAuto: true },
    inviteRewards: defaultInviteRewards(),
    boostRewards: defaultBoostRewards(),
    honeypot: { enabled: false, channelId: '' },
    socialPing: defaultSocialPing(),
    requiredNote: { de: '', en: '' },
    welcome: defaultDiscordWelcome(),
    rolePanels: defaultDiscordRolePanels(),
  };
}

/* ------------------------------------------------------------------ Prüfung */

const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const bool = (v: unknown, def: boolean) => (typeof v === 'boolean' ? v : def);
const text = (v: unknown, def: string, max: number) => (typeof v === 'string' ? v.slice(0, max) : def);
/** Discord-IDs (Snowflakes) sind 15–22 Ziffern */
export const isSnowflake = (v: unknown): v is string => typeof v === 'string' && /^\d{15,22}$/.test(v);
const snowflake = (v: unknown) => (isSnowflake(typeof v === 'string' ? v.trim() : v) ? (v as string).trim() : '');
const int = (v: unknown, def: number, min: number, max: number) => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() ? Number(v) : NaN;
  return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : def;
};
const httpsUrl = (v: unknown) => {
  if (typeof v !== 'string' || !v.trim()) return '';
  try {
    const u = new URL(v.trim());
    return u.protocol === 'https:' ? u.toString().slice(0, 500) : '';
  } catch {
    return '';
  }
};

export function normalizeDiscordSettings(input: unknown): DiscordSettings {
  const i = obj(input);
  const d = defaultDiscordSettings();
  const w = obj(i.welcome);
  const note = obj(i.requiredNote);
  const feed = obj(i.statusFeed);

  const usedIds = new Set<string>();
  const rolePanels: DiscordRolePanel[] = (Array.isArray(i.rolePanels) ? i.rolePanels : d.rolePanels)
    .slice(0, discordLimits.rolePanels)
    .map((raw, index): DiscordRolePanel | null => {
      const p = obj(raw);
      const title = text(p.title, '', 100).trim();
      if (!title) return null;
      let id = /^[a-z0-9][a-z0-9-]{0,23}$/.test(String(p.id ?? '')) ? String(p.id) : `panel-${index + 1}`;
      for (let n = 2; usedIds.has(id); n++) id = `${id.replace(/-\d+$/, '').slice(0, 20)}-${n}`;
      usedIds.add(id);
      const buttons = (Array.isArray(p.buttons) ? p.buttons : [])
        .slice(0, discordLimits.buttonsPerPanel)
        .map((b): DiscordRoleButton | null => {
          const o = obj(b);
          const label = text(o.label, '', 60).trim();
          if (!label) return null;
          return { label, emoji: text(o.emoji, '', 16).trim(), roleId: snowflake(o.roleId) };
        })
        .filter((b): b is DiscordRoleButton => b !== null);
      return { id, title, text: text(p.text, '', 1500), exclusive: bool(p.exclusive, false), buttons };
    })
    .filter((p): p is DiscordRolePanel => p !== null);

  return {
    enabled: bool(i.enabled, d.enabled),
    required: bool(i.required, d.required),
    notifyByDm: bool(i.notifyByDm, d.notifyByDm),
    clientId: snowflake(i.clientId),
    guildId: snowflake(i.guildId),
    autoJoin: bool(i.autoJoin, d.autoJoin),
    minAccountAgeDays: int(i.minAccountAgeDays, d.minAccountAgeDays, 0, 3650),
    customerRoleId: snowflake(i.customerRoleId),
    autoRoleIds: [...new Set((Array.isArray(i.autoRoleIds) ? i.autoRoleIds : []).map(snowflake).filter(Boolean))].slice(0, discordLimits.autoRoles),
    inviteChannelId: snowflake(i.inviteChannelId),
    supportRoleId: snowflake(i.supportRoleId),
    ticketCategoryId: snowflake(i.ticketCategoryId),
    maxOpenTickets: int(i.maxOpenTickets, d.maxOpenTickets, 1, discordLimits.maxOpenTickets),
    dmStart: bool(i.dmStart, d.dmStart),
    statusFeed: { channelId: snowflake(feed.channelId), pingRoleId: snowflake(feed.pingRoleId), announceAuto: bool(feed.announceAuto, d.statusFeed.announceAuto) },
    inviteRewards: normalizeInviteRewards(i.inviteRewards),
    boostRewards: normalizeBoostRewards(i.boostRewards),
    honeypot: { enabled: bool(obj(i.honeypot).enabled, false), channelId: snowflake(obj(i.honeypot).channelId) },
    socialPing: normalizeSocialPing(i.socialPing),
    requiredNote: { de: text(note.de, '', 400).trim(), en: text(note.en, '', 400).trim() },
    welcome: {
      enabled: bool(w.enabled, d.welcome.enabled),
      channelId: snowflake(w.channelId),
      content: text(w.content, d.welcome.content, 500),
      title: text(w.title, d.welcome.title, 200),
      description: text(w.description, d.welcome.description, 2000),
      color: typeof w.color === 'string' && /^#[0-9a-f]{6}$/i.test(w.color) ? w.color.toLowerCase() : d.welcome.color,
      showBanner: bool(w.showBanner, d.welcome.showBanner),
      fallbackImageUrl: httpsUrl(w.fallbackImageUrl),
      footer: text(w.footer, d.welcome.footer, 200),
    },
    rolePanels,
  };
}

/** „166th“ – Ordnungszahl auf Englisch (die Willkommensnachricht ist englisch) */
export function ordinalEn(n: number): string {
  const v = Math.abs(n) % 100;
  const suffix = v >= 11 && v <= 13 ? 'th' : (['th', 'st', 'nd', 'rd'][v % 10] ?? 'th');
  return `${n}${suffix}`;
}

/** Ersetzt die Platzhalter der Willkommensnachricht */
export function fillDiscordTemplate(template: string, values: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (all, key: string) => values[key] ?? all);
}

/** Erstellungszeitpunkt eines Discord-Kontos (steckt in der ID) */
export function snowflakeDate(id: string): Date {
  return new Date(Number(BigInt(id) >> 22n) + 1_420_070_400_000);
}
