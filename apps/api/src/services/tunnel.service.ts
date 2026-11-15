/**
 * Cloudflare Tunnel aus dem Admin-Bereich: Domain freigeben (Link), Tunnel anlegen, Domains verbinden.
 *
 * Ablauf:
 *  1. „Mit Cloudflare verbinden“  →  `cloudflared tunnel login` liefert einen Link. Wer ihn öffnet und die Domain
 *     auswählt, gibt diesem Server Zugriff auf die DNS-Einträge der Domain (das Zertifikat landet im Datenverzeichnis).
 *  2. „Tunnel einrichten“         →  Tunnel anlegen, Konfiguration schreiben, je Domain den DNS-Eintrag setzen.
 *  3. Der Dienst `chfree-tunnel` (systemd, vom Installer eingerichtet) startet, sobald die Konfiguration existiert,
 *     und verbindet den Server ausgehend mit Cloudflare – ohne offene Ports. HTTPS-Zertifikate stellt Cloudflare.
 *
 * Alles liegt unter <Datenverzeichnis>/.cloudflared (HOME des Tunnel-Programms). Es wird ausschließlich das feste
 * Programm `cloudflared` mit festen Argumenten gestartet – Domainnamen werden vorher streng geprüft.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { normalizeHost, type AdminTunnelDTO } from '@chfree/shared';
import type { User } from '../db/schema';
import { env } from '../env';
import { Errors, L } from '../lib/errors';
import { audit } from './audit.service';
import { allowedHosts, betaHost, getSettings } from './settings.service';

const BIN = process.env.CLOUDFLARED_BIN || 'cloudflared';
const METRICS = '127.0.0.1:20241';
const HOME = dirname(env.DATABASE_PATH);
const DIR = join(HOME, '.cloudflared');
const CERT = join(DIR, 'cert.pem');
const CONFIG = join(DIR, 'config.yml');
const STATE = join(DIR, 'chfree-tunnel.json');
const PIDFILE = join(DIR, 'tunnel.pid');

interface TunnelState {
  id: string;
  name: string;
  hosts: string[];
}

function readState(): TunnelState | null {
  try {
    return JSON.parse(readFileSync(STATE, 'utf8')) as TunnelState;
  } catch {
    return null;
  }
}

/** Führt cloudflared aus und sammelt die Ausgabe. Wirft nie – der Aufrufer wertet `code` aus. */
function run(args: string[], timeoutMs = 30_000): Promise<{ code: number | null; output: string }> {
  return new Promise((resolve) => {
    let output = '';
    let child: ChildProcess;
    try {
      mkdirSync(DIR, { recursive: true, mode: 0o700 });
      child = spawn(BIN, args, { env: { ...process.env, HOME, TUNNEL_ORIGIN_CERT: CERT }, stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (err) {
      resolve({ code: null, output: (err as Error).message });
      return;
    }
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
    child.stdout?.on('data', (d: Buffer) => (output += d.toString()));
    child.stderr?.on('data', (d: Buffer) => (output += d.toString()));
    child.on('error', (err) => {
      clearTimeout(timer);
      resolve({ code: null, output: err.message });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, output });
    });
  });
}

/** Letzte aussagekräftige Zeile einer cloudflared-Ausgabe (für Fehlermeldungen) */
function lastLine(output: string): string {
  const lines = output
    .split('\n')
    .map((l) => l.replace(/^\S+Z\s+(ERR|INF|WRN)\s+/, '').trim())
    .filter(Boolean);
  return (lines[lines.length - 1] ?? 'Unbekannter Fehler').slice(0, 300);
}

/* ------------------------------------------------------------ Anmeldung (Link) */

let login: { child: ChildProcess; url: string | null; startedAt: number; error: string | null } | null = null;

/**
 * Startet die Anmeldung bei Cloudflare und gibt den Link zurück, mit dem die Domain freigegeben wird.
 * Das Programm wartet danach im Hintergrund (bis zu 15 Minuten), bis die Freigabe erfolgt ist.
 */
export async function startTunnelLogin(admin: Pick<User, 'email'>, opts: { renew?: boolean } = {}, ip?: string): Promise<AdminTunnelDTO> {
  if (login && !login.child.killed && login.child.exitCode === null && login.url) return tunnelStatus();
  if (existsSync(CERT)) {
    if (!opts.renew) return tunnelStatus();
    rmSync(CERT, { force: true }); // cloudflared überschreibt ein vorhandenes Zertifikat nicht
  }
  mkdirSync(DIR, { recursive: true, mode: 0o700 });
  let child: ChildProcess;
  try {
    child = spawn(BIN, ['tunnel', 'login'], { env: { ...process.env, HOME, TUNNEL_ORIGIN_CERT: CERT }, stdio: ['ignore', 'pipe', 'pipe'] });
  } catch {
    throw Errors.conflict('cloudflared_missing', L('cloudflared ist auf dem Server nicht installiert.', 'cloudflared is not installed on the server.'));
  }
  const state = { child, url: null as string | null, startedAt: Date.now(), error: null as string | null };
  login = state;
  let buffer = '';
  const found = new Promise<void>((resolve) => {
    const onData = (d: Buffer) => {
      buffer += d.toString();
      const m = /https:\/\/dash\.cloudflare\.com\/argotunnel\S+/.exec(buffer);
      if (m && !state.url) {
        state.url = m[0];
        resolve();
      }
    };
    child.stdout?.on('data', onData);
    child.stderr?.on('data', onData);
    child.on('error', (err) => {
      state.error = (err as NodeJS.ErrnoException).code === 'ENOENT' ? 'cloudflared ist auf dem Server nicht installiert.' : err.message;
      resolve();
    });
    child.on('close', (code) => {
      if (code !== 0 && !existsSync(CERT)) state.error ??= lastLine(buffer);
      resolve();
    });
  });
  const timeout = setTimeout(() => child.kill('SIGTERM'), 15 * 60_000);
  child.on('close', () => clearTimeout(timeout));
  await Promise.race([found, new Promise((r) => setTimeout(r, 20_000))]);
  await audit({ actor: 'admin', action: 'tunnel.login_started', message: `Cloudflare-Anmeldung für den Tunnel gestartet (durch ${admin.email})`, ip });
  if (!state.url && state.error) throw Errors.conflict('tunnel_login_failed', L(state.error, state.error));
  return tunnelStatus();
}

/* ------------------------------------------------------------ Status */

let versionCache: { at: number; value: string | null } | null = null;

async function cloudflaredVersion(): Promise<string | null> {
  if (versionCache && Date.now() - versionCache.at < 60_000) return versionCache.value;
  const res = await run(['--version'], 5000);
  const value = res.code === 0 ? (/(\d+\.\d+\.\d+)/.exec(res.output)?.[1] ?? 'installiert') : null;
  versionCache = { at: Date.now(), value };
  return value;
}

async function readyConnections(): Promise<number | null> {
  try {
    const res = await fetch(`http://${METRICS}/ready`, { signal: AbortSignal.timeout(1500) });
    const data = (await res.json()) as { readyConnections?: number };
    return typeof data.readyConnections === 'number' ? data.readyConnections : res.ok ? 1 : 0;
  } catch {
    return null;
  }
}

export async function tunnelStatus(): Promise<AdminTunnelDTO> {
  const [version, connections] = await Promise.all([cloudflaredVersion(), readyConnections()]);
  const state = readState();
  const loggedIn = existsSync(CERT);
  const pending = !!login && login.child.exitCode === null && !login.child.killed && !loggedIn;
  return {
    installed: version !== null,
    version,
    loggedIn,
    loginUrl: pending ? (login?.url ?? null) : null,
    loginPending: pending,
    tunnelId: state?.id ?? null,
    hosts: state?.hosts ?? [],
    running: (connections ?? 0) > 0,
    connections,
    error: !loggedIn && login?.error ? login.error : null,
  };
}

/* ------------------------------------------------------------ Einrichten */

function writeConfig(state: TunnelState) {
  const api = `http://127.0.0.1:${env.API_PORT}`;
  const web = (env.WEB_INTERNAL_URL ?? 'http://127.0.0.1:3000').replace(/\/$/, '');
  const beta = betaHost();
  const port = (name: string, fallback: number) => (/^\d{2,5}$/.test(process.env[name] ?? '') ? Number(process.env[name]) : fallback);
  const betaApi = `http://127.0.0.1:${port('BETA_API_PORT', 4100)}`;
  const betaWeb = `http://127.0.0.1:${port('BETA_WEB_PORT', 3100)}`;
  const lines = [
    '# Von CraftingHosting.free erzeugt (Admin → Domains → Tunnel) – Änderungen werden überschrieben.',
    `tunnel: ${state.id}`,
    `credentials-file: ${join(DIR, `${state.id}.json`)}`,
    `metrics: ${METRICS}`,
    'no-autoupdate: true',
    'ingress:',
    ...state.hosts.flatMap((host) => {
      // Die Domain der Beta-Instanz geht an deren eigene Dienste (Ports aus install.sh --beta)
      const isBeta = host === beta;
      return [
        `  - hostname: ${host}`,
        '    path: ^/api/',
        `    service: ${isBeta ? betaApi : api}`,
        `  - hostname: ${host}`,
        `    service: ${isBeta ? betaWeb : web}`,
      ];
    }),
    '  - service: http_status:404',
    '',
  ];
  writeFileSync(CONFIG, lines.join('\n'), { mode: 0o600 });
  writeFileSync(STATE, JSON.stringify(state, null, 2), { mode: 0o600 });
}

/** Laufenden Tunnel beenden – systemd startet ihn sofort mit der neuen Konfiguration wieder (Restart=always) */
export function restartTunnelProcess(): boolean {
  try {
    const pid = Number(readFileSync(PIDFILE, 'utf8').trim());
    if (!Number.isInteger(pid) || pid <= 1) return false;
    process.kill(pid, 'SIGTERM');
    return true;
  } catch {
    return false;
  }
}

/**
 * Legt den Tunnel an (falls nötig), schreibt die Konfiguration und verbindet die gewählten Domains.
 * @returns Status + je Domain, ob der DNS-Eintrag gesetzt werden konnte
 */
export async function setupTunnel(
  admin: Pick<User, 'email'>,
  rawHosts: string[],
  ip?: string,
): Promise<{ tunnel: AdminTunnelDTO; results: { host: string; ok: boolean; message: string }[] }> {
  if (!existsSync(CERT)) {
    throw Errors.conflict('tunnel_not_logged_in', L('Bitte zuerst über den Link bei Cloudflare freigeben.', 'Please authorize via the Cloudflare link first.'));
  }
  const allowed = allowedHosts(await getSettings());
  const hosts = [...new Set(rawHosts.map((h) => normalizeHost(h)).filter((h): h is string => !!h && allowed.has(h)))];
  if (hosts.length === 0) throw Errors.badRequest('no_hosts', L('Bitte mindestens eine eingetragene Domain auswählen.', 'Please select at least one configured domain.'));

  let state = readState();
  if (!state || !existsSync(join(DIR, `${state.id}.json`))) {
    const name = `chfree-${new URL(env.APP_URL).hostname.replace(/[^a-z0-9]+/g, '-')}-${Date.now().toString(36).slice(-4)}`;
    const before = new Set(readdirSync(DIR));
    const res = await run(['tunnel', 'create', name], 60_000);
    // Die Zugangsdaten des neuen Tunnels liegen als <Tunnel-ID>.json im Verzeichnis
    const created = readdirSync(DIR).find((f) => !before.has(f) && /^[0-9a-f]{8}-[0-9a-f-]{27}\.json$/.test(f));
    if (res.code !== 0 || !created) {
      throw Errors.conflict('tunnel_create_failed', L(`Tunnel konnte nicht angelegt werden: ${lastLine(res.output)}`, `Tunnel could not be created: ${lastLine(res.output)}`));
    }
    state = { id: created.replace(/\.json$/, ''), name, hosts: [] };
  }
  state.hosts = hosts;
  writeConfig(state);

  const results: { host: string; ok: boolean; message: string }[] = [];
  for (const host of hosts) {
    const res = await run(['tunnel', 'route', 'dns', '--overwrite-dns', state.id, host], 60_000);
    results.push({
      host,
      ok: res.code === 0,
      message: res.code === 0 ? 'DNS-Eintrag gesetzt' : `${lastLine(res.output)} – gehört die Domain zu dem Cloudflare-Konto, das du freigegeben hast?`,
    });
  }
  restartTunnelProcess();
  await audit({ actor: 'admin', action: 'tunnel.setup', message: `Tunnel ${state.name} eingerichtet für ${hosts.join(', ')} (durch ${admin.email})`, ip });
  return { tunnel: await tunnelStatus(), results };
}

/** Tunnel trennen: Konfiguration entfernen und Prozess beenden. Die Freigabe bei Cloudflare bleibt bestehen. */
export async function disconnectTunnel(admin: Pick<User, 'email'>, ip?: string): Promise<AdminTunnelDTO> {
  rmSync(CONFIG, { force: true });
  const state = readState();
  if (state) writeFileSync(STATE, JSON.stringify({ ...state, hosts: [] }, null, 2), { mode: 0o600 });
  restartTunnelProcess();
  await audit({ actor: 'admin', action: 'tunnel.disconnected', message: `Tunnel getrennt (durch ${admin.email})`, ip });
  return tunnelStatus();
}
