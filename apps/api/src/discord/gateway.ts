/**
 * Dauerverbindung zu Discord (Gateway). Darüber kommen Beitritte, Befehle und Button-Klicks.
 * Läuft im Worker (bzw. in der API, wenn dort die Jobs laufen) – nie auf der Beta-Instanz.
 *
 * Die Verbindung richtet sich nach den Einstellungen im Admin-Bereich: Wird dort ein Token eingetragen,
 * geändert oder die Anbindung ausgeschaltet, zieht der Bot innerhalb von ca. 20 Sekunden nach – ohne Neustart.
 * Eine Sperre in der Datenbank sorgt dafür, dass bei mehreren Workern nur einer verbunden ist.
 */
import { randomUUID } from 'node:crypto';
import { env } from '../env';
import { acquireLease, releaseLease } from '../jobs/lock';
import { handleDiscordEvent, type BotLogger } from './bot';
import { discordRequest } from './rest';
import { discordConfig } from './service';
import { patchDiscordState } from './store';

/** GUILDS | GUILD_MEMBERS (privilegiert: „Server Members Intent“) | GUILD_INVITES | DIRECT_MESSAGES (für „!start“ per Direktnachricht) */
const INTENTS = (1 << 0) | (1 << 1) | (1 << 6) | (1 << 12);
const LEASE = 'discord-gateway';
const LEASE_MS = 90_000;
const OWNER = randomUUID();

/** Schließcodes, bei denen ein neuer Versuch sinnlos ist, bis sich die Einstellungen ändern */
const FATAL: Record<number, string> = {
  4004: 'Discord lehnt das Bot-Token ab. Bitte das Token im Admin-Bereich prüfen.',
  4010: 'Ungültige Shard-Angabe.',
  4011: 'Der Bot ist auf zu vielen Servern für eine einzelne Verbindung.',
  4012: 'Ungültige API-Version.',
  4013: 'Ungültige Intents.',
  4014: 'Der „Server Members Intent“ ist nicht eingeschaltet. Im Discord Developer Portal unter Bot → Privileged Gateway Intents aktivieren.',
};

type Status = 'off' | 'connecting' | 'online' | 'error';

class Connection {
  private ws: WebSocket | null = null;
  private heartbeat: NodeJS.Timeout | null = null;
  private retry: NodeJS.Timeout | null = null;
  private seq: number | null = null;
  private sessionId: string | null = null;
  private resumeUrl: string | null = null;
  private acked = true;
  private attempts = 0;
  private closed = false;
  fatal: string | null = null;
  fatalAt = 0;

  constructor(
    readonly token: string,
    private readonly log: BotLogger,
    private readonly onStatus: (status: Status, error?: string | null) => void,
  ) {}

  async open(resume = false): Promise<void> {
    if (this.closed || this.fatal) return;
    this.onStatus('connecting');
    try {
      let url = resume && this.resumeUrl ? this.resumeUrl : null;
      if (!url) {
        this.sessionId = null;
        this.seq = null;
        url = (await discordRequest<{ url: string }>('GET', '/gateway/bot', { botToken: this.token })).url;
      }
      const ws = new WebSocket(`${url.replace(/\/$/, '')}/?v=10&encoding=json`);
      this.ws = ws;
      ws.addEventListener('message', (event) => void this.onMessage(String(event.data)));
      ws.addEventListener('close', (event) => this.onClose(ws, event.code));
      ws.addEventListener('error', () => {
        /* „close“ folgt und kümmert sich um den nächsten Versuch */
      });
    } catch (err) {
      const status = (err as { status?: number }).status;
      if (status === 401) {
        this.fatal = FATAL[4004]!;
        this.fatalAt = Date.now();
        return this.onStatus('error', this.fatal);
      }
      this.scheduleReconnect(false, err instanceof Error ? err.message : 'Verbindung fehlgeschlagen');
    }
  }

  private send(op: number, d: unknown) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify({ op, d }));
  }

  private async onMessage(raw: string): Promise<void> {
    let msg: { op: number; d: any; s: number | null; t: string | null };
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    if (typeof msg.s === 'number') this.seq = msg.s;
    switch (msg.op) {
      case 10: {
        // Hello: Herzschlag starten, dann anmelden bzw. die alte Sitzung fortsetzen
        const interval = Number(msg.d?.heartbeat_interval) || 41_250;
        this.acked = true;
        if (this.heartbeat) clearInterval(this.heartbeat);
        this.heartbeat = setInterval(() => {
          // Kein Lebenszeichen auf den letzten Herzschlag → Verbindung ist tot
          if (!this.acked) return this.ws?.close(4000);
          this.acked = false;
          this.send(1, this.seq);
        }, interval);
        if (this.sessionId && this.seq !== null) this.send(6, { token: this.token, session_id: this.sessionId, seq: this.seq });
        else this.send(2, { token: this.token, intents: INTENTS, properties: { os: 'linux', browser: 'craftinghosting-free', device: 'craftinghosting-free' } });
        return;
      }
      case 11:
        this.acked = true;
        return;
      case 1:
        return this.send(1, this.seq);
      case 7:
        // Discord bittet um einen Neuaufbau – die Sitzung lässt sich fortsetzen
        return this.ws?.close(4000);
      case 9:
        // Sitzung ungültig: neu anmelden (d = true → fortsetzen möglich)
        if (!msg.d) {
          this.sessionId = null;
          this.seq = null;
        }
        return void setTimeout(() => this.ws?.close(4000), 1000 + Math.random() * 4000);
      case 0: {
        if (msg.t === 'READY') {
          this.sessionId = msg.d.session_id;
          this.resumeUrl = msg.d.resume_gateway_url ?? null;
          this.attempts = 0;
          this.onStatus('online');
          this.log.info(`Discord-Bot verbunden als ${msg.d.user?.username ?? '?'}`);
        }
        if (msg.t === 'RESUMED') {
          this.attempts = 0;
          this.onStatus('online');
        }
        if (msg.t) {
          await handleDiscordEvent(msg.t, msg.d, this.log).catch((err) => this.log.warn({ err: err instanceof Error ? err.message : err, event: msg.t }, 'Discord: Ereignis konnte nicht verarbeitet werden'));
        }
      }
    }
  }

  private onClose(ws: WebSocket, code: number) {
    if (this.ws !== ws) return;
    this.ws = null;
    if (this.heartbeat) clearInterval(this.heartbeat);
    this.heartbeat = null;
    if (this.closed) return;
    const fatal = FATAL[code];
    if (fatal) {
      this.fatal = fatal;
      this.fatalAt = Date.now();
      this.log.warn({ code }, `Discord-Bot getrennt: ${fatal}`);
      return this.onStatus('error', fatal);
    }
    this.scheduleReconnect(true, `Verbindung getrennt (Code ${code})`);
  }

  private scheduleReconnect(resume: boolean, reason: string) {
    if (this.closed || this.retry) return;
    this.attempts++;
    // Erst schnell, dann mit wachsendem Abstand (höchstens eine Minute)
    const delay = Math.min(60_000, 1000 * 2 ** Math.min(this.attempts, 6)) + Math.random() * 1000;
    if (this.attempts > 2) this.onStatus('error', `${reason} – neuer Versuch in ${Math.round(delay / 1000)} s`);
    this.retry = setTimeout(() => {
      this.retry = null;
      void this.open(resume);
    }, delay);
  }

  close() {
    this.closed = true;
    if (this.heartbeat) clearInterval(this.heartbeat);
    if (this.retry) clearTimeout(this.retry);
    this.ws?.close(1000);
    this.ws = null;
  }
}

/** Startet die Überwachung: verbindet, sobald die Anbindung eingerichtet ist, und trennt, wenn sie ausgeschaltet wird. */
export function startDiscordGateway(log: BotLogger): { stop(): Promise<void> } {
  if (env.BETA_MODE) return { stop: async () => {} };
  let connection: Connection | null = null;
  let lastStatus = '';
  let stopped = false;

  const setStatus = (status: Status, error: string | null = null) => {
    const key = `${status}:${error ?? ''}`;
    if (key === lastStatus) return;
    lastStatus = key;
    void patchDiscordState({ gateway: { status, at: new Date().toISOString(), error } }).catch(() => {});
  };

  const tick = async () => {
    if (stopped) return;
    try {
      const cfg = await discordConfig();
      const want = cfg.botReady && typeof WebSocket !== 'undefined';
      const mine = want && (await acquireLease(LEASE, OWNER, LEASE_MS));
      // Nach einem endgültigen Fehler (falsches Token, fehlender Intent) alle paar Minuten neu versuchen –
      // so greift eine Korrektur im Developer Portal ohne Neustart
      const retryFatal = !!connection?.fatal && Date.now() - connection.fatalAt > 3 * 60_000;
      if (!mine || retryFatal || (connection && connection.token !== cfg.botToken)) {
        if (connection) {
          connection.close();
          connection = null;
          if (!want) setStatus('off');
        }
        if (!mine) {
          if (want) return; // ein anderer Worker hält die Verbindung
          if (cfg.botReady) setStatus('error', 'Diese Node.js-Version hat kein WebSocket – bitte Node.js 22 verwenden.');
          else setStatus('off');
          return;
        }
      }
      if (!connection) {
        connection = new Connection(cfg.botToken!, log, setStatus);
        await connection.open();
      }
    } catch (err) {
      log.warn({ err: err instanceof Error ? err.message : err }, 'Discord: Verbindung konnte nicht geprüft werden');
    }
  };

  void tick();
  const timer = setInterval(() => void tick(), 20_000);
  return {
    async stop() {
      stopped = true;
      clearInterval(timer);
      connection?.close();
      connection = null;
      await releaseLease(LEASE, OWNER).catch(() => {});
      await patchDiscordState({ gateway: { status: 'off', at: new Date().toISOString(), error: null } }).catch(() => {});
    },
  };
}
