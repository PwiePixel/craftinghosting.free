'use client';

/**
 * Server auf der Website verwalten: Seitenleiste (Dashboard, Konsole, Ports, Links ins Panel), Live-Kacheln mit
 * Auslastung, Verlaufsdiagramme, Konsole mit Filtern und Befehlseingabe, Ports.
 * Alle Aktionen gehen über unsere API – dort gelten dieselben Regeln wie im Panel (Fair-Use, Sperren, EULA).
 * Abfragen ruhen, solange der Tab im Hintergrund ist (schont das Panel-Kontingent).
 */
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import {
  ArrowUpRight,
  Archive,
  Cable,
  Check,
  ChevronsRight,
  Copy,
  Cpu,
  FolderOpen,
  HardDrive,
  LayoutDashboard,
  MemoryStick,
  Play,
  Power,
  RotateCw,
  Square,
  SquareTerminal,
  Trash2,
  Eraser,
  Plus,
} from 'lucide-react';
import { formatDateTime, formatDuration, formatMb, freeHostingConfig, type ServerDetailDTO, type ServerLiveDTO, type ServerPowerAction } from '@chfree/shared';
import { Button } from '@/components/ui/button';
import { Alert, StatusDot } from '@/components/ui/primitives';
import { useDict, useLang } from '@/i18n/client';
import { api, ApiClientError } from '@/lib/api/client';
import { cn } from '@/lib/utils';
import { AreaChart, Meter, type Sample } from './usage';

type Live = ServerLiveDTO;
type View = 'dashboard' | 'console' | 'ports';
const MAX_LINES = 600;
const HISTORY = 60; // 5 Minuten bei 5 Sekunden Abstand
const LIVE_EVERY_MS = 5000;
const DETAIL_EVERY_MS = 30_000;

function tone(state: Live['state'] | undefined): 'green' | 'amber' | 'red' | 'blue' | 'gray' {
  if (state === 'running') return 'green';
  if (state === 'starting' || state === 'stopping') return 'amber';
  if (state === 'installing') return 'blue';
  return 'gray';
}

/** Ruft `fn` in festen Abständen auf – nur, solange die Seite sichtbar ist; beim Zurückkehren sofort einmal */
function useVisibleInterval(fn: () => void, ms: number, enabled = true) {
  const ref = useRef(fn);
  ref.current = fn;
  useEffect(() => {
    if (!enabled) return;
    let timer: ReturnType<typeof setInterval> | null = null;
    const start = () => {
      if (timer || document.hidden) return;
      timer = setInterval(() => ref.current(), ms);
    };
    const stop = () => {
      if (timer) clearInterval(timer);
      timer = null;
    };
    const onVisibility = () => {
      if (document.hidden) stop();
      else {
        ref.current();
        start();
      }
    };
    start();
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      stop();
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [ms, enabled]);
}

export function ServerManager({ initial }: { initial: ServerDetailDTO }) {
  const dict = useDict();
  const t = dict.manage;
  const lang = useLang();
  const [detail, setDetail] = useState(initial);
  const [live, setLive] = useState<Live | null>(initial.live);
  const [view, setView] = useState<View>('console');
  const [busy, setBusy] = useState<ServerPowerAction | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [eula, setEula] = useState(false);
  const [cpu, setCpu] = useState<Sample[]>([]);
  const [mem, setMem] = useState<Sample[]>([]);
  const id = initial.server.id;
  const s = detail.server;
  const state = live?.state;
  const installing = s.powerState === 'installing' || state === 'installing';
  const active = s.status === 'active';
  const online = state === 'running' || state === 'starting';

  // Ansicht aus der Adresse (#konsole, #ports, #dashboard) – Zurück-Knopf und Lesezeichen funktionieren
  useEffect(() => {
    const fromHash = () => {
      const h = window.location.hash.replace('#', '');
      setView(h === 'ports' ? 'ports' : h === 'dashboard' ? 'dashboard' : 'console');
    };
    fromHash();
    window.addEventListener('hashchange', fromHash);
    return () => window.removeEventListener('hashchange', fromHash);
  }, []);
  const go = (next: View) => {
    setView(next);
    window.history.replaceState(null, '', `#${next === 'console' ? 'konsole' : next}`);
  };

  const record = useCallback((l: Live | null) => {
    if (!l) return;
    const at = Date.now();
    const on = l.state === 'running' || l.state === 'starting';
    setCpu((prev) => [...prev.slice(-(HISTORY - 1)), { at, value: on ? l.cpuPercent : 0 }]);
    setMem((prev) => [...prev.slice(-(HISTORY - 1)), { at, value: on ? l.memoryBytes / 1048576 : 0 }]);
  }, []);
  useEffect(() => record(initial.live), [initial.live, record]);

  const pollLive = useCallback(async () => {
    try {
      const res = await api<{ live: Live | null }>(`/servers/${id}/live`);
      setLive(res.live);
      record(res.live);
    } catch {
      /* nächster Takt */
    }
  }, [id, record]);
  const refresh = useCallback(async () => {
    try {
      const next = await api<ServerDetailDTO>(`/servers/${id}`);
      setDetail((cur) => ({ ...next, ports: cur.ports }));
      setLive(next.live);
    } catch {
      /* nächster Takt */
    }
  }, [id]);
  useVisibleInterval(() => void pollLive(), LIVE_EVERY_MS, active);
  useVisibleInterval(() => void refresh(), DETAIL_EVERY_MS, active);

  async function power(action: ServerPowerAction, acceptEula = false) {
    if (action === 'kill' && !window.confirm(t.killConfirm)) return;
    setBusy(action);
    setError(null);
    try {
      const next = await api<ServerDetailDTO>(`/servers/${id}/power`, { body: { action, ...(acceptEula ? { acceptEula: true } : {}) } });
      setDetail((cur) => ({ ...next, ports: cur.ports }));
      setLive(next.live);
      setEula(false);
    } catch (err) {
      if (err instanceof ApiClientError && err.code === 'eula_required') setEula(true);
      else setError(err instanceof ApiClientError ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  const fmtMb = (mb: number) => formatMb(Math.round(mb), lang);
  const nav: { key: View; label: string; icon: ReactNode }[] = [
    { key: 'dashboard', label: t.tabs.dashboard, icon: <LayoutDashboard className="size-4" aria-hidden /> },
    { key: 'console', label: t.tabs.console, icon: <SquareTerminal className="size-4" aria-hidden /> },
  ];
  const manageNav: { key: View; label: string; icon: ReactNode }[] = [{ key: 'ports', label: t.tabs.ports, icon: <Cable className="size-4" aria-hidden /> }];
  const panelLinks = s.panelUrl
    ? [
        { href: `${s.panelUrl.replace(/\/$/, '')}/files`, label: t.files, icon: <FolderOpen className="size-4" aria-hidden /> },
        { href: `${s.panelUrl.replace(/\/$/, '')}/backups`, label: t.backups, icon: <Archive className="size-4" aria-hidden /> },
      ]
    : [];

  const navButton = (item: { key: View; label: string; icon: ReactNode }) => (
    <button
      key={item.key}
      type="button"
      onClick={() => go(item.key)}
      aria-current={view === item.key ? 'page' : undefined}
      className={cn(
        'flex shrink-0 items-center gap-2.5 rounded-lg px-3 py-2 text-sm whitespace-nowrap transition-colors',
        view === item.key ? 'bg-blue-500/15 text-white ring-1 ring-blue-500/30' : 'text-muted hover:bg-white/5 hover:text-white',
      )}
    >
      {item.icon}
      {item.label}
    </button>
  );

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-[210px_minmax(0,1fr)]">
      {/* Seitenleiste – auf dem Handy eine waagrechte Leiste */}
      <aside className="min-w-0 lg:sticky lg:top-24 lg:self-start">
        <nav aria-label={s.name} className="scrollbar-none flex gap-1.5 overflow-x-auto lg:flex-col lg:gap-1">
          <p className="hidden px-3 pt-1 pb-1.5 text-[11px] font-semibold tracking-[0.08em] text-subtle uppercase lg:block">{t.navGeneral}</p>
          {nav.map(navButton)}
          <p className="hidden px-3 pt-4 pb-1.5 text-[11px] font-semibold tracking-[0.08em] text-subtle uppercase lg:block">{t.navManage}</p>
          {manageNav.map(navButton)}
          {panelLinks.length > 0 && <p className="hidden px-3 pt-4 pb-1.5 text-[11px] font-semibold tracking-[0.08em] text-subtle uppercase lg:block">{t.navPanel}</p>}
          {panelLinks.map((l) => (
            <a key={l.href} href={l.href} target="_blank" rel="noopener" className="flex shrink-0 items-center gap-2.5 rounded-lg px-3 py-2 text-sm whitespace-nowrap text-muted transition-colors hover:bg-white/5 hover:text-white">
              {l.icon}
              {l.label}
              <ArrowUpRight className="ml-auto size-3.5 opacity-60" aria-hidden />
            </a>
          ))}
        </nav>
      </aside>

      <div className="min-w-0 space-y-5">
        {/* Zustand und Steuerung */}
        <section className="surface flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
          <div className="flex items-center gap-2.5 text-[15px] font-medium text-white">
            <StatusDot tone={tone(installing ? 'installing' : state)} />
            {installing ? t.state.installing : state ? t.state[state] : t.liveUnavailable}
            {state === 'running' && live && live.uptimeMs > 0 && <span className="text-[13px] font-normal text-subtle">· {formatDuration(Math.round(live.uptimeMs / 1000), { maxUnits: 2 }, lang)}</span>}
          </div>
          {active && !installing && (
            <div className="flex flex-wrap gap-2">
              <Button size="sm" onClick={() => power('start')} loading={busy === 'start'} disabled={!!busy || online || state === 'stopping'} icon={<Play aria-hidden />}>
                {t.start}
              </Button>
              <Button size="sm" variant="secondary" onClick={() => power('restart')} loading={busy === 'restart'} disabled={!!busy || state === 'stopping'} icon={<RotateCw aria-hidden />}>
                {t.restart}
              </Button>
              {state === 'stopping' ? (
                <Button size="sm" variant="danger" onClick={() => power('kill')} loading={busy === 'kill'} disabled={!!busy} icon={<Power aria-hidden />}>
                  {t.kill}
                </Button>
              ) : (
                <Button size="sm" variant="secondary" onClick={() => power('stop')} loading={busy === 'stop'} disabled={!!busy || state === 'offline'} icon={<Square aria-hidden />}>
                  {t.stop}
                </Button>
              )}
            </div>
          )}
        </section>
        {installing && <Alert tone="info">{t.installing}</Alert>}
        {!active && <Alert tone="warning">{t.notActive}</Alert>}
        {eula && (
          <div className="rounded-xl border border-amber-400/40 bg-amber-400/[0.06] p-4">
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
        {error && <Alert tone="error">{error}</Alert>}

        {/* Auslastung */}
        {active && (
          <div className="grid gap-3 sm:grid-cols-3">
            <StatTile icon={<Cpu className="size-5" aria-hidden />} label={t.cpu} value={online && live ? `${live.cpuPercent.toFixed(1)} %` : '0 %'} limit={`${s.limits.cpuPercent} %`} ratio={online && live ? live.cpuPercent / s.limits.cpuPercent : 0} />
            <StatTile
              icon={<MemoryStick className="size-5" aria-hidden />}
              label={t.memory}
              value={online && live ? fmtMb(live.memoryBytes / 1048576) : fmtMb(0)}
              limit={fmtMb(s.limits.memoryMb)}
              ratio={online && live ? live.memoryBytes / 1048576 / s.limits.memoryMb : 0}
            />
            <StatTile icon={<HardDrive className="size-5" aria-hidden />} label={t.disk} value={live ? fmtMb(live.diskBytes / 1048576) : '–'} limit={fmtMb(s.limits.diskMb)} ratio={live ? live.diskBytes / 1048576 / s.limits.diskMb : 0} />
          </div>
        )}

        {active && view === 'dashboard' && <Dashboard detail={detail} live={live} cpu={cpu} mem={mem} />}
        {active && view === 'console' && !installing && <Console key={`${id}-${installing}`} id={id} online={online} />}
        {active && view === 'ports' && <Ports id={id} />}
      </div>
    </div>
  );
}

function StatTile({ icon, label, value, limit, ratio }: { icon: ReactNode; label: string; value: string; limit: string; ratio: number }) {
  return (
    <div className="surface flex items-center gap-3.5 p-4">
      <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-blue-500/15 text-blue-300 ring-1 ring-blue-500/25">{icon}</span>
      <div className="min-w-0 flex-1">
        <p className="text-[13px] text-subtle">{label}</p>
        <p className="mt-0.5 truncate text-[15px] font-semibold text-white tabular-nums">
          {value} <span className="text-[13px] font-normal text-subtle">/ {limit}</span>
        </p>
        <Meter value={ratio * 100} max={100} label={label} className="mt-2" />
      </div>
    </div>
  );
}

function Dashboard({ detail, live, cpu, mem }: { detail: ServerDetailDTO; live: Live | null; cpu: Sample[]; mem: Sample[] }) {
  const dict = useDict();
  const t = dict.manage;
  const my = dict.my;
  const lang = useLang();
  const s = detail.server;
  const tz = freeHostingConfig.fairUse.timezone;
  const time = (at: number) => new Intl.DateTimeFormat(lang === 'de' ? 'de-DE' : 'en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: tz }).format(at);
  const state = live?.state;
  const f = s.fairUse;
  const rows: [string, ReactNode][] = [
    [t.infoStatus, state ? t.state[state] : t.liveUnavailable],
    [t.infoAddress, s.address ?? '–'],
    [t.infoSoftware, `${s.serverTypeName}${s.kind === 'minecraft' ? ` ${s.version === 'latest' ? dict.common.latestShort : s.version}` : ''}`],
    [t.infoPlan, s.planName],
    [t.infoRuntime, s.cycle.unlimited ? my.noEnd : my.activeUntil(formatDateTime(s.cycle.endsAt, tz, lang), s.cycle.secondsRemaining < 2 * 86400 ? formatDuration(s.cycle.secondsRemaining, {}, lang) : my.days(s.cycle.daysRemaining))],
    [t.infoFairUse, !s.fairUseEnabled ? my.alwaysOn : f.pausedUntil ? my.pausedUntil(formatDateTime(f.pausedUntil, tz, lang)) : f.online && f.autoStopAt ? my.autoStop(formatDateTime(f.autoStopAt, tz, lang)) : my.rulesShort],
  ];
  return (
    <div className="space-y-5">
      <div className="grid gap-4 xl:grid-cols-2">
        <div className="surface p-4 sm:p-5">
          <AreaChart samples={cpu} max={s.limits.cpuPercent} format={(v) => `${v.toFixed(1)} %`} timeFormat={time} label={t.cpuChart} />
        </div>
        <div className="surface p-4 sm:p-5">
          <AreaChart samples={mem} max={s.limits.memoryMb} format={(v) => formatMb(Math.round(v), lang)} timeFormat={time} label={t.memoryChart} />
        </div>
      </div>
      <p className="text-[12px] text-subtle">{t.chartWindow}</p>
      <section className="surface overflow-hidden">
        <h2 className="border-b border-line px-5 py-3.5 text-sm font-semibold text-white">{t.info}</h2>
        <dl className="divide-y divide-line">
          {rows.map(([k, v]) => (
            <div key={k} className="grid gap-1 px-5 py-3 sm:grid-cols-[200px_minmax(0,1fr)]">
              <dt className="text-[13px] text-subtle">{k}</dt>
              <dd className="text-sm break-words text-gray-100">{v}</dd>
            </div>
          ))}
        </dl>
      </section>
    </div>
  );
}

type Level = 'info' | 'warn' | 'error';
const levelOf = (line: string): Level => (/\b(ERROR|SEVERE|FATAL)\b|\/ERROR\]|Exception\b/i.test(line) ? 'error' : /\bWARN(ING)?\b|\/WARN\]/i.test(line) ? 'warn' : 'info');

function Console({ id, online }: { id: string; online: boolean }) {
  const t = useDict().manage;
  const [lines, setLines] = useState<{ text: string; level: Level }[]>([]);
  const [filter, setFilter] = useState<'all' | Level>('all');
  const [source, setSource] = useState<'connecting' | 'live' | 'log' | 'ended'>('connecting');
  const [generation, setGeneration] = useState(0);
  const [command, setCommand] = useState('');
  const [history, setHistory] = useState<string[]>([]);
  const [historyPos, setHistoryPos] = useState<number | null>(null);
  const [sending, setSending] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const stick = useRef(true);

  useEffect(() => {
    setLines([]);
    setSource('connecting');
    const es = new EventSource(`/api/v1/servers/${id}/console`);
    const add = (text: string) => setLines((prev) => [...(prev.length >= MAX_LINES ? prev.slice(prev.length - MAX_LINES + 1) : prev), { text, level: levelOf(text) }]);
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
    es.addEventListener('end', () => {
      setSource('ended');
      es.close();
    });
    // Abbruch (z. B. Netzwerk): nicht endlos neu verbinden – „Neu verbinden“ stößt es an
    es.onerror = () => {
      setSource('ended');
      es.close();
    };
    return () => es.close();
  }, [id, generation]);

  const counts = useMemo(() => ({ all: lines.length, info: lines.filter((l) => l.level === 'info').length, warn: lines.filter((l) => l.level === 'warn').length, error: lines.filter((l) => l.level === 'error').length }), [lines]);
  const shown = filter === 'all' ? lines : lines.filter((l) => l.level === filter);

  useEffect(() => {
    const el = box.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [shown.length, filter]);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    const value = command.trim();
    if (!value) return;
    setSending(true);
    setError(null);
    try {
      await api(`/servers/${id}/command`, { body: { command: value } });
      setHistory((h) => [...h.filter((x) => x !== value), value].slice(-30));
      setHistoryPos(null);
      setCommand('');
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : String(err));
    } finally {
      setSending(false);
    }
  }
  // Pfeil hoch/runter: frühere Befehle
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (history.length === 0 || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return;
    e.preventDefault();
    const pos = historyPos === null ? (e.key === 'ArrowUp' ? history.length - 1 : null) : e.key === 'ArrowUp' ? Math.max(0, historyPos - 1) : historyPos + 1 >= history.length ? null : historyPos + 1;
    setHistoryPos(pos);
    setCommand(pos === null ? '' : history[pos]!);
  };

  const chips: ('all' | Level)[] = ['all', 'info', 'warn', 'error'];
  return (
    <section className="surface overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-3 py-2.5 sm:px-4">
        <div className="scrollbar-none flex gap-1 overflow-x-auto" role="group" aria-label={t.tabs.console}>
          {chips.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setFilter(c)}
              aria-pressed={filter === c}
              className={cn('rounded-md px-2.5 py-1 text-[13px] whitespace-nowrap transition-colors', filter === c ? 'bg-white/10 text-white' : 'text-muted hover:text-white')}
            >
              {t.filters[c]} <span className="text-subtle tabular-nums">({counts[c]})</span>
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1">
          <span className="mr-2 hidden items-center gap-1.5 text-[12px] text-subtle sm:inline-flex">
            <StatusDot tone={source === 'live' ? 'green' : source === 'log' ? 'blue' : source === 'connecting' ? 'amber' : 'gray'} />
            {source === 'live' ? t.consoleLive : source === 'log' ? t.consoleLog : source === 'connecting' ? t.consoleConnecting : t.consoleEnded}
          </span>
          {source === 'ended' && (
            <button type="button" onClick={() => setGeneration((g) => g + 1)} className="mr-1 text-[13px] text-blue-400 hover:text-blue-300">
              {t.reconnect}
            </button>
          )}
          <button
            type="button"
            title={copied ? t.copied : t.copy}
            aria-label={copied ? t.copied : t.copy}
            onClick={() => {
              void navigator.clipboard
                ?.writeText(shown.map((l) => l.text).join('\n'))
                .then(() => {
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1500);
                })
                .catch(() => {});
            }}
            className="inline-flex size-8 items-center justify-center rounded-md text-muted hover:bg-white/5 hover:text-white"
          >
            {copied ? <Check className="size-4" aria-hidden /> : <Copy className="size-4" aria-hidden />}
          </button>
          <button type="button" title={t.clear} aria-label={t.clear} onClick={() => setLines([])} className="inline-flex size-8 items-center justify-center rounded-md text-muted hover:bg-white/5 hover:text-white">
            <Eraser className="size-4" aria-hidden />
          </button>
        </div>
      </div>
      <div
        ref={box}
        onScroll={(e) => {
          const el = e.currentTarget;
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
        }}
        className="scrollbar-none h-[440px] overflow-y-auto bg-[#07090e] px-4 py-3 font-mono text-[12.5px] leading-relaxed"
        tabIndex={0}
        aria-label={t.tabs.console}
      >
        {shown.length === 0 ? (
          <p className="text-subtle">{t.consoleEmpty}</p>
        ) : (
          shown.map((l, i) => (
            <div key={i} className={cn('break-words whitespace-pre-wrap', l.level === 'error' ? 'text-red-300' : l.level === 'warn' ? 'text-amber-200' : 'text-gray-200')}>
              {l.text}
            </div>
          ))
        )}
      </div>
      <form onSubmit={send} className="flex items-center gap-2 border-t border-line bg-white/[0.02] px-3 py-2.5 sm:px-4">
        <ChevronsRight className="size-4 shrink-0 text-subtle" aria-hidden />
        <label htmlFor="console-command" className="sr-only">
          {t.commandLabel}
        </label>
        <input
          id="console-command"
          className="h-9 min-w-0 flex-1 bg-transparent font-mono text-sm text-white placeholder:text-subtle focus:outline-none disabled:cursor-not-allowed"
          value={command}
          onChange={(e) => {
            setCommand(e.target.value);
            setHistoryPos(null);
          }}
          onKeyDown={onKey}
          placeholder={online ? t.commandPlaceholder : t.commandOffline}
          disabled={!online}
          maxLength={300}
          autoComplete="off"
          spellCheck={false}
        />
        <Button type="submit" size="sm" loading={sending} disabled={!online || !command.trim()}>
          {t.send}
        </Button>
      </form>
      {error && (
        <div className="border-t border-line p-3">
          <Alert tone="error">{error}</Alert>
        </div>
      )}
    </section>
  );
}

function Ports({ id }: { id: string }) {
  const t = useDict().manage;
  const [ports, setPorts] = useState<ServerDetailDTO['ports'] | undefined>(undefined);
  const [busy, setBusy] = useState<number | 'add' | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let off = false;
    api<ServerDetailDTO>(`/servers/${id}?ports=1`)
      .then((d) => !off && setPorts(d.ports))
      .catch(() => !off && setPorts(null));
    return () => {
      off = true;
    };
  }, [id]);

  async function run(key: number | 'add', path: string) {
    setBusy(key);
    setError(null);
    try {
      setPorts((await api<ServerDetailDTO>(path, { body: {} })).ports);
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  if (ports === undefined) return <section className="surface p-5 text-sm text-subtle">…</section>;
  if (!ports) return <Alert tone="warning">{t.portsUnavailable}</Alert>;
  const full = ports.items.length >= ports.limit;
  return (
    <section className="surface overflow-hidden">
      <div className="flex flex-col gap-3 border-b border-line px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
        <p className="max-w-2xl text-sm leading-relaxed text-muted">{t.portsText(ports.limit)}</p>
        {!full && (
          <Button size="sm" loading={busy === 'add'} disabled={busy !== null} onClick={() => void run('add', `/servers/${id}/ports`)} icon={<Plus aria-hidden />} className="shrink-0">
            {t.portAdd}
          </Button>
        )}
      </div>
      <ul className="divide-y divide-line">
        {ports.items.map((p) => (
          <li key={p.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5">
            <div className="flex min-w-0 items-center gap-3">
              <span className={cn('flex size-9 shrink-0 items-center justify-center rounded-lg ring-1', p.primary ? 'bg-blue-500/15 text-blue-300 ring-blue-500/25' : 'bg-white/5 text-muted ring-white/10')}>
                <Cable className="size-4" aria-hidden />
              </span>
              <div className="min-w-0">
                <p className="truncate font-mono text-sm text-white">
                  {p.host}:{p.port}
                </p>
                <p className="text-[12px] text-subtle">{p.primary ? t.portsPrimary : (p.notes ?? `Port ${p.port}`)}</p>
              </div>
            </div>
            {!p.primary && (
              <Button
                size="sm"
                variant="ghost"
                loading={busy === p.id}
                disabled={busy !== null}
                onClick={() => window.confirm(t.portRemoveConfirm(p.port)) && void run(p.id, `/servers/${id}/ports/${p.id}/delete`)}
                icon={<Trash2 aria-hidden />}
              >
                {t.portRemove}
              </Button>
            )}
          </li>
        ))}
      </ul>
      {full && <p className="border-t border-line px-5 py-3 text-[13px] text-subtle">{t.portsFull}</p>}
      {error && (
        <div className="border-t border-line p-3">
          <Alert tone="error">{error}</Alert>
        </div>
      )}
    </section>
  );
}
