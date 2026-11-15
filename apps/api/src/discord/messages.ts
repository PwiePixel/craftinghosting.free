/**
 * Nachrichten, die der Bot postet: Rollen-Panel, Ticket-Panel, Willkommensnachricht.
 * Wird vom Bot (Befehle) und vom Admin-Bereich („In Kanal senden“) verwendet.
 */
import { fillDiscordTemplate, ordinalEn, type DiscordRolePanel, type DiscordSettings } from '@chfree/shared';
import { avatarUrl, bannerUrl, type DiscordUser } from './rest';
import type { DiscordState } from './store';

const ROW = 1;
const BUTTON = 2;
const STYLE = { primary: 1, secondary: 2, success: 3, danger: 4 } as const;

export const hexToInt = (hex: string) => parseInt(hex.replace('#', ''), 16) || 0x2563eb;
const BRAND_COLOR = 0x2563eb;

/** Emoji für einen Button: normales Emoji oder eigenes Server-Emoji im Format <:name:id> */
function buttonEmoji(emoji: string): { name: string; id?: string; animated?: boolean } | undefined {
  if (!emoji) return undefined;
  const custom = /^<(a?):(\w+):(\d+)>$/.exec(emoji);
  return custom ? { name: custom[2]!, id: custom[3]!, animated: custom[1] === 'a' } : { name: emoji };
}

/** Fußzeile wie in den Vorlagen: Name des Servers mit Bot- bzw. Server-Symbol */
function footer(state: DiscordState, text?: string) {
  const icon = state.bot?.avatar ? `https://cdn.discordapp.com/avatars/${state.bot.id}/${state.bot.avatar}.png?size=64` : null;
  return { text: text || state.guild?.name || 'CraftingHosting', ...(icon ? { icon_url: icon } : {}) };
}

/** Buttons in Reihen zu je fünf (mehr erlaubt Discord nicht pro Reihe) */
function rows(buttons: unknown[]): unknown[] {
  const out: unknown[] = [];
  for (let i = 0; i < buttons.length && out.length < 5; i += 5) out.push({ type: ROW, components: buttons.slice(i, i + 5) });
  return out;
}

export const roleButtonId = (panelId: string, roleId: string) => `role:${panelId}:${roleId}`;

export function rolePanelMessage(panel: DiscordRolePanel, state: DiscordState) {
  const buttons = panel.buttons
    .filter((b) => b.roleId)
    .map((b) => ({ type: BUTTON, style: STYLE.success, label: b.label.slice(0, 80), custom_id: roleButtonId(panel.id, b.roleId), ...(buttonEmoji(b.emoji) ? { emoji: buttonEmoji(b.emoji) } : {}) }));
  return {
    embeds: [{ title: panel.title, description: panel.text, color: BRAND_COLOR, footer: footer(state) }],
    components: rows(buttons),
  };
}

export const TICKET = { open: 'ticket:open', product: 'ticket:product', create: 'ticket:create', close: 'ticket:close', remove: 'ticket:delete' } as const;

export function ticketPanelMessage(state: DiscordState) {
  return {
    embeds: [
      {
        title: 'Support',
        description:
          'EN: Need help? Click the button below to open a ticket. If your Discord account is linked to your CraftingHosting.free account, you can pick the product it is about – your account and server ID are added automatically.\n\nDE: Du brauchst Hilfe? Klicke auf den Button, um ein Ticket zu öffnen. Ist dein Discord-Konto mit deinem CraftingHosting.free-Account verknüpft, wählst du das betroffene Produkt aus – Account- und Server-ID werden automatisch eingetragen.',
        color: BRAND_COLOR,
        footer: footer(state),
      },
    ],
    components: [{ type: ROW, components: [{ type: BUTTON, style: STYLE.primary, label: 'Ticket erstellen / Create ticket', custom_id: TICKET.open, emoji: { name: '🎫' } }] }],
  };
}

export const closeButton = (label: string) => ({ type: ROW, components: [{ type: BUTTON, style: STYLE.danger, label, custom_id: TICKET.close, emoji: { name: '🔒' } }] });
export const deleteButton = (label: string) => ({ type: ROW, components: [{ type: BUTTON, style: STYLE.danger, label, custom_id: TICKET.remove, emoji: { name: '🗑️' } }] });

export interface WelcomeContext {
  user: DiscordUser;
  /** Wer eingeladen hat (null = unbekannt) und wie viele Einladungen diese Person hat */
  inviter: string | null;
  invites: number;
  memberCount: number | null;
  joinedAt: Date;
}

export function welcomeMessage(settings: DiscordSettings, state: DiscordState, ctx: WelcomeContext) {
  const w = settings.welcome;
  const unix = Math.floor(ctx.joinedAt.getTime() / 1000);
  const values: Record<string, string> = {
    user: ctx.user.username,
    mention: `<@${ctx.user.id}>`,
    server: state.guild?.name || 'CraftingHosting',
    inviter: ctx.inviter ?? 'Vanity / Unknown',
    invites: String(ctx.invites),
    // Discord zeigt Zeitangaben jedem Mitglied in seiner eigenen Zeitzone und Schreibweise
    joinDate: `<t:${unix}:d>`,
    joinTime: `<t:${unix}:t>`,
    memberCount: ctx.memberCount ? ordinalEn(ctx.memberCount) : '?',
  };
  const fill = (template: string) => fillDiscordTemplate(template, values);
  const image = (w.showBanner ? bannerUrl(ctx.user) : null) ?? (w.fallbackImageUrl || null);
  return {
    content: fill(w.content) || undefined,
    embeds: [
      {
        author: { name: fill(w.title).slice(0, 256), icon_url: avatarUrl(ctx.user, 64) },
        description: fill(w.description).slice(0, 4000),
        color: hexToInt(w.color),
        thumbnail: { url: avatarUrl(ctx.user, 256) },
        ...(image ? { image: { url: image } } : {}),
        footer: footer(state, fill(w.footer)),
        timestamp: ctx.joinedAt.toISOString(),
      },
    ],
    allowed_mentions: { users: [ctx.user.id] },
  };
}
