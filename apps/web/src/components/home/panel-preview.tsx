import type { Locale } from '@chfree/shared';
import { getDict } from '@/i18n';
import { panelHost } from '@/lib/site';

/**
 * Illustration: So sieht der Server später im Pterodactyl-Panel aus –
 * inklusive Status-Beschreibung und automatischem Hinweis im Chat.
 * Rein dekorativ (keine echten Daten).
 */
export function PanelPreview({ lang }: { lang: Locale }) {
  const t = getDict(lang).panelPreview;
  return (
    <div className="relative" aria-hidden>
      <div className="absolute -inset-8 rounded-[2rem] bg-blue-600/10 blur-3xl" />
      <div className="relative overflow-hidden rounded-xl border border-line-strong bg-surface shadow-2xl shadow-black/50">
        {/* Fensterleiste */}
        <div className="flex items-center gap-3 border-b border-line px-4 py-3">
          <div className="flex gap-1.5">
            <span className="size-2.5 rounded-full bg-white/15" />
            <span className="size-2.5 rounded-full bg-white/15" />
            <span className="size-2.5 rounded-full bg-white/15" />
          </div>
          <span className="rounded-md bg-white/[0.04] px-2.5 py-1 font-mono text-[11px] text-subtle">{panelHost}</span>
        </div>

        <div className="space-y-3 p-4 sm:p-5">
          {/* Server-Zeile wie in Pterodactyl */}
          <div className="rounded-lg border border-line bg-surface-2 p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate font-medium text-white">{t.serverName}</p>
                <p className="mt-0.5 truncate text-xs text-subtle">{t.description}</p>
              </div>
              <span className="flex shrink-0 items-center gap-1.5 rounded-full bg-emerald-400/10 px-2 py-0.5 text-[11px] font-medium text-emerald-300">
                <span className="size-1.5 rounded-full bg-emerald-400" /> {t.online}
              </span>
            </div>
            <div className="mt-4 grid grid-cols-3 gap-3">
              {[
                ['CPU', '34 %', 0.34],
                ['RAM', lang === 'en' ? '2.6 / 6 GB' : '2,6 / 6 GB', 0.43],
                ['Disk', lang === 'en' ? '1.3 / 15 GB' : '1,3 / 15 GB', 0.09],
              ].map(([k, v, r]) => (
                <div key={k as string}>
                  <p className="text-[11px] text-subtle">{k}</p>
                  <p className="text-sm font-medium text-gray-200">{v}</p>
                  <div className="mt-1.5 h-1 rounded-full bg-white/10">
                    <div className="h-1 rounded-full bg-blue-500" style={{ width: `${(r as number) * 100}%` }} />
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Konsole mit automatischem Hinweis */}
          <div className="rounded-lg border border-line bg-[#07090e] p-3.5 font-mono text-[11.5px] leading-relaxed">
            <p className="text-subtle">[12:04:11] Steve joined the game</p>
            <p className="text-subtle">[12:07:32] Done preparing level &quot;world&quot;</p>
            <p className="text-blue-300">{t.console}</p>
          </div>
        </div>
      </div>
    </div>
  );
}
