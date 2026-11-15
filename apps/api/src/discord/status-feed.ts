/**
 * Status-Meldungen im Discord: Ändert sich etwas an der Statusseite, postet der Bot ein gelbes Embed
 * auf Deutsch und Englisch in den eingestellten Kanal (Admin → Discord → Status-Meldungen).
 *
 * Gemeldet wird:
 *  – eine neue Meldung (Störung, Wartung, Hinweis) – auch eine für die Zukunft angekündigte Wartung
 *  – der Beginn einer angekündigten Wartung, jede Änderung an einer Meldung und ihr Ende
 *  – der Wartungsmodus der Website (an/aus)
 *  – Zustandswechsel einzelner Komponenten: von Hand gesetzte sofort, automatisch gemessene erst,
 *    wenn zwei Messungen hintereinander (5 Minuten Abstand) dasselbe zeigen – das verhindert Fehlalarme
 *
 * Der zuletzt gemeldete Stand liegt in der Datenbank; so wird jede Änderung genau einmal gepostet,
 * auch wenn API und Worker gleichzeitig laufen oder der Dienst neu startet.
 */
import { randomUUID } from 'node:crypto';
import { localePath, statusCategory, type Localized, type SiteSettings, type StatusCategory, type StatusDTO, type StatusIncidentDTO } from '@chfree/shared';
import { env } from '../env';
import { acquireLease, releaseLease } from '../jobs/lock';
import { getSettings } from '../services/settings.service';
import { getStatusOverview } from '../services/status.service';
import { discordErrorText } from './rest';
import { botRequest, discordConfig } from './service';
import { emptyStatusFeedState, getStatusFeedState, patchDiscordState, saveStatusFeedState, type StatusFeedState } from './store';

/** Gelb – die Farbe aller Status-Meldungen */
const YELLOW = 0xfacc15;
// Eigener Name: Der gleichnamige Job hält bereits die Sperre „discord-status-feed“
const LEASE = 'discord-status-feed-sync';
const OWNER = randomUUID();
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

type Embed = Record<string, unknown>;

const statusUrl = () => `${env.APP_URL}${localePath('en', 'status')}`;
const cut = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);
const stamp = (iso: string) => `<t:${Math.floor(Date.parse(iso) / 1000)}:F>`;
const relative = (iso: string) => `<t:${Math.floor(Date.parse(iso) / 1000)}:R>`;

/** Deutsch und Englisch untereinander – mit Flagge davor */
function bilingual(de: string, en: string): string {
  return `🇩🇪 ${de}\n\n🇬🇧 ${en}`;
}

function embed(title: string, description: string, fields: { name: string; value: string; inline?: boolean }[] = []): Embed {
  return {
    title: cut(title, 250),
    url: statusUrl(),
    description: cut(description, 4000),
    color: YELLOW,
    fields: fields.filter((f) => f.value).map((f) => ({ ...f, value: cut(f.value, 1000) })),
    footer: { text: 'CraftingHosting.free · Status' },
    timestamp: new Date().toISOString(),
  };
}

const KIND: Record<StatusIncidentDTO['kind'], Localized> = {
  incident: { de: 'Störung', en: 'Incident' },
  maintenance: { de: 'Wartungsarbeiten', en: 'Maintenance' },
  notice: { de: 'Hinweis', en: 'Notice' },
};

type IncidentEvent = 'new' | 'scheduled' | 'started' | 'updated' | 'resolved';

function incidentTitle(i: StatusIncidentDTO, event: IncidentEvent): string {
  const k = KIND[i.kind];
  switch (event) {
    case 'scheduled':
      return i.kind === 'maintenance' ? '🗓️ Wartungsarbeiten angekündigt · Maintenance announced' : `🗓️ ${k.de} angekündigt · ${k.en} announced`;
    case 'started':
      return i.kind === 'maintenance' ? '🔧 Wartungsarbeiten haben begonnen · Maintenance has started' : `📢 ${k.de} · ${k.en}`;
    case 'updated':
      return `✏️ Aktualisiert: ${k.de} · Updated: ${k.en}`;
    case 'resolved':
      return i.kind === 'maintenance' ? '✅ Wartungsarbeiten abgeschlossen · Maintenance completed' : i.kind === 'incident' ? '✅ Störung behoben · Incident resolved' : '✅ Hinweis beendet · Notice ended';
    case 'new':
      return i.kind === 'maintenance' ? '🔧 Wartungsarbeiten · Maintenance' : i.kind === 'incident' ? '🚨 Störung · Incident' : 'ℹ️ Hinweis · Notice';
  }
}

function incidentEmbed(i: StatusIncidentDTO, event: IncidentEvent, status: StatusDTO): Embed {
  const part = (lang: 'de' | 'en') => `**${cut(i.title[lang], 200)}**${i.message[lang] ? `\n${cut(i.message[lang], 1400)}` : ''}`;
  const affected = status.components.filter((c) => i.components.includes(c.id));
  const names = (lang: 'de' | 'en') => affected.map((c) => c.name[lang]).join(', ');
  const impact = i.impact === 'operational' ? null : status.page.labels[statusCategory(i.impact) as StatusCategory];
  const fields = [
    { name: 'Beginn · Start', value: `${stamp(i.startsAt)}${event === 'scheduled' ? ` (${relative(i.startsAt)})` : ''}`, inline: true },
    { name: event === 'resolved' ? 'Beendet · Ended' : 'Voraussichtliches Ende · Expected end', value: event === 'resolved' ? stamp(i.resolvedAt ?? i.endsAt ?? new Date().toISOString()) : i.endsAt ? stamp(i.endsAt) : '', inline: true },
    { name: 'Betroffen · Affected', value: affected.length ? (names('de') === names('en') ? names('de') : `${names('de')}\n${names('en')}`) : '' },
    { name: 'Auswirkung · Impact', value: impact && event !== 'resolved' ? (impact.de === impact.en ? impact.de : `${impact.de} · ${impact.en}`) : '' },
  ];
  return embed(incidentTitle(i, event), bilingual(part('de'), part('en')), fields);
}

function maintenanceEmbed(settings: SiteSettings): Embed {
  const m = settings.maintenance;
  if (!m.enabled) {
    return embed(
      '✅ Wartungsmodus beendet · Maintenance mode ended',
      bilingual('Die Wartungsarbeiten an der Website sind abgeschlossen. Erstellen, Reaktivieren und Löschen von Servern funktionieren wieder.', 'Maintenance on the website is complete. Creating, reactivating and deleting servers works again.'),
    );
  }
  const de = m.message.de || 'Wir führen gerade Wartungsarbeiten an der Website durch. Erstellen, Reaktivieren und Löschen von Servern sind solange pausiert – laufende Server und das Panel sind nicht betroffen.';
  const en = m.message.en || 'We are currently carrying out maintenance on the website. Creating, reactivating and deleting servers is paused meanwhile – running servers and the panel are not affected.';
  return embed('🔧 Wartungsmodus aktiv · Maintenance mode active', bilingual(cut(de, 1500), cut(en, 1500)), [{ name: 'Voraussichtliches Ende · Expected end', value: m.until ? stamp(m.until) : '' }]);
}

interface ComponentChange {
  name: Localized;
  from: StatusCategory;
  to: StatusCategory;
}

function componentsEmbed(changes: ComponentChange[], status: StatusDTO): Embed {
  const labels = status.page.labels;
  const lines = (lang: 'de' | 'en') => changes.map((c) => `**${c.name[lang]}**: ${labels[c.from][lang]} → ${labels[c.to][lang]}`).join('\n');
  const allFine = changes.every((c) => c.to === 'operational');
  return embed(allFine ? '✅ Status-Update: wieder betriebsbereit · Status update: operational again' : '📊 Status-Update · Status update', bilingual(lines('de'), lines('en')));
}

async function post(channelId: string, pingRoleId: string, embeds: Embed[]): Promise<void> {
  const body = { ...(pingRoleId ? { content: `<@&${pingRoleId}>` } : {}), embeds, allowed_mentions: { parse: [], roles: pingRoleId ? [pingRoleId] : [] } };
  try {
    await botRequest('POST', `/channels/${channelId}/messages`, { json: body });
  } catch {
    // Einmal wiederholen – ein kurzer Aussetzer bei Discord soll keine Wartungsankündigung verschlucken
    await sleep(2000);
    await botRequest('POST', `/channels/${channelId}/messages`, { json: body });
  }
}

/** Testnachricht aus dem Admin-Bereich – wirft bei einem Fehler */
export async function sendStatusFeedTest(channelId: string, pingRoleId: string): Promise<void> {
  await post(channelId, pingRoleId, [
    embed(
      '🧪 Test der Status-Meldungen · Status feed test',
      bilingual('Hier erscheinen künftig Meldungen zur Statusseite: Störungen, angekündigte und laufende Wartungsarbeiten und Entwarnungen.', 'Updates from the status page will appear here: incidents, announced and ongoing maintenance, and all-clear messages.'),
    ),
  ]);
}

/**
 * Gleicht den aktuellen Stand der Statusseite mit dem zuletzt gemeldeten ab und postet die Unterschiede.
 * `snapshot` = Aufruf direkt nach einer neuen Messung (alle 5 Minuten): Nur diese Läufe zählen für die
 * Bestätigung automatisch erkannter Zustandswechsel.
 */
export async function syncStatusFeed(opts: { snapshot?: boolean } = {}): Promise<{ posted: number }> {
  if (env.BETA_MODE) return { posted: 0 };
  const cfg = await discordConfig();
  const feed = cfg.settings.statusFeed;
  if (!cfg.botReady || !feed.channelId) {
    // Ausgeschaltet: Stand vergessen – beim Wiedereinschalten wird nichts Altes nachgemeldet
    const old = await getStatusFeedState();
    if (old.initialized) await saveStatusFeedState(emptyStatusFeedState());
    return { posted: 0 };
  }
  if (!(await acquireLease(LEASE, OWNER, 60_000))) return { posted: 0 };
  try {
    const [settings, status, prev] = await Promise.all([getSettings(), getStatusOverview(), getStatusFeedState()]);
    const next: StatusFeedState = { initialized: true, maintenance: settings.maintenance.enabled, incidents: {}, components: {} };
    const embeds: Embed[] = [];
    const first = !prev.initialized;

    // 1) Wartungsmodus der Website
    if (!first && prev.maintenance !== settings.maintenance.enabled) embeds.push(maintenanceEmbed(settings));

    // 2) Meldungen (Störung, Wartung, Hinweis)
    for (const i of status.incidents) {
      next.incidents[i.id] = { state: i.state, updatedAt: i.updatedAt };
      if (first) continue;
      const before = prev.incidents[i.id];
      if (!before) {
        // Bereits beendete Einträge (z. B. nachträglich angelegt) werden nicht gemeldet
        if (i.state !== 'resolved') embeds.push(incidentEmbed(i, i.state === 'scheduled' ? 'scheduled' : 'new', status));
      } else if (before.state !== i.state) {
        embeds.push(incidentEmbed(i, i.state === 'resolved' ? 'resolved' : i.state === 'active' ? 'started' : 'scheduled', status));
      } else if (before.updatedAt !== i.updatedAt && i.state !== 'resolved') {
        embeds.push(incidentEmbed(i, 'updated', status));
      }
    }

    // 3) Zustand der einzelnen Komponenten
    const active = status.incidents.filter((i) => i.state === 'active' && i.impact !== 'operational');
    const changes: ComponentChange[] = [];
    for (const c of status.components) {
      const now = statusCategory(c.status);
      const before = prev.components[c.id];
      if (now === 'none') {
        // Prüfung gerade nicht möglich – den bisherigen Stand behalten
        if (before) next.components[c.id] = before;
        continue;
      }
      if (first || !before) {
        next.components[c.id] = { announced: now };
        continue;
      }
      if (before.announced === now) {
        next.components[c.id] = { announced: now, covered: before.covered };
        continue;
      }
      // Schon erklärt: durch eine laufende Meldung, den Wartungsmodus – oder es ist die Entwarnung danach
      const covered = active.some((i) => i.components.includes(c.id)) || (settings.maintenance.enabled && now === 'maintenance');
      if (covered || (before.covered && now === 'operational') || !feed.announceAuto) {
        next.components[c.id] = { announced: now, covered: covered || undefined };
        continue;
      }
      const manual = (settings.status.overrides[c.id] ?? 'auto') !== 'auto';
      const seen = before.pending === now ? (before.seen ?? 0) + (opts.snapshot ? 1 : 0) : opts.snapshot ? 1 : 0;
      if (manual || seen >= 2) {
        changes.push({ name: c.name, from: before.announced as StatusCategory, to: now });
        next.components[c.id] = { announced: now };
      } else {
        next.components[c.id] = { announced: before.announced, covered: before.covered, pending: now, seen };
      }
    }
    if (changes.length) embeds.push(componentsEmbed(changes, status));

    // Erst merken, dann posten: Lieber geht im Fehlerfall eine Meldung verloren, als dass sie mehrfach erscheint
    await saveStatusFeedState(next);
    if (embeds.length === 0) return { posted: 0 };
    try {
      // Discord erlaubt 10 Embeds je Nachricht – mehr als ein paar entstehen hier nie
      for (let n = 0; n < embeds.length; n += 5) await post(feed.channelId, n === 0 ? feed.pingRoleId : '', embeds.slice(n, n + 5));
      await patchDiscordState({ statusFeedError: null }).catch(() => {});
      return { posted: embeds.length };
    } catch (err) {
      await patchDiscordState({ statusFeedError: { at: new Date().toISOString(), message: discordErrorText(err) } }).catch(() => {});
      return { posted: 0 };
    }
  } finally {
    await releaseLease(LEASE, OWNER).catch(() => {});
  }
}

/** Nach einer Änderung im Admin-Bereich: gleich abgleichen, ohne die Antwort an den Browser aufzuhalten */
export function syncStatusFeedSoon(): void {
  setTimeout(() => void syncStatusFeed().catch(() => {}), 500);
}
