/**
 * Server per Direktnachricht starten: Wer dem Bot „!start“ schreibt, bekommt seine Server als Buttons.
 * Ein Klick startet den Server über die Pterodactyl-API – mit denselben Regeln wie im Panel
 * (Fair-Use-Pausen gelten weiter) und einer Rückmeldung, ob der Start geklappt hat.
 */
import { and, desc, eq, inArray } from 'drizzle-orm';
import { formatDateTime, freeHostingConfig, startBlockMessages, type Localized } from '@chfree/shared';
import { db } from '../db/client';
import { servers, users, type Server, type User } from '../db/schema';
import { env } from '../env';
import { pterodactyl } from '../pterodactyl';
import { audit } from '../services/audit.service';
import { panelServerUrl } from '../services/panel';
import { computeRuntimeState, loadWeekSessions } from '../services/runtime';
import { getSettings } from '../services/settings.service';
import { discordRequest, type DiscordUser } from './rest';
import { botRequest } from './service';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const COLOR = 0x2563eb;

/** Jede Antwort steht auf Deutsch und Englisch untereinander */
const both = (t: Localized) => `🇩🇪 ${t.de}\n🇬🇧 ${t.en}`;
const icon = (s: Pick<Server, 'kind'>) => (s.kind === 'discord' ? '🤖' : '⛏️');
const kindName = (s: Pick<Server, 'kind'>): Localized => (s.kind === 'discord' ? { de: 'Discord-Bot', en: 'Discord bot' } : { de: 'Minecraft-Server', en: 'Minecraft server' });

export const START_PREFIX = 'start:';

/** Erkennt „!start“, „start“, „starte server“, „start server“ */
export const isStartCommand = (content: string) => /^!?\s*(start|starte)(\s+(den\s+|my\s+|meinen\s+)?(server|bot))?\s*[!.]?$/i.test(content.trim());

/** Nicht jede Nachricht beantworten: Hinweis höchstens alle 10 Minuten, Start-Panel höchstens alle 10 Sekunden je Person */
const lastReply = new Map<string, number>();
function throttled(key: string, ms: number): boolean {
  const now = Date.now();
  if (now - (lastReply.get(key) ?? 0) < ms) return true;
  if (lastReply.size > 5000) lastReply.clear();
  lastReply.set(key, now);
  return false;
}

async function accountOf(discordId: string): Promise<{ user: User | null; servers: Server[] }> {
  const [user] = await db.select().from(users).where(eq(users.discordId, discordId)).limit(1);
  if (!user) return { user: null, servers: [] };
  const list = await db
    .select()
    .from(servers)
    .where(and(eq(servers.userId, user.id), inArray(servers.status, ['active', 'expiring', 'suspended', 'provisioning', 'provisioning_failed'])))
    .orderBy(desc(servers.createdAt))
    .limit(10);
  return { user, servers: list };
}

/** Direktnachricht an den Bot */
export async function onDirectMessage(d: { channel_id: string; author: DiscordUser; content?: string; guild_id?: string }): Promise<void> {
  if (d.guild_id || d.author.bot) return; // nur Direktnachrichten von Menschen
  const settings = (await getSettings()).discord;
  if (!settings.enabled || !settings.dmStart) return;
  const send = (json: unknown) => botRequest('POST', `/channels/${d.channel_id}/messages`, { json });

  if (!isStartCommand(d.content ?? '')) {
    if (throttled(`hint:${d.author.id}`, 10 * 60_000)) return;
    return void (await send({
      content: both({
        de: 'Schreibe `!start`, um einen deiner Server zu starten. Alles andere (Stoppen, Konsole, Dateien) machst du im Panel.',
        en: 'Write `!start` to start one of your servers. Everything else (stopping, console, files) is done in the panel.',
      }),
    }));
  }
  if (throttled(`panel:${d.author.id}`, 10_000)) return;

  const { user, servers: list } = await accountOf(d.author.id);
  if (!user) {
    return void (await send({
      content: both({
        de: `Dein Discord-Konto ist noch nicht mit einem CraftingHosting.free-Account verknüpft. Verbinde es unter ${env.APP_URL}/de/meine-server – danach kann ich deine Server starten.`,
        en: `Your Discord account is not linked to a CraftingHosting.free account yet. Connect it at ${env.APP_URL}/my-servers – then I can start your servers.`,
      }),
    }));
  }
  const startable = list.filter((s) => s.status === 'active' && s.pteroIdentifier);
  if (startable.length === 0) {
    return void (await send({
      content: both(
        list.length
          ? { de: `Keiner deiner Server lässt sich gerade starten (z. B. suspendiert oder noch in Einrichtung). Details: ${env.APP_URL}/de/meine-server`, en: `None of your servers can be started right now (for example suspended or still being set up). Details: ${env.APP_URL}/my-servers` }
          : { de: `Zu deinem Account gibt es noch keinen Server. Erstellen: ${env.APP_URL}/de/start`, en: `There is no server on your account yet. Create one: ${env.APP_URL}/start` },
      ),
    }));
  }
  await send({
    embeds: [
      {
        title: 'Server starten · Start server',
        description: `${both({ de: 'Welchen Server möchtest du starten?', en: 'Which server do you want to start?' })}\n\n${startable.map((s) => `${icon(s)} **${s.name}** – ${kindName(s).de} / ${kindName(s).en}`).join('\n')}`,
        color: COLOR,
      },
    ],
    components: [
      {
        type: 1,
        components: startable.slice(0, 5).map((s) => ({ type: 2, style: 3, label: s.name.slice(0, 70), custom_id: `${START_PREFIX}${s.id}`, emoji: { name: icon(s) } })),
      },
    ],
  });
}

interface StartInteraction {
  id: string;
  token: string;
  application_id: string;
  user?: DiscordUser;
  member?: { user?: DiscordUser };
  data?: { custom_id?: string };
}

/** Laufende Starts – ein zweiter Klick auf denselben Server wartet nicht noch einmal */
const starting = new Set<string>();

/** Klick auf einen Server-Button */
export async function onStartButton(i: StartInteraction): Promise<void> {
  const discordUser = i.user ?? i.member?.user;
  const serverId = i.data?.custom_id?.slice(START_PREFIX.length);
  if (!discordUser || !serverId) return;
  // Aufgeschobene Antwort: Der Start dauert länger als die drei Sekunden, die Discord für eine Antwort lässt
  await discordRequest('POST', `/interactions/${i.id}/${i.token}/callback`, { json: { type: 5 } });
  const say = (text: Localized, extra: Record<string, unknown> = {}) =>
    discordRequest('PATCH', `/webhooks/${i.application_id}/${i.token}/messages/@original`, { json: { content: both(text), allowed_mentions: { parse: [] }, ...extra } }).catch(() => null);

  const { user, servers: list } = await accountOf(discordUser.id);
  // Der Server muss zu genau diesem Discord-Konto gehören
  const server = list.find((s) => s.id === serverId);
  if (!user || !server) return void (await say({ de: '❌ Diesen Server finde ich bei deinem Account nicht (mehr).', en: '❌ I cannot find this server on your account (any more).' }));
  const name = `**${server.name}**`;
  const panel = panelServerUrl(server);
  const panelHint: Localized = panel ? { de: ` Panel: ${panel}`, en: ` Panel: ${panel}` } : { de: '', en: '' };
  const withPanel = (t: Localized): Localized => ({ de: t.de + panelHint.de, en: t.en + panelHint.en });

  if (server.status !== 'active' || !server.pteroIdentifier) {
    return void (await say({
      de: `❌ ${name} lässt sich gerade nicht starten (Status: ${server.status}). Details unter ${env.APP_URL}/de/meine-server`,
      en: `❌ ${name} cannot be started right now (status: ${server.status}). Details at ${env.APP_URL}/my-servers`,
    }));
  }
  if (starting.has(server.id)) return void (await say({ de: `⏳ ${name} wird bereits gestartet – einen Moment noch.`, en: `⏳ ${name} is already being started – one moment.` }));

  const ptero = pterodactyl();
  try {
    // Aktuellen Zustand direkt aus dem Panel lesen – nicht aus dem (bis zu eine Minute alten) Stand der Datenbank
    const before = await ptero.getResources(server.pteroIdentifier);
    if (before.isSuspended) return void (await say({ de: `❌ ${name} ist gesperrt und kann nicht gestartet werden.`, en: `❌ ${name} is suspended and cannot be started.` }));
    if (before.state === 'running') return void (await say({ de: `✅ ${name} ist schon online – ich muss ihn nicht starten.`, en: `✅ ${name} is already online – there is nothing to start.` }));
    if (before.state === 'installing') return void (await say({ de: `⏳ ${name} wird gerade installiert. Bitte versuche es in ein paar Minuten erneut.`, en: `⏳ ${name} is being installed. Please try again in a few minutes.` }));
    if (before.state === 'stopping') return void (await say({ de: `⏳ ${name} wird gerade gestoppt. Bitte warte kurz und versuche es dann erneut.`, en: `⏳ ${name} is stopping right now. Please wait a moment and try again.` }));

    // Fair-Use: Während einer Pause darf der Server nicht gestartet werden (sonst würde ihn das System gleich wieder stoppen)
    const now = new Date();
    const settings = await getSettings();
    const state = computeRuntimeState({ ...server, powerState: before.state }, user, await loadWeekSessions(server.id, now), now, settings.products[server.kind].fairUse);
    if (!state.startGate.allowed && state.startGate.reason !== 'already_online') {
      const why = startBlockMessages[state.startGate.reason ?? 'not_active'];
      const until = state.startGate.until;
      const tz = freeHostingConfig.fairUse.timezone;
      return void (await say({
        de: `⏸️ ${name} kann gerade nicht gestartet werden: ${why.de}${until ? ` Wieder möglich ab ${formatDateTime(until, tz, 'de')}.` : ''}`,
        en: `⏸️ ${name} cannot be started right now: ${why.en}${until ? ` Possible again from ${formatDateTime(until, tz, 'en')}.` : ''}`,
      }));
    }

    starting.add(server.id);
    if (before.state !== 'starting') await ptero.sendPowerSignal(server.pteroIdentifier, 'start');
    await audit({ userId: user.id, serverId: server.id, actor: 'user', action: 'discord.server_start', message: `Server „${server.name}“ per Discord-Nachricht gestartet` });
    await say({ de: `⏳ ${name} wird gestartet …`, en: `⏳ Starting ${name} …` });

    // Bis zu 90 Sekunden beobachten, ob der Server wirklich hochkommt
    let sawStarting = before.state === 'starting';
    for (let n = 0; n < 18; n++) {
      await sleep(5000);
      const res = await ptero.getResources(server.pteroIdentifier);
      if (res.state === 'running') return void (await say({ de: `✅ ${name} ist online.`, en: `✅ ${name} is online.` }));
      if (res.state === 'starting') sawStarting = true;
      // Wieder offline, nachdem er hochfahren wollte – oder nach 20 Sekunden gar nicht erst losgelaufen
      if (res.state === 'offline' && (sawStarting || n >= 3)) {
        return void (await say(
          withPanel({
            de: `❌ ${name} startet nicht – er ist beim Hochfahren wieder ausgegangen. Bitte sieh im Panel in der Konsole nach, dort steht der Grund.`,
            en: `❌ ${name} does not start – it went offline again while booting. Please check the console in the panel, the reason is shown there.`,
          }),
        ));
      }
    }
    await say(
      withPanel({
        de: `⏳ ${name} fährt noch hoch – das dauert länger als üblich. Bitte sieh im Panel nach, ob er startet.`,
        en: `⏳ ${name} is still booting – this is taking longer than usual. Please check in the panel whether it starts.`,
      }),
    );
  } catch {
    await say(
      withPanel({
        de: `❌ Ich erreiche das Panel gerade nicht und konnte ${name} nicht starten. Bitte versuche es gleich noch einmal oder starte ihn direkt im Panel.`,
        en: `❌ I cannot reach the panel right now and could not start ${name}. Please try again shortly or start it directly in the panel.`,
      }),
    );
  } finally {
    starting.delete(server.id);
  }
}
