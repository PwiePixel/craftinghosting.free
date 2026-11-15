import Link from 'next/link';
import { cn } from '@/lib/utils';

/** Würfel-Bildmarke im Stil von Crafting Hosting – Standard, solange im Admin-Bereich kein eigenes Logo hochgeladen ist. */
export function CubeMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={cn('size-7', className)} aria-hidden>
      <path d="M16 2.5 28 9.25 16 16 4 9.25Z" fill="#7fb4fb" />
      <path d="M4 9.25 16 16v13.5L4 22.75Z" fill="#2f6fed" />
      <path d="M28 9.25 16 16v13.5l12-6.75Z" fill="#1d4ed8" />
    </svg>
  );
}

/** Hochgeladenes Logo aus dem Admin-Bereich (Einstellungen → Logo) */
export type CustomLogo = { url: string; mode: 'icon' | 'full' } | null | undefined;

/**
 * „Crafting Hosting“ + FREE – Hauptmarke bleibt vorne, das Free-Angebot als Zusatz.
 * Mit eigenem Logo: „icon“ ersetzt den Würfel (Schriftzug bleibt), „full“ ersetzt Würfel und Schriftzug.
 */
export function Logo({ className, href = '/', custom }: { className?: string; href?: string; custom?: CustomLogo }) {
  const full = custom?.mode === 'full';
  return (
    <Link href={href} className={cn('inline-flex items-center gap-2.5', className)} aria-label="CraftingHosting.free">
      {custom ? (
        // eslint-disable-next-line @next/next/no-img-element -- kommt aus der eigenen API, Größe unbekannt
        <img src={custom.url} alt="" className={cn('w-auto object-contain', full ? 'h-8 max-w-[220px]' : 'h-7 max-w-[44px]')} />
      ) : (
        <CubeMark />
      )}
      {!full && <span className="text-[17px] font-semibold tracking-tight whitespace-nowrap text-white">Crafting Hosting</span>}
      <span className="rounded-md bg-blue-500/15 px-1.5 py-0.5 text-[11px] font-semibold tracking-[0.08em] text-blue-300 uppercase">Free</span>
    </Link>
  );
}
