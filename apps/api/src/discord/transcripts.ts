/**
 * Ticket-Transkripte: Beim Schließen (spätestens beim Löschen) eines Tickets liest der Bot den kompletten Verlauf des
 * Ticket-Kanals und schickt ihn als .txt-Datei in den Transkript-Kanal aus dem Admin-Bereich (Discord → Tickets).
 * Nur für die interne Aufbewahrung – der Kanal sollte nur für das Team sichtbar sein.
 */
import { and, eq, isNull } from 'drizzle-orm';
import { formatDateTime, freeHostingConfig, type DiscordSettings } from '@chfree/shared';
import { affectedRows, db } from '../db/client';
import { discordTickets, servers, users } from '../db/schema';

type DiscordTicket = typeof discordTickets.$inferSelect;
import { audit } from '../services/audit.service';
import { botRequest } from './service';

interface Msg {
  id: string;
  content: string;
  timestamp: string;
  edited_timestamp?: string | null;
  author: { id: string; username: string; global_name?: string | null; bot?: boolean };
  attachments?: { filename: string; url: string; size: number }[];
  embeds?: { title?: string; description?: string; fields?: { name: string; value: string }[]; footer?: { text?: string } }[];
  sticker_items?: { name: string }[];
}

/** Höchstens so viele Nachrichten je Transkript (100 je Abfrage) – schützt vor endlosen Abfragen bei riesigen Kanälen */
const MAX_MESSAGES = 5000;
/** Discord nimmt ohne Boost höchstens 10 MB je Datei an */
const MAX_BYTES = 9 * 1024 * 1024;

const tz = () => freeHostingConfig.fairUse.timezone;
const stamp = (iso: string) => {
  const d = new Date(iso);
  return `${formatDateTime(d, tz(), 'de')}:${String(d.getSeconds()).padStart(2, '0')}`;
};
const who = (a: Msg['author']) => `${a.global_name || a.username}${a.global_name && a.global_name !== a.username ? ` (@${a.username})` : ''}${a.bot ? ' [Bot]' : ''} <${a.id}>`;

/** Alle Nachrichten eines Kanals, älteste zuerst */
async function readChannel(channelId: string): Promise<{ messages: Msg[]; truncated: boolean }> {
  const out: Msg[] = [];
  let before: string | null = null;
  while (out.length < MAX_MESSAGES) {
    const page: Msg[] = await botRequest<Msg[]>('GET', `/channels/${channelId}/messages?limit=100${before ? `&before=${before}` : ''}`);
    if (!page.length) break;
    out.push(...page);
    before = page[page.length - 1]!.id;
    if (page.length < 100) break;
  }
  return { messages: out.reverse(), truncated: out.length >= MAX_MESSAGES };
}

/** Transkript als Text (UTF-8) */
export function formatTranscript(input: {
  ticket: Pick<DiscordTicket, 'id' | 'discordUserId' | 'subject' | 'createdAt' | 'closedAt'>;
  account: { email: string; id: string } | null;
  server: { id: string; name: string } | null;
  closedBy: string | null;
  messages: Msg[];
  truncated: boolean;
}): string {
  const t = input.ticket;
  const lines: string[] = [
    `Ticket #${String(t.id).padStart(4, '0')} – CraftingHosting.free`,
    '='.repeat(60),
    `Ersteller (Discord):  <${t.discordUserId}>`,
    `Konto:                ${input.account ? `${input.account.email} (${input.account.id})` : '–'}`,
    `Server:               ${input.server ? `${input.server.name} (${input.server.id})` : '–'}`,
    `Betreff:              ${t.subject || '–'}`,
    `Geöffnet:             ${formatDateTime(t.createdAt, tz(), 'de')}`,
    `Geschlossen:          ${t.closedAt ? formatDateTime(t.closedAt, tz(), 'de') : '–'}${input.closedBy ? ` von <${input.closedBy}>` : ''}`,
    `Nachrichten:          ${input.messages.length}${input.truncated ? ` (gekürzt auf die letzten ${MAX_MESSAGES})` : ''}`,
    `Erstellt:             ${formatDateTime(new Date(), tz(), 'de')} (Zeitzone ${tz()})`,
    '='.repeat(60),
    '',
  ];
  // Erwähnungen <@id> lesbar machen (Name, soweit die Person im Ticket geschrieben hat; die ID bleibt dabei)
  const names = new Map(input.messages.map((m) => [m.author.id, m.author.global_name || m.author.username]));
  const readable = (text: string) => text.replace(/<@!?(\d{5,25})>/g, (all, id: string) => (names.has(id) ? `@${names.get(id)} <${id}>` : all));
  for (const m of input.messages) {
    lines.push(`[${stamp(m.timestamp)}] ${who(m.author)}${m.edited_timestamp ? ' (bearbeitet)' : ''}`);
    if (m.content) for (const l of readable(m.content).split('\n')) lines.push(`  ${l}`);
    for (const e of m.embeds ?? []) {
      if (e.title) lines.push(`  ▌ ${e.title}`);
      if (e.description) for (const l of e.description.split('\n')) lines.push(`  ▌ ${l}`);
      for (const f of e.fields ?? []) lines.push(`  ▌ ${f.name}: ${f.value.replace(/\n/g, ' ')}`);
      if (e.footer?.text) lines.push(`  ▌ (${e.footer.text})`);
    }
    for (const a of m.attachments ?? []) lines.push(`  📎 ${a.filename} (${Math.ceil(a.size / 1024)} KB): ${a.url}`);
    for (const s of m.sticker_items ?? []) lines.push(`  [Sticker: ${s.name}]`);
    lines.push('');
  }
  return lines.join('\n');
}

/**
 * Transkript eines Tickets erstellen und in den Transkript-Kanal schicken – genau einmal je Ticket (beim Schließen,
 * sonst beim Löschen). Ohne eingestellten Kanal passiert nichts. Fehler werden protokolliert, nicht weitergegeben:
 * Das Schließen bzw. Löschen des Tickets darf daran nicht scheitern.
 */
export async function sendTicketTranscript(ticket: DiscordTicket, settings: DiscordSettings, closedBy: string | null): Promise<'sent' | 'skipped' | 'failed'> {
  const target = settings.ticketTranscriptChannelId;
  if (!target || !ticket.channelId || ticket.transcriptAt) return 'skipped';
  // Gleichzeitig Schließen und Löschen: nur einer schickt
  const claim = await db.update(discordTickets).set({ transcriptAt: new Date() }).where(and(eq(discordTickets.id, ticket.id), isNull(discordTickets.transcriptAt)));
  if (affectedRows(claim) !== 1) return 'skipped';
  try {
    const { messages, truncated } = await readChannel(ticket.channelId);
    const [account] = ticket.userId ? await db.select({ id: users.id, email: users.email }).from(users).where(eq(users.id, ticket.userId)).limit(1) : [];
    const [server] = ticket.serverId ? await db.select({ id: servers.id, name: servers.name }).from(servers).where(eq(servers.id, ticket.serverId)).limit(1) : [];
    let text = formatTranscript({ ticket, account: account ?? null, server: server ?? null, closedBy, messages, truncated });
    if (Buffer.byteLength(text) > MAX_BYTES) text = `${text.slice(0, MAX_BYTES - 200)}\n\n[… gekürzt: Das Transkript war größer als 9 MB]\n`;
    const number = String(ticket.id).padStart(4, '0');
    const date = new Date().toISOString().slice(0, 10);
    await botRequest('POST', `/channels/${target}/messages`, {
      json: {
        content: `📄 Transkript Ticket #${number} · Ersteller <@${ticket.discordUserId}>${account ? ` · ${account.email}` : ''} · ${messages.length} Nachrichten`,
        allowed_mentions: { parse: [] },
      },
      files: [{ name: `ticket-${number}-${date}.txt`, content: text, contentType: 'text/plain; charset=utf-8' }],
    });
    await audit({ userId: ticket.userId, actor: 'system', action: 'discord.ticket_transcript', message: `Transkript von Ticket #${number} gespeichert (${messages.length} Nachrichten)` });
    return 'sent';
  } catch (err) {
    // Nicht gesendet: wieder freigeben, damit es beim Löschen erneut versucht wird
    await db.update(discordTickets).set({ transcriptAt: null }).where(eq(discordTickets.id, ticket.id));
    await audit({ userId: ticket.userId, actor: 'system', action: 'discord.ticket_transcript_failed', message: `Transkript von Ticket #${String(ticket.id).padStart(4, '0')} konnte nicht gesendet werden: ${String((err as Error).message ?? err).slice(0, 200)}` });
    return 'failed';
  }
}
