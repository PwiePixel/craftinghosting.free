'use client';

/**
 * Navigation der Dokumentation wie in einem Wiki: Alle Seiten stehen immer links (auf dem Handy als aufklappbare Liste),
 * die aktuelle ist hervorgehoben und zeigt ihre Abschnitte. Die Partner-Seite erscheint nur für Partner-Konten.
 */
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { BookOpen, ChevronDown, LayoutGrid, Lock } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface DocNavEntry {
  slug: string;
  title: string;
  sections: { id: string; title: string }[];
}

export function DocsNav({
  base,
  entries,
  partner,
  labels,
}: {
  base: string;
  entries: DocNavEntry[];
  partner: DocNavEntry;
  labels: { overview: string; pages: string; partnerSection: string; menu: string };
}) {
  const pathname = usePathname();
  const active = pathname.replace(/\/$/, '').startsWith(`${base}/`) ? pathname.replace(/\/$/, '').slice(base.length + 1) : null;
  const [isPartner, setIsPartner] = useState(active === partner.slug);
  const [open, setOpen] = useState(false);
  useEffect(() => setOpen(false), [pathname]);
  useEffect(() => {
    let off = false;
    fetch('/api/v1/auth/me', { credentials: 'same-origin', headers: { Accept: 'application/json' } })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { user?: { partner?: boolean } } | null) => !off && d?.user?.partner && setIsPartner(true))
      .catch(() => {});
    return () => {
      off = true;
    };
  }, []);

  const item = (e: DocNavEntry, icon: React.ReactNode) => {
    const current = active === e.slug;
    return (
      <li key={e.slug}>
        <Link
          href={`${base}/${e.slug}`}
          aria-current={current ? 'page' : undefined}
          className={cn('flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors', current ? 'bg-blue-500/15 font-medium text-white ring-1 ring-blue-500/30' : 'text-muted hover:bg-white/5 hover:text-white')}
        >
          {icon}
          <span className="min-w-0">{e.title}</span>
        </Link>
        {current && e.sections.length > 1 && (
          <ul className="mt-1 mb-2 ml-[1.15rem] space-y-0.5 border-l border-line pl-3">
            {e.sections.map((s) => (
              <li key={s.id}>
                <a href={`#${s.id}`} className="block rounded py-1 text-[13px] leading-snug text-subtle hover:text-white">
                  {s.title}
                </a>
              </li>
            ))}
          </ul>
        )}
      </li>
    );
  };

  const list = (
    <div className="space-y-5">
      <Link
        href={base}
        aria-current={active === null ? 'page' : undefined}
        className={cn('flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors', active === null ? 'bg-blue-500/15 font-medium text-white ring-1 ring-blue-500/30' : 'text-muted hover:bg-white/5 hover:text-white')}
      >
        <LayoutGrid className="size-4 shrink-0" aria-hidden /> {labels.overview}
      </Link>
      <div>
        <p className="px-3 pb-1.5 text-[11px] font-semibold tracking-[0.08em] text-subtle uppercase">{labels.pages}</p>
        <ul className="space-y-0.5">{entries.map((e) => item(e, <BookOpen className="size-4 shrink-0 text-blue-400" aria-hidden />))}</ul>
      </div>
      {isPartner && (
        <div>
          <p className="px-3 pb-1.5 text-[11px] font-semibold tracking-[0.08em] text-subtle uppercase">{labels.partnerSection}</p>
          <ul className="space-y-0.5">{item(partner, <Lock className="size-4 shrink-0 text-violet-300" aria-hidden />)}</ul>
        </div>
      )}
    </div>
  );

  const current = [...entries, partner].find((e) => e.slug === active);
  return (
    <>
      {/* Handy/Tablet: aufklappbar */}
      <div className="lg:hidden">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="surface flex w-full items-center justify-between gap-3 px-4 py-3 text-left text-sm text-white"
        >
          <span className="min-w-0 truncate">
            <span className="text-subtle">{labels.menu}: </span>
            {current?.title ?? labels.overview}
          </span>
          <ChevronDown className={cn('size-4 shrink-0 transition-transform', open && 'rotate-180')} aria-hidden />
        </button>
        {open && (
          <nav className="surface mt-2 p-3" aria-label={labels.menu}>
            {list}
          </nav>
        )}
      </div>
      {/* Desktop: feste Seitenleiste */}
      <nav aria-label={labels.menu} className="scrollbar-none hidden max-h-[calc(100vh-7rem)] overflow-y-auto lg:sticky lg:top-24 lg:block lg:self-start">
        {list}
      </nav>
    </>
  );
}

/** „Auf dieser Seite“ – hebt den Abschnitt hervor, der gerade im Blick ist */
export function DocToc({ sections, label }: { sections: { id: string; title: string }[]; label: string }) {
  const [current, setCurrent] = useState<string | null>(sections[0]?.id ?? null);
  useEffect(() => {
    const els = sections.map((s) => document.getElementById(s.id)).filter((el): el is HTMLElement => !!el);
    if (els.length === 0) return;
    const io = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible[0]) setCurrent(visible[0].target.id);
      },
      { rootMargin: '-90px 0px -65% 0px' },
    );
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, [sections]);
  return (
    <nav aria-label={label} className="scrollbar-none sticky top-24 max-h-[calc(100vh-7rem)] overflow-y-auto">
      <p className="pb-2 text-[11px] font-semibold tracking-[0.08em] text-subtle uppercase">{label}</p>
      <ul className="space-y-1 border-l border-line">
        {sections.map((s) => (
          <li key={s.id}>
            <a
              href={`#${s.id}`}
              className={cn('-ml-px block border-l py-1 pl-3 text-[13px] leading-snug transition-colors', current === s.id ? 'border-blue-400 text-white' : 'border-transparent text-subtle hover:text-white')}
            >
              {s.title}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}
