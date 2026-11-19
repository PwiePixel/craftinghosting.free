/**
 * Live-Konsole für die Partner-API als Server-Sent Events.
 *
 * Unsere API verbindet sich selbst mit dem Daemon des Servers und reicht NUR die Ausgabe weiter. Der Zugang zum
 * Daemon geht nie an den Partner: Darüber ließen sich Server auch starten – an unseren Laufzeit-Regeln vorbei.
 * Der Stream zählt nicht als Lebenszeichen des Hosts. Grenzen: Verbindungen je Partner und je Server, feste Höchstdauer.
 */
import { and, eq } from 'drizzle-orm';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { db } from '../db/client';
import { partners, servers, type Partner } from '../db/schema';
import { ApiError, L } from '../lib/errors';
import { pterodactyl } from '../pterodactyl';

const MAX_PER_PARTNER = 50;
const MAX_PER_SERVER = 3;
const MAX_DURATION_MS = 15 * 60_000;
/** owner: Partner bzw. Nutzer der Website (je eigener Schlüssel), server: je Server über alle Zugänge hinweg */
const open = { partner: new Map<string, number>(), server: new Map<string, number>() };
const bump = (map: Map<string, number>, key: string, by: number) => {
  const next = (map.get(key) ?? 0) + by;
  if (next <= 0) map.delete(key);
  else map.set(key, next);
};

// eslint-disable-next-line no-control-regex
const stripAnsi = (line: string) => line.replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, '').replace(/[\u0000-\u0008\u000b-\u001f]/g, '');

/** Wie viele Streams sind für diesen Partner offen? (für Tests und Auskunft) */
export const openConsoleStreams = (partnerId: string) => open.partner.get(`partner:${partnerId}`) ?? 0;

export async function streamPartnerConsole(partner: Partner, server: { id: string; pteroIdentifier: string }, request: FastifyRequest, reply: FastifyReply): Promise<void> {
  return streamServerConsole(
    {
      owner: `partner:${partner.id}`,
      maxPerOwner: MAX_PER_PARTNER,
      server,
      // Wird der Key getauscht, der Partner deaktiviert oder der Server gelöscht/gesperrt, endet der Stream
      stillAllowed: async () => {
        const [row] = await db
          .select({ enabled: partners.enabled, keyHash: partners.keyHash, status: servers.status })
          .from(servers)
          .innerJoin(partners, eq(partners.id, servers.partnerId))
          .where(and(eq(servers.id, server.id), eq(partners.id, partner.id)))
          .limit(1);
        return !!row && row.enabled && row.keyHash === partner.keyHash && row.status === 'active';
      },
    },
    request,
    reply,
  );
}

/**
 * Live-Ausgabe eines Servers als Server-Sent Events – für die Partner-API und für „Meine Server“ auf der Website.
 * Nur lesend: Befehle gehen über einen eigenen Aufruf (Website) bzw. gar nicht (Partner-API).
 */
export async function streamServerConsole(
  opts: { owner: string; maxPerOwner: number; server: { id: string; pteroIdentifier: string }; stillAllowed: () => Promise<boolean> },
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const { server } = opts;
  const owner = opts.owner;
  if ((open.partner.get(owner) ?? 0) >= opts.maxPerOwner || (open.server.get(server.id) ?? 0) >= MAX_PER_SERVER) {
    throw new ApiError(429, 'too_many_streams', L('Zu viele offene Konsolen-Streams. Bitte einen schließen und erneut versuchen.', 'Too many open console streams. Please close one and try again.'));
  }
  bump(open.partner, owner, 1);
  bump(open.server, server.id, 1);

  const raw = reply.raw;
  reply.hijack();
  raw.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
  const send = (event: string, data: unknown) => {
    // Liest der Empfänger nicht mit, wird nicht endlos zwischengespeichert, sondern getrennt
    if (raw.writableLength > 1024 * 1024) return void close('slow_client');
    raw.write(`event: ${event}\ndata: ${JSON.stringify(typeof data === 'string' ? data.slice(0, 4000) : data)}\n\n`);
  };

  let closed = false;
  let socket: WebSocket | null = null;
  let poll: NodeJS.Timeout | null = null;
  const close = (reason: string) => {
    if (closed) return;
    closed = true;
    clearInterval(ping);
    clearInterval(recheck);
    clearTimeout(limit);
    if (poll) clearInterval(poll);
    try {
      socket?.close();
    } catch {
      /* schon zu */
    }
    bump(open.partner, owner, -1);
    bump(open.server, server.id, -1);
    if (!raw.writableEnded && !raw.destroyed) {
      if (reason !== 'slow_client') raw.write(`event: end\ndata: ${JSON.stringify({ reason })}\n\n`);
      raw.end();
    }
    // Die Verbindung nicht offen stehen lassen, bis der Empfänger irgendwann liest: kurz danach hart schließen
    if (reason === 'slow_client') raw.destroy();
    else setTimeout(() => raw.destroy(), 5000).unref();
  };
  const ping = setInterval(() => {
    if (raw.destroyed) return close('client_closed');
    if (raw.writableLength > 1024 * 1024) return close('slow_client');
    raw.write(': ping\n\n');
  }, 20_000);
  // Regelmäßig neu prüfen, ob der Zugang noch besteht (sonst endet der Stream)
  const recheck = setInterval(() => {
    void opts
      .stillAllowed()
      .then((ok) => ok || close('revoked'))
      .catch(() => {});
  }, 30_000);
  const limit = setTimeout(() => close('max_duration'), MAX_DURATION_MS);
  request.raw.on('close', () => close('client_closed'));
  raw.on('close', () => close('client_closed'));
  raw.on('error', () => close('client_closed'));
  // Hat der Empfänger schon aufgelegt, bevor wir zuhören konnten, käme kein „close“ mehr – dann sofort beenden
  if (request.raw.destroyed || raw.destroyed) return close('client_closed');

  /** Ersatz ohne Daemon-Verbindung: das Protokoll regelmäßig lesen und neue Zeilen weiterreichen */
  const startPolling = () => {
    if (closed || poll) return;
    send('info', { source: 'log' });
    let seen = -1;
    const tick = async () => {
      if (closed) return;
      try {
        const text = (await pterodactyl().readFile(server.pteroIdentifier, '/logs/latest.log')) ?? '';
        const lines = text.split(/\r?\n/);
        if (lines[lines.length - 1] === '') lines.pop();
        // Erster Durchlauf: die letzten Zeilen; neues Protokoll (Server neu gestartet): von vorn
        if (seen === -1) seen = Math.max(0, lines.length - 50);
        if (lines.length < seen) seen = 0;
        for (const line of lines.slice(seen)) if (!closed) send('line', stripAnsi(line));
        seen = lines.length;
      } catch {
        /* beim nächsten Durchlauf erneut */
      }
    };
    void tick();
    poll = setInterval(() => void tick(), 3000);
  };

  let ticket: { url: string; token: string; origin: string } | null = null;
  try {
    ticket = await pterodactyl().consoleSocket(server.pteroIdentifier);
  } catch {
    ticket = null;
  }
  if (!ticket) return startPolling();

  try {
    // Der Daemon prüft die Herkunft – deshalb die Adresse des Panels als Origin
    socket = new (WebSocket as unknown as new (url: string, init: { headers: Record<string, string> }) => WebSocket)(ticket.url, { headers: { Origin: ticket.origin } });
  } catch {
    return startPolling();
  }
  const ws = socket;
  let authed = false;
  const fallback = setTimeout(() => {
    if (!authed) {
      try {
        ws.close();
      } catch {
        /* egal */
      }
      startPolling();
    }
  }, 6000);
  ws.addEventListener('open', () => ws.send(JSON.stringify({ event: 'auth', args: [ticket!.token] })));
  ws.addEventListener('message', (message) => {
    if (closed) return;
    let data: { event?: string; args?: unknown[] };
    try {
      data = JSON.parse(String(message.data)) as typeof data;
    } catch {
      return;
    }
    if (data.event === 'auth success') {
      if (!authed) {
        authed = true;
        clearTimeout(fallback);
        send('info', { source: 'live' });
        // Die bisherige Ausgabe einmal anfordern – gesendet wird sonst NIE etwas (kein Start, kein Befehl)
        ws.send(JSON.stringify({ event: 'send logs', args: [null] }));
      }
    } else if (data.event === 'console output' || data.event === 'install output' || data.event === 'daemon message') {
      for (const arg of data.args ?? []) for (const line of String(arg).split(/\r?\n/)) if (line) send('line', stripAnsi(line));
    } else if (data.event === 'status') {
      send('status', { state: String(data.args?.[0] ?? '') });
    } else if (data.event === 'token expiring') {
      // Zugang läuft ab: neuen holen und erneut anmelden
      void pterodactyl()
        .consoleSocket(server.pteroIdentifier)
        .then((next) => next && ws.readyState === ws.OPEN && ws.send(JSON.stringify({ event: 'auth', args: [next.token] })))
        .catch(() => {});
    } else if (data.event === 'token expired' || data.event === 'jwt error') {
      close('upstream_closed');
    }
  });
  const down = () => {
    clearTimeout(fallback);
    if (!authed) startPolling();
    else close('upstream_closed');
  };
  ws.addEventListener('close', down);
  ws.addEventListener('error', down);
}
