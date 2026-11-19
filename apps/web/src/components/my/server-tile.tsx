'use client';

/** Live-Auslastung in einer Server-Kachel unter „Meine Server“ (CPU, Arbeitsspeicher, Speicher mit Grenze) */
import { formatMb } from '@chfree/shared';
import { useDict, useLang } from '@/i18n/client';
import { Meter, useServerLive } from './usage';

export function TileUsage({ id, limits }: { id: string; limits: { memoryMb: number; cpuPercent: number; diskMb: number } }) {
  const t = useDict().manage;
  const lang = useLang();
  const live = useServerLive(id);
  const online = live?.state === 'running' || live?.state === 'starting';
  const rows = [
    { label: t.cpu, value: online ? (live?.cpuPercent ?? 0) : 0, max: limits.cpuPercent, text: `${online ? (live?.cpuPercent ?? 0).toFixed(1) : '0'} % / ${limits.cpuPercent} %` },
    { label: t.memory, value: online ? (live?.memoryBytes ?? 0) / 1048576 : 0, max: limits.memoryMb, text: `${formatMb(online ? Math.round((live?.memoryBytes ?? 0) / 1048576) : 0, lang)} / ${formatMb(limits.memoryMb, lang)}` },
    { label: t.disk, value: (live?.diskBytes ?? 0) / 1048576, max: limits.diskMb, text: `${formatMb(Math.round((live?.diskBytes ?? 0) / 1048576), lang)} / ${formatMb(limits.diskMb, lang)}` },
  ];
  return (
    <dl className="grid grid-cols-3 gap-3">
      {rows.map((r) => (
        <div key={r.label} className="min-w-0">
          <dt className="text-[12px] text-subtle">{r.label}</dt>
          <dd className="mt-0.5 truncate text-[13px] text-gray-100 tabular-nums">{live === undefined ? '…' : r.text}</dd>
          <Meter value={r.value} max={r.max} label={r.label} className="mt-1.5" />
        </div>
      ))}
    </dl>
  );
}
