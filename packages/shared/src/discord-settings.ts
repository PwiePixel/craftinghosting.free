/**
 * Einstellungen der Discord-Anbindung (Admin → Discord). Geheimnisse (Bot-Token, Client-Secret)
 * stehen NICHT hier – sie liegen getrennt und zusätzlich verschlüsselt in der Datenbank.
 */
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
  /** Hinweis auf der Website, warum Discord nötig ist (leer = Standardtext) */
  requiredNote: Localized;
  welcome: DiscordWelcomeSettings;
  rolePanels: DiscordRolePanel[];
}

export const discordLimits = { autoRoles: 20, rolePanels: 8, buttonsPerPanel: 20, maxOpenTickets: 5 } as const;

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
