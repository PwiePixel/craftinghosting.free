'use client';

/**
 * Server auf der Website verwalten: Live-Zustand, Starten/Stoppen/Neustarten, Konsole (live) mit Befehlseingabe und
 * Ports. Alle Aktionen gehen über unsere API – dort gelten dieselben Regeln wie im Panel (Fair-Use, Sperren, EULA).
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowUpRight, Cable, Play, Plus, Power, RotateCw, Send, Square, SquareTerminal, Trash2 } from 'lucide-react';
import { formatDuration, formatMb, type ServerDetailDTO, type ServerPowerAction } from '@chfree/shared';
import { Button, ButtonLink } from '@/components/ui/button';
import { Alert, StatusDot } from '@/components/ui/primitives';
import { useDict, useLang } from '@/i18n/client';
import { api, ApiClientError } from '@/lib/api/client';
import { cn } from '@/lib/utils';

type Live = NonNullable<ServerDetailDTO['live']>;
const MAX_LINES = 500;

function tone(state: Live['state'] | undefined): 'green' | 'amber' | 'red' | 'blue' | 'gray' {
  if (state === 'running') return 'green';
  if (state === 'starting' || state === 'stopping') return 'amber';
  if (state === 'installing') return 'blue';
  return 'gray';
}

export function ServerManager({ initial }: { initial: ServerDetailDTO }) {
  const dict = useDict();
  const t = dict.manage;
  const lang = useLang();
  const fmt = { mb: (mb: number) => formatMb(mb, lang), duration: (s: number, o: { maxUnits?: number }) => formatDuration(s, o, lang) };
  const [detail, setDetail] = useState(initial);
  const [tab, setTab] = useState<'console' | 'ports'>('console');
  const [busy, setBusy] = useState<ServerPowerAction | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [eula, setEula] = useState(false);
  const id = initial.server.id;
  const live = detail.live;
  const state = live?.state;
  const installing = detail.server.powerState === 'installing' || state === 'installing';
  const active = detail.server.status === 'active';

  const refresh = useCallback(async () => {
    try {
      setDetail(await api<ServerDetailDTO>(`/servers/${id}`));
    } catch {
      /* nächster Versuch beim nächsten Takt */
    }
  }, [id]);

  // Zustand regelmäßig auffrischen – schneller, solange sich gerade etwas ändert
  const changing = installing || state === 'starting' || state === 'stopping';
  useEffect(() => {
    const timer = setInterval(() => void refresh(), changing ? 3000 : 10_000);
    return () => clearInterval(timer);
  }, [refresh, changing]);

  async function power(action: ServerPowerAction, acceptEula = false) {
    if (action === 'kill' && !window.confirm(t.killConfirm)) return;
    setBusy(action);
    setError(null);
    try {
      setDetail(await api<ServerDetailDTO>(`/servers/${id}/power`, { body: { action, ...(acceptEula ? { acceptEula: true } : {}) } }));
      setEula(false);
    } catch (err) {
      if (err instanceof ApiClientError && err.code === 'eula_required') setEula(true);
      else setError(err instanceof ApiClientError ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  const online = state === 'running' || state === 'starting';
  return (
    <div className="space-y-5">
      <section className="surface p-5 sm:p-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2.5 text-[15px] font-medium text-white">
            <StatusDot tone={tone(installing ? 'installing' : state)} />
            {installing ? t.state.installing : state ? t.state[state] : t.liveUnavailable}
          </div>
          {active && !installing && (
            <div className="flex flex-wrap gap-2">
              <Button size="sm" onClick={() => power('start')} loading={busy === 'start'} disabled={!!busy || online || state === 'stopping'} icon={<Play aria-hidden />}>
                {t.start}
              </Button>
              <Button size="sm" variant="secondary" onClick={() => power('restart')} loading={busy === 'restart'} disabled={!!busy || state === 'stopping'} icon={<RotateCw aria-hidden />}>
                {t.restart}
              </Button>
              <Button size="sm" variant="secondary" onClick={() => power('stop')} loading={busy === 'stop'} disabled={!!busy || state === 'offline' || state === 'stopping'} icon={<Square aria-hidden />}>
                {t.stop}
              </Button>
              {state === 'stopping' && (
                <Button size="sm" variant="danger" onClick={() => power('kill')} loading={busy === 'kill'} disabled={!!busy} icon={<Power aria-hidden />}>
                  {t.kill}
                </Button>
              )}
            </div>
          )}
        </div>
        {live && (
          <dl className="mt-5 grid grid-cols-2 gap-x-6 gap-y-3 text-sm sm:grid-cols-4">
            <div>
              <dt className="text-[13px] text-subtle">{t.cpu}</dt>
              <dd className="mt-0.5 text-white tabular-nums">{online ? `${live.cpuPercent} %` : '–'}</dd>
            </div>
            <div>
              <dt className="text-[13px] text-subtle">{t.memory}</dt>
              <dd className="mt-0.5 text-white tabular-nums">
                {online ? fmt.mb(Math.round(live.memoryBytes / 1048576)) : '–'} <span className="text-subtle">/ {fmt.mb(Math.round(live.memoryLimitBytes / 1048576))}</span>
              </dd>
            </div>
            <div>
              <dt className="text-[13px] text-subtle">{t.disk}</dt>
              <dd className="mt-0.5 text-white tabular-nums">{fmt.mb(Math.round(live.diskBytes / 1048576))}</dd>
            </div>
            <div>
              <dt className="text-[13px] text-subtle">{t.uptime}</dt>
              <dd className="mt-0.5 text-white tabular-nums">{state === 'running' && live.uptimeMs > 0 ? fmt.duration(Math.round(live.uptimeMs / 1000), { maxUnits: 2 }) : '–'}</dd>
            </div>
          </dl>
        )}
        {installing && <p className="mt-4 text-sm text-blue-200">{t.installing}</p>}
        {!active && <p className="mt-4 text-sm text-muted">{t.notActive}</p>}
        {eula && (
          <div className="mt-5 rounded-lg border border-amber-400/40 bg-amber-400/[0.06] p-4">
            <p className="text-sm font-semibold text-amber-100">{t.eulaTitle}</p>
            <p className="mt-1 text-sm text-amber-100/90">{t.eulaText}</p>
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <Button size="sm" onClick={() => power('start', true)} loading={busy === 'start'}>
                {t.eulaAccept}
              </Button>
              <a href="https://aka.ms/MinecraftEULA" target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-sm text-amber-100 underline underline-offset-4">
                {t.eulaLink} <ArrowUpRight className="size-3.5" aria-hidden />
              </a>
            </div>
          </div>
        )}
        {error && (
          <div className="mt-4">
            <Alert tone="error">{error}</Alert>
          </div>
        )}
      </section>

      {active && (
        <section className="surface overflow-hidden">
          <div className="flex border-b border-line px-2" role="tablist">
            {(['console', 'ports'] as const).map((key) => (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={tab === key}
                onClick={() => setTab(key)}
                className={cn('-mb-px inline-flex items-center gap-2 border-b-2 px-4 py-3 text-sm', tab === key ? 'border-blue-500 text-white' : 'border-transparent text-muted hover:text-white')}
              >
                {key === 'console' ? <SquareTerminal className="size-4" aria-hidden /> : <Cable className="size-4" aria-hidden />}
                {t.tabs[key]}
              </button>
            ))}
          </div>
          <div className="p-4 sm:p-5">{tab === 'console' ? <Console id={id} online={online} onState={() => void refresh()} /> : <Ports detail={detail} onChange={setDetail} />}</div>
        </section>
      )}
      {detail.server.panelUrl && (
        <p className="flex flex-wrap items-center gap-x-3 gap-y-2 text-sm text-muted">
          {t.panelHint}
          <ButtonLink href={detail.server.panelUrl} external variant="secondary" size="sm">
            {dict.common.openPanel} <ArrowUpRight aria-hidden />
          </ButtonLink>
        </p>
      )}
    </div>
  );
}

function Console({ id, online, onState }: { id: string; online: boolean; onState: () => void }) {
  const t = useDict().manage;
  const [lines, setLines] = useState<string[]>([]);
  const [source, setSource] = useState<'connecting' | 'live' | 'log' | 'ended'>('connecting');
  const [generation, setGeneration] = useState(0);
  const [command, setCommand] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const onStateRef = useRef(onState);
  onStateRef.current = onState;

  useEffect(() => {
    setLines([]);
    setSource('connecting');
    const es = new EventSource(`/api/v1/servers/${id}/console`);
    const add = (line: string) => setLines((prev) => (prev.length >= MAX_LINES ? [...prev.slice(prev.length - MAX_LINES + 1), line] : [...prev, line]));
    es.addEventListener('line', (e) => {
      try {
        add(JSON.parse((e as MessageEvent).data) as string);
      } catch {
        /* ungültige Zeile */
      }
    });
    es.addEventListener('info', (e) => {
      try {
        setSource((JSON.parse((e as MessageEvent).data) as { source: string }).source === 'live' ? 'live' : 'log');
      } catch {
        setSource('live');
      }
    });
    es.addEventListener('status', () => onStateRef.current());
    es.addEventListener('end', () => {
      setSource('ended');
      es.close();
    });
    // Abbruch (z. B. Netzwerk): nicht endlos neu verbinden – der Nutzer kann es selbst anstoßen
    es.onerror = () => {
      setSource('ended');
      es.close();
    };
    return () => es.close();
  }, [id, generation]);

  useEffect(() => {
    const el = box.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [lines]);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    const value = command.trim();
    if (!value) return;
    setSending(true);
    setError(null);
    try {
      await api(`/servers/${id}/command`, { body: { command: value } });
      setCommand('');
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : String(err));
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3 text-[13px] text-subtle">
        <span className="inline-flex items-center gap-1.5">
          <StatusDot tone={source === 'live' ? 'green' : source === 'log' ? 'blue' : source === 'connecting' ? 'amber' : 'gray'} />
          {source === 'live' ? t.consoleLive : source === 'log' ? t.consoleLog : source === 'connecting' ? t.consoleConnecting : t.consoleEnded}
        </span>
        {source === 'ended' && (
          <button type="button" onClick={() => setGeneration((g) => g + 1)} className="text-blue-400 hover:text-blue-300">
            {t.reconnect}
          </button>
        )}
      </div>
      <div
        ref={box}
        onScroll={(e) => {
          const el = e.currentTarget;
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
        }}
        className="h-[420px] overflow-auto rounded-lg border border-line bg-black/60 p-3 font-mono text-[12.5px] leading-relaxed text-gray-200"
        aria-live="off"
      >
        {lines.length === 0 ? <p className="text-subtle">{t.consoleEmpty}</p> : lines.map((line, i) => <div key={i} className="break-words whitespace-pre-wrap">{line}</div>)}
      </div>
      <form onSubmit={send} className="flex gap-2">
        <label htmlFor="console-command" className="sr-only">
          {t.commandLabel}
        </label>
        <input
          id="console-command"
          className="input flex-1 font-mono text-sm"
          value={command}
          onChange={(e) => setCommand(e.target.value)}
          placeholder={online ? t.commandPlaceholder : t.commandOffline}
          disabled={!online}
          maxLength={300}
          autoComplete="off"
          spellCheck={false}
        />
        <Button type="submit" size="sm" loading={sending} disabled={!online || !command.trim()} icon={<Send aria-hidden />}>
          {t.send}
        </Button>
      </form>
      {error && <Alert tone="error">{error}</Alert>}
    </div>
  );
}

function Ports({ detail, onChange }: { detail: ServerDetailDTO; onChange: (d: ServerDetailDTO) => void }) {
  const t = useDict().manage;
  const [busy, setBusy] = useState<number | 'add' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const ports = detail.ports;
  if (!ports) return <Alert tone="warning">{t.portsUnavailable}</Alert>;
  const full = ports.items.length >= ports.limit;

  async function run(key: number | 'add', path: string) {
    setBusy(key);
    setError(null);
    try {
      onChange(await api<ServerDetailDTO>(path, { body: {} }));
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-4">
      <p className="max-w-2xl text-sm leading-relaxed text-muted">{t.portsText(ports.limit)}</p>
      <ul className="divide-y divide-line overflow-hidden rounded-lg border border-line">
        {ports.items.map((p) => (
          <li key={p.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
            <div className="min-w-0">
              <p className="font-mono text-sm text-white">
                {p.host}:{p.port}
              </p>
              {p.primary && <p className="text-[12px] text-blue-300">{t.portsPrimary}</p>}
              {p.notes && <p className="text-[12px] text-subtle">{p.notes}</p>}
            </div>
            {!p.primary && (
              <Button
                size="sm"
                variant="ghost"
                loading={busy === p.id}
                disabled={busy !== null}
                onClick={() => window.confirm(t.portRemoveConfirm(p.port)) && void run(p.id, `/servers/${detail.server.id}/ports/${p.id}/delete`)}
                icon={<Trash2 aria-hidden />}
              >
                {t.portRemove}
              </Button>
            )}
          </li>
        ))}
      </ul>
      {full ? (
        <p className="text-sm text-subtle">{t.portsFull}</p>
      ) : (
        <Button size="sm" variant="secondary" loading={busy === 'add'} disabled={busy !== null} onClick={() => void run('add', `/servers/${detail.server.id}/ports`)} icon={<Plus aria-hidden />}>
          {t.portAdd}
        </Button>
      )}
      {error && <Alert tone="error">{error}</Alert>}
    </div>
  );
}
