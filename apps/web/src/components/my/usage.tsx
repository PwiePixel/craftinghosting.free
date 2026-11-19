'use client';

/**
 * Anzeigen für Server-Auslastung: Balken (Meter), Verlaufsdiagramm (Fläche mit Fadenkreuz und Tooltip) und ein
 * gemeinsamer Abruf der Live-Werte aller eigenen Server (eine Anfrage für die ganze Übersicht).
 *
 * Farben: eine Reihe je Diagramm → Akzentblau; Balken zeigen den Zustand (Blau → Warnung → kritisch) und tragen
 * immer auch den Zahlenwert als Text (Farbe nie allein).
 */
import { useEffect, useId, useRef, useState, useSyncExternalStore, type KeyboardEvent, type PointerEvent } from 'react';
import type { ServerLiveDTO } from '@chfree/shared';

export const ACCENT = '#3987e5';
const WARNING = '#fab219';
const CRITICAL = '#d03b3b';
const SURFACE = '#10131c';

/* ------------------------------------------------------------ Balken */

export function Meter({ value, max, label, className }: { value: number; max: number; label: string; className?: string }) {
  const ratio = max > 0 ? Math.max(0, Math.min(1, value / max)) : 0;
  const color = ratio >= 0.9 ? CRITICAL : ratio >= 0.75 ? WARNING : ACCENT;
  return (
    <div
      role="meter"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={Math.round(value)}
      className={`h-1.5 w-full overflow-hidden rounded-full ${className ?? ''}`}
      style={{ background: 'rgba(57, 135, 229, 0.16)' }}
    >
      <div className="h-full rounded-full transition-[width] duration-500" style={{ width: `${Math.max(ratio > 0 ? 2 : 0, ratio * 100)}%`, background: color }} />
    </div>
  );
}

/* ------------------------------------------------------------ Verlaufsdiagramm */

export interface Sample {
  at: number;
  value: number;
}

/**
 * Fläche über die Zeit (eine Reihe). Fadenkreuz + Tooltip bei Zeiger und Tastatur (Pfeiltasten), Werte zusätzlich als
 * Text im Kopf des Diagramms – der Tooltip ist nie der einzige Weg zum Wert.
 */
export function AreaChart({
  samples,
  max,
  format,
  timeFormat,
  label,
  height = 150,
}: {
  samples: Sample[];
  max: number;
  format: (v: number) => string;
  timeFormat: (at: number) => string;
  label: string;
  height?: number;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(600);
  const [hover, setHover] = useState<number | null>(null);
  const gradientId = useId();
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => entry && setWidth(Math.max(120, Math.round(entry.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const top = 8;
  const bottom = 4;
  const h = height - top - bottom;
  const n = samples.length;
  const scaleMax = Math.max(max, ...samples.map((s) => s.value), 1);
  const x = (i: number) => (n <= 1 ? width : (i / (n - 1)) * width);
  const y = (v: number) => top + h - (Math.max(0, v) / scaleMax) * h;
  const line = samples.map((s, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(s.value).toFixed(1)}`).join(' ');
  const area = n > 0 ? `${line} L${x(n - 1).toFixed(1)},${top + h} L${x(0).toFixed(1)},${top + h} Z` : '';
  const active = hover !== null && hover < n ? hover : null;
  const shown = active ?? n - 1;

  const pick = (e: PointerEvent<HTMLDivElement>) => {
    if (n === 0) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const rel = (e.clientX - rect.left) / rect.width;
    setHover(Math.max(0, Math.min(n - 1, Math.round(rel * (n - 1)))));
  };
  const keys = (e: KeyboardEvent<HTMLDivElement>) => {
    if (n === 0) return;
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault();
      setHover((cur) => Math.max(0, Math.min(n - 1, (cur ?? n - 1) + (e.key === 'ArrowLeft' ? -1 : 1))));
    } else if (e.key === 'Escape') setHover(null);
  };

  return (
    <div>
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <p className="text-[13px] text-subtle">{label}</p>
        <p className="text-sm font-semibold text-white tabular-nums">{n > 0 ? format(samples[shown]!.value) : '–'}</p>
      </div>
      <div
        ref={box}
        className="relative touch-none rounded-md outline-none focus-visible:ring-2 focus-visible:ring-blue-500/60"
        style={{ height }}
        tabIndex={0}
        role="img"
        aria-label={`${label}: ${n > 0 ? format(samples[n - 1]!.value) : '–'}`}
        onPointerMove={pick}
        onPointerDown={pick}
        onPointerLeave={() => setHover(null)}
        onBlur={() => setHover(null)}
        onKeyDown={keys}
      >
        <svg width={width} height={height} className="block" aria-hidden>
          <defs>
            <linearGradient id={gradientId} x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor={ACCENT} stopOpacity="0.14" />
              <stop offset="100%" stopColor={ACCENT} stopOpacity="0.02" />
            </linearGradient>
          </defs>
          {[0, 0.5, 1].map((f) => (
            <line key={f} x1={0} x2={width} y1={top + h * f} y2={top + h * f} stroke="rgba(255,255,255,0.07)" strokeWidth={1} />
          ))}
          {n > 1 && <path d={area} fill={`url(#${gradientId})`} />}
          {n > 1 && <path d={line} fill="none" stroke={ACCENT} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />}
          {active !== null && <line x1={x(active)} x2={x(active)} y1={top} y2={top + h} stroke="rgba(255,255,255,0.35)" strokeWidth={1} />}
          {n > 0 && <circle cx={x(shown)} cy={y(samples[shown]!.value)} r={4} fill={ACCENT} stroke={SURFACE} strokeWidth={2} />}
        </svg>
        <span className="pointer-events-none absolute top-1 right-1 text-[11px] text-subtle tabular-nums">{format(scaleMax)}</span>
        {active !== null && (
          <div
            className="pointer-events-none absolute z-10 -translate-x-1/2 rounded-md border border-line-strong bg-surface-2 px-2.5 py-1.5 text-center shadow-lg"
            style={{ left: Math.min(width - 60, Math.max(60, x(active))), top: -6 }}
          >
            <p className="text-sm font-semibold whitespace-nowrap text-white tabular-nums">{format(samples[active]!.value)}</p>
            <p className="text-[11px] whitespace-nowrap text-subtle">{timeFormat(samples[active]!.at)}</p>
          </div>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------ Live-Werte aller eigenen Server */

type LiveMap = Record<string, ServerLiveDTO | null>;
let liveState: LiveMap | null = null;
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | null = null;

async function loadAll() {
  try {
    const res = await fetch('/api/v1/servers/live', { credentials: 'same-origin', cache: 'no-store', headers: { Accept: 'application/json' } });
    if (!res.ok) return;
    liveState = ((await res.json()) as { live: LiveMap }).live;
    for (const l of listeners) l();
  } catch {
    /* nächster Versuch */
  }
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  if (!timer) {
    void loadAll();
    timer = setInterval(() => void loadAll(), 10_000);
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && timer) {
      clearInterval(timer);
      timer = null;
    }
  };
}

/** Live-Werte eines Servers in der Übersicht (alle Kacheln teilen sich eine Anfrage alle 10 Sekunden) */
export function useServerLive(id: string): ServerLiveDTO | null | undefined {
  const map = useSyncExternalStore(
    subscribe,
    () => liveState,
    () => null,
  );
  return map ? (map[id] ?? null) : undefined;
}
