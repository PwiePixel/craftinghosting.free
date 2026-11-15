/**
 * Server per Direktnachricht steuern: Wer dem Bot „!start“, „!stop“ oder „!restart“ schreibt, bekommt seine
 * Server als Buttons. Ein Klick führt die Aktion über die Pterodactyl-API aus – mit denselben Regeln wie im
 * Panel (Fair-Use-Pausen gelten weiter) und einer Rückmeldung, ob es geklappt hat.
 *
 * Minecraft-EULA: Ist sie für einen Server noch nicht akzeptiert, startet er nicht. Der Bot sagt das, zeigt
 * einen Button zur Bestätigung, trägt die Zustimmung in eula.txt ein und startet den Server danach sauber.
 */
import { and, desc, eq, inArray } from 'drizzle-orm';
import { formatDateTime, freeHostingConfig, startBlockMessages, type Localized } from '@chfree/shared';
import { db } from '../db/client';
import { servers, users, type Server, type User } from '../db/schema';
import { env } from '../env';
import { pterodactyl } from '../pterodactyl';
import type { PterodactylGateway } from '../pterodactyl/types';
import { audit } from '../services/audit.service';
import { panelServerUrl } from '../services/panel';
import { computeRuntimeState, loadWeekSessions } from '../services/runtime';
import { getSettings } from '../services/settings.service';
import { discordRequest, type DiscordUser } from './rest';
import { botRequest } from './service';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const COLOR = 0x2563eb;
const EULA_URL = 'https://www.minecraft.net/eula';

/** Jede Antwort steht auf Deutsch und Englisch untereinander */
const both = (t: Localized) => `🇩🇪 ${t.de}\n🇬🇧 ${t.en}`;
const icon = (s: Pick<Server, 'kind'>) => (s.kind === 'discord' ? '🤖' : '⛏️');
const kindName = (s: Pick<Server, 'kind'>): Localized => (s.kind === 'discord' ? { de: 'Discord-Bot', en: 'Discord bot' } : { de: 'Minecraft-Server', en: 'Minecraft server' });

export type PowerCommand = 'start' | 'stop' | 'restart';
type ButtonKind = PowerCommand | 'eula';

const COMMANDS: Record<PowerCommand, { words: string; title: string; question: Localized; style: number }> = {
  start: { words: 'start|starte|starten', title: 'Server starten · Start server', question: { de: 'Welchen Server möchtest du starten?', en: 'Which server do you want to start?' }, style: 3 },
  stop: { words: 'stop|stopp|stoppe|stoppen', title: 'Server stoppen · Stop server', question: { de: 'Welchen Server möchtest du stoppen?', en: 'Which server do you want to stop?' }, style: 4 },
  restart: { words: 'restart|neustart|neustarten|reboot', title: 'Server neu starten · Restart server', question: { de: 'Welchen Server möchtest du neu starten?', en: 'Which server do you want to restart?' }, style: 1 },
};

/** Erkennt „!start“, „!stop“, „!restart“ – auch ohne Ausrufezeichen und als „starte server“, „stop bot“, „neustart“ … */
export function parsePowerCommand(content: string): PowerCommand | null {
  const text = content.trim();
  for (const command of ['restart', 'start', 'stop'] as const) {
    if (new RegExp(`^!?\\s*(${COMMANDS[command].words})(\\s+(den\\s+|my\\s+|meinen\\s+)?(server|bot))?\\s*[!.]?$`, 'i').test(text)) return command;
  }
  return null;
}

/** Buttons dieses Moduls: start:<Server>, stop:<Server>, restart:<Server>, eula:<Server> */
const BUTTON = /^(start|stop|restart|eula):([0-9a-f-]{36})(?::en)?$/i;
export const isPowerButton = (customId: string | undefined) => !!customId && BUTTON.test(customId);

/** Nicht jede Nachricht beantworten: Hinweis höchstens alle 10 Minuten, Auswahl höchstens alle 10 Sekunden je Person und Befehl */
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

  const command = parsePowerCommand(d.content ?? '');
  if (!command) {
    if (throttled(`hint:${d.author.id}`, 10 * 60_000)) return;
    const rewards = settings.inviteRewards.enabled || settings.boostRewards.enabled;
    return void (await send({
      content: both({
        de: `Schreibe \`!start\`, \`!stop\` oder \`!restart\`, um einen deiner Server zu starten, zu stoppen oder neu zu starten.${rewards ? ' Mit `!rewards` siehst du deine Belohnungen für Einladungen und Boosts.' : ''} Alles andere (Konsole, Dateien, Backups) machst du im Panel.`,
        en: `Write \`!start\`, \`!stop\` or \`!restart\` to start, stop or restart one of your servers.${rewards ? ' Use `!rewards` to see your rewards for invites and boosts.' : ''} Everything else (console, files, backups) is done in the panel.`,
      }),
    }));
  }
  if (throttled(`panel:${command}:${d.author.id}`, 10_000)) return;

  const { user, servers: list } = await accountOf(d.author.id);
  if (!user) {
    return void (await send({
      content: both({
        de: `Dein Discord-Konto ist noch nicht mit einem CraftingHosting.free-Account verknüpft. Verbinde es unter ${env.APP_URL}/de/meine-server – danach kann ich deine Server steuern.`,
        en: `Your Discord account is not linked to a CraftingHosting.free account yet. Connect it at ${env.APP_URL}/my-servers – then I can control your servers.`,
      }),
    }));
  }
  const usable = list.filter((s) => s.status === 'active' && s.pteroIdentifier);
  if (usable.length === 0) {
    return void (await send({
      content: both(
        list.length
          ? { de: `Keiner deiner Server lässt sich gerade steuern (z. B. suspendiert oder noch in Einrichtung). Details: ${env.APP_URL}/de/meine-server`, en: `None of your servers can be controlled right now (for example suspended or still being set up). Details: ${env.APP_URL}/my-servers` }
          : { de: `Zu deinem Account gibt es noch keinen Server. Erstellen: ${env.APP_URL}/de/start`, en: `There is no server on your account yet. Create one: ${env.APP_URL}/start` },
      ),
    }));
  }
  const c = COMMANDS[command];
  await send({
    embeds: [
      {
        title: c.title,
        description: `${both(c.question)}\n\n${usable.map((s) => `${icon(s)} **${s.name}** – ${kindName(s).de} / ${kindName(s).en}`).join('\n')}`,
        color: COLOR,
      },
    ],
    components: [
      {
        type: 1,
        components: usable.slice(0, 5).map((s) => ({ type: 2, style: c.style, label: s.name.slice(0, 70), custom_id: `${command}:${s.id}`, emoji: { name: icon(s) } })),
      },
    ],
  });
}

interface PowerInteraction {
  id: string;
  token: string;
  application_id: string;
  user?: DiscordUser;
  member?: { user?: DiscordUser };
  data?: { custom_id?: string };
}

/** Alles, was die einzelnen Abläufe brauchen */
interface Ctx {
  user: User;
  server: Server & { pteroIdentifier: string };
  ptero: PterodactylGateway;
  /** Fett gesetzter Servername */
  name: string;
  say: (text: Localized, extra?: Record<string, unknown>) => Promise<unknown>;
  withPanel: (t: Localized) => Localized;
}

/** Laufende Aktionen – ein zweiter Klick auf denselben Server wartet nicht noch einmal */
const busy = new Set<string>();

/** Klick auf einen Server-Button oder auf die EULA-Bestätigung */
export async function onPowerButton(i: PowerInteraction): Promise<void> {
  const discordUser = i.user ?? i.member?.user;
  const match = BUTTON.exec(i.data?.custom_id ?? '');
  if (!discordUser || !match) return;
  const kind = match[1]!.toLowerCase() as ButtonKind;
  const serverId = match[2]!;
  // Aufgeschobene Antwort: Die Aktion dauert länger als die drei Sekunden, die Discord für eine Antwort lässt.
  // Bei der EULA-Bestätigung wird die Nachricht mit dem Button selbst ersetzt (Typ 6), sonst entsteht eine neue (Typ 5).
  await discordRequest('POST', `/interactions/${i.id}/${i.token}/callback`, { json: { type: kind === 'eula' ? 6 : 5 } });
  const say = (text: Localized, extra: Record<string, unknown> = {}) =>
    discordRequest('PATCH', `/webhooks/${i.application_id}/${i.token}/messages/@original`, { json: { content: both(text), components: [], allowed_mentions: { parse: [] }, ...extra } }).catch(() => null);

  const { user, servers: list } = await accountOf(discordUser.id);
  // Der Server muss zu genau diesem Discord-Konto gehören
  const server = list.find((s) => s.id === serverId);
  if (!user || !server) return void (await say({ de: '❌ Diesen Server finde ich bei deinem Account nicht (mehr).', en: '❌ I cannot find this server on your account (any more).' }));
  const name = `**${server.name}**`;
  const panel = panelServerUrl(server);
  const withPanel = (t: Localized): Localized => (panel ? { de: `${t.de} Panel: ${panel}`, en: `${t.en} Panel: ${panel}` } : t);

  if (server.status !== 'active' || !server.pteroIdentifier) {
    return void (await say({
      de: `❌ ${name} lässt sich gerade nicht steuern (Status: ${server.status}). Details unter ${env.APP_URL}/de/meine-server`,
      en: `❌ ${name} cannot be controlled right now (status: ${server.status}). Details at ${env.APP_URL}/my-servers`,
    }));
  }
  if (busy.has(server.id)) return void (await say({ de: `⏳ Für ${name} läuft gerade schon eine Aktion – einen Moment noch.`, en: `⏳ An action is already running for ${name} – one moment.` }));

  const ctx: Ctx = { user, server: { ...server, pteroIdentifier: server.pteroIdentifier }, ptero: pterodactyl(), name, say, withPanel };
  busy.add(server.id);
  try {
    if (kind === 'start') await startServer(ctx);
    else if (kind === 'stop') await stopServer(ctx);
    else if (kind === 'restart') await restartServer(ctx);
    else await acceptEula(ctx, discordUser);
  } catch {
    await say(
      withPanel({
        de: `❌ Ich erreiche das Panel gerade nicht und konnte die Aktion für ${name} nicht ausführen. Bitte versuche es gleich noch einmal oder nutze direkt das Panel.`,
        en: `❌ I cannot reach the panel right now and could not carry out the action for ${name}. Please try again shortly or use the panel directly.`,
      }),
    );
  } finally {
    busy.delete(server.id);
  }
}

/* ------------------------------------------------------------ Minecraft-EULA */

type Eula = 'accepted' | 'declined' | 'missing' | 'unknown';

/** Stand der EULA laut eula.txt. missing = Datei gibt es (noch) nicht · unknown = nicht lesbar */
async function eulaState(ctx: Ctx): Promise<Eula> {
  if (ctx.server.kind !== 'minecraft') return 'accepted';
  try {
    const text = await ctx.ptero.readFile(ctx.server.pteroIdentifier, '/eula.txt');
    if (text === null) return 'missing';
    return /^\s*eula\s*=\s*true\s*$/im.test(text) ? 'accepted' : 'declined';
  } catch {
    return 'unknown';
  }
}

function askEula(ctx: Ctx) {
  return ctx.say(
    {
      de: `📜 ${ctx.name} kann noch nicht starten: Die Minecraft-EULA ist für diesen Server noch nicht akzeptiert. Bitte lies sie unter ${EULA_URL} und bestätige danach mit dem Button – ich trage die Zustimmung ein und starte den Server anschließend sauber neu.`,
      en: `📜 ${ctx.name} cannot start yet: the Minecraft EULA has not been accepted for this server. Please read it at ${EULA_URL} and then confirm with the button – I will record your acceptance and restart the server cleanly afterwards.`,
    },
    {
      components: [
        {
          type: 1,
          components: [
            { type: 2, style: 3, label: 'Ja, ich akzeptiere die Minecraft-EULA. Ich habe sie gelesen.', custom_id: `eula:${ctx.server.id}` },
            { type: 2, style: 3, label: 'Yes, I accept the Minecraft EULA. I have read it.', custom_id: `eula:${ctx.server.id}:en` },
          ],
        },
        { type: 1, components: [{ type: 2, style: 5, label: 'Minecraft-EULA lesen · Read the Minecraft EULA', url: EULA_URL }] },
      ],
    },
  );
}

/** Klick auf „Ja, ich akzeptiere die Minecraft-EULA“: Zustimmung eintragen, dann sauber (neu) starten */
async function acceptEula(ctx: Ctx, discordUser: DiscordUser) {
  if (ctx.server.kind !== 'minecraft') return void (await ctx.say({ de: `❌ ${ctx.name} ist kein Minecraft-Server.`, en: `❌ ${ctx.name} is not a Minecraft server.` }));
  const now = new Date();
  await ctx.ptero.writeFile(
    ctx.server.pteroIdentifier,
    '/eula.txt',
    `#By changing the setting below to TRUE you are indicating your agreement to our EULA (https://aka.ms/MinecraftEULA).\n#Accepted by the server owner via the CraftingHosting.free Discord bot on ${now.toISOString()}\neula=true\n`,
  );
  await audit({
    userId: ctx.user.id,
    serverId: ctx.server.id,
    actor: 'user',
    action: 'discord.eula_accepted',
    message: `Minecraft-EULA für Server „${ctx.server.name}“ per Discord-Button akzeptiert (Discord-Konto ${discordUser.id})`,
  });
  await ctx.say({ de: `✅ EULA für ${ctx.name} akzeptiert. Ich starte den Server jetzt sauber neu …`, en: `✅ EULA accepted for ${ctx.name}. I am restarting the server cleanly now …` });
  const res = await ctx.ptero.getResources(ctx.server.pteroIdentifier);
  if (res.state === 'running' || res.state === 'starting') {
    await ctx.ptero.sendPowerSignal(ctx.server.pteroIdentifier, 'restart');
    return watchBoot(ctx, { sawStarting: false, graceChecks: 7, eulaAccepted: true, expectDown: true });
  }
  return startServer(ctx, { eulaAccepted: true });
}

/* ------------------------------------------------------------ Start, Stopp, Neustart */

/** Fair-Use: Während einer Pause darf der Server nicht gestartet werden (sonst würde ihn das System gleich wieder stoppen) */
async function startBlocked(ctx: Ctx, state: Server['powerState']): Promise<boolean> {
  const now = new Date();
  const settings = await getSettings();
  const runtime = computeRuntimeState({ ...ctx.server, powerState: state }, ctx.user, await loadWeekSessions(ctx.server.id, now), now, settings.products[ctx.server.kind].fairUse);
  if (runtime.startGate.allowed || runtime.startGate.reason === 'already_online') return false;
  const why = startBlockMessages[runtime.startGate.reason ?? 'not_active'];
  const until = runtime.startGate.until;
  const tz = freeHostingConfig.fairUse.timezone;
  await ctx.say({
    de: `⏸️ ${ctx.name} kann gerade nicht gestartet werden: ${why.de}${until ? ` Wieder möglich ab ${formatDateTime(until, tz, 'de')}.` : ''}`,
    en: `⏸️ ${ctx.name} cannot be started right now: ${why.en}${until ? ` Possible again from ${formatDateTime(until, tz, 'en')}.` : ''}`,
  });
  return true;
}

async function startServer(ctx: Ctx, opts: { eulaAccepted?: boolean } = {}) {
  const { ptero, server, name, say } = ctx;
  // Aktuellen Zustand direkt aus dem Panel lesen – nicht aus dem (bis zu eine Minute alten) Stand der Datenbank
  const before = await ptero.getResources(server.pteroIdentifier);
  if (before.isSuspended) return void (await say({ de: `❌ ${name} ist gesperrt und kann nicht gestartet werden.`, en: `❌ ${name} is suspended and cannot be started.` }));
  if (before.state === 'running') return void (await say({ de: `✅ ${name} ist schon online – ich muss ihn nicht starten.`, en: `✅ ${name} is already online – there is nothing to start.` }));
  if (before.state === 'installing') return void (await say({ de: `⏳ ${name} wird gerade installiert. Bitte versuche es in ein paar Minuten erneut.`, en: `⏳ ${name} is being installed. Please try again in a few minutes.` }));
  if (before.state === 'stopping') return void (await say({ de: `⏳ ${name} wird gerade gestoppt. Bitte warte kurz und versuche es dann erneut.`, en: `⏳ ${name} is stopping right now. Please wait a moment and try again.` }));
  if (await startBlocked(ctx, before.state)) return;
  // EULA abgelehnt bzw. noch nie bestätigt: Der Start würde sofort wieder enden – erst fragen
  if (!opts.eulaAccepted && (await eulaState(ctx)) === 'declined') return void (await askEula(ctx));

  if (before.state !== 'starting') await ptero.sendPowerSignal(server.pteroIdentifier, 'start');
  await audit({ userId: ctx.user.id, serverId: server.id, actor: 'user', action: 'discord.server_start', message: `Server „${server.name}“ per Discord-Nachricht gestartet` });
  if (!opts.eulaAccepted) await say({ de: `⏳ ${name} wird gestartet …`, en: `⏳ Starting ${name} …` });
  await watchBoot(ctx, { sawStarting: before.state === 'starting', graceChecks: 3, eulaAccepted: opts.eulaAccepted });
}

/**
 * Bis zu 90 Sekunden beobachten, ob der Server wirklich hochkommt.
 * graceChecks = so viele Prüfungen (je 5 Sekunden) darf er zu Beginn „offline“ sein, ohne dass das als Fehlstart gilt.
 */
async function watchBoot(ctx: Ctx, opts: { sawStarting: boolean; graceChecks: number; eulaAccepted?: boolean; expectDown?: boolean }) {
  const { ptero, server, name, say, withPanel } = ctx;
  let sawStarting = opts.sawStarting;
  let sawDown = false;
  for (let n = 0; n < 18; n++) {
    await sleep(5000);
    const res = await ptero.getResources(server.pteroIdentifier);
    if (res.state !== 'running') sawDown = true;
    // Nach einem Neustart zählt „online“ erst, wenn der Server zwischendurch unten war (oder schon 15 Sekunden vergangen sind)
    if (res.state === 'running' && (!opts.expectDown || sawDown || n >= 2)) return void (await say({ de: `✅ ${name} ist online.`, en: `✅ ${name} is online.` }));
    if (res.state === 'starting') sawStarting = true;
    // Wieder offline, nachdem er hochfahren wollte – oder gar nicht erst losgelaufen
    if (res.state === 'offline' && (sawStarting || n >= opts.graceChecks)) {
      // Erster Start eines Minecraft-Servers: Er legt eula.txt an und beendet sich wieder
      if (!opts.eulaAccepted && (await eulaState(ctx)) === 'declined') return void (await askEula(ctx));
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
}

async function stopServer(ctx: Ctx) {
  const { ptero, server, name, say, withPanel } = ctx;
  const before = await ptero.getResources(server.pteroIdentifier);
  if (before.isSuspended) return void (await say({ de: `❌ ${name} ist gesperrt – er läuft nicht.`, en: `❌ ${name} is suspended – it is not running.` }));
  if (before.state === 'offline') return void (await say({ de: `✅ ${name} ist schon offline – ich muss ihn nicht stoppen.`, en: `✅ ${name} is already offline – there is nothing to stop.` }));
  if (before.state === 'installing') return void (await say({ de: `⏳ ${name} wird gerade installiert und läuft noch nicht.`, en: `⏳ ${name} is being installed and is not running yet.` }));

  if (before.state !== 'stopping') await ptero.sendPowerSignal(server.pteroIdentifier, 'stop');
  await audit({ userId: ctx.user.id, serverId: server.id, actor: 'user', action: 'discord.server_stop', message: `Server „${server.name}“ per Discord-Nachricht gestoppt` });
  await say({ de: `⏳ ${name} wird gestoppt …`, en: `⏳ Stopping ${name} …` });
  // Bis zu 60 Sekunden warten – Minecraft speichert beim Stoppen erst die Welt
  for (let n = 0; n < 12; n++) {
    await sleep(5000);
    if ((await ptero.getResources(server.pteroIdentifier)).state === 'offline') return void (await say({ de: `✅ ${name} ist gestoppt.`, en: `✅ ${name} has been stopped.` }));
  }
  await say(
    withPanel({
      de: `⏳ ${name} braucht zum Stoppen länger als üblich. Bitte sieh im Panel nach, ob er aus ist.`,
      en: `⏳ ${name} is taking longer than usual to stop. Please check in the panel whether it is off.`,
    }),
  );
}

async function restartServer(ctx: Ctx) {
  const { ptero, server, name, say } = ctx;
  const before = await ptero.getResources(server.pteroIdentifier);
  if (before.isSuspended) return void (await say({ de: `❌ ${name} ist gesperrt und kann nicht neu gestartet werden.`, en: `❌ ${name} is suspended and cannot be restarted.` }));
  if (before.state === 'installing') return void (await say({ de: `⏳ ${name} wird gerade installiert. Bitte versuche es in ein paar Minuten erneut.`, en: `⏳ ${name} is being installed. Please try again in a few minutes.` }));
  if (before.state === 'stopping') return void (await say({ de: `⏳ ${name} wird gerade gestoppt. Bitte warte kurz und versuche es dann erneut.`, en: `⏳ ${name} is stopping right now. Please wait a moment and try again.` }));
  // Ist er aus, ist ein Neustart ein gewöhnlicher Start – mit allen Prüfungen (Fair-Use-Pause, EULA)
  if (before.state === 'offline') return startServer(ctx);

  await ptero.sendPowerSignal(server.pteroIdentifier, 'restart');
  await audit({ userId: ctx.user.id, serverId: server.id, actor: 'user', action: 'discord.server_restart', message: `Server „${server.name}“ per Discord-Nachricht neu gestartet` });
  await say({ de: `⏳ ${name} wird neu gestartet …`, en: `⏳ Restarting ${name} …` });
  // Beim Neustart ist der Server zwischendurch kurz offline – das ist kein Fehlstart
  await watchBoot(ctx, { sawStarting: false, graceChecks: 7, expectDown: true });
}
