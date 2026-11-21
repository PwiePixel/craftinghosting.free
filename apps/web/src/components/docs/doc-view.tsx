/** Darstellung einer Doku-Seite (/docs) aus ihren Bausteinen */
import Link from 'next/link';
import { ArrowLeft, ArrowRight, Info, TriangleAlert } from 'lucide-react';
import type { Locale } from '@chfree/shared';
import { CodeBlock, CopyButton } from './code-block';
import { DocToc } from './docs-nav';
import { cn } from '@/lib/utils';
import { fill, type Block, type DocPage, type DocVars, type L } from '@/content/docs/types';

const text = (value: string | L, lang: Locale, vars: DocVars) => fill(typeof value === 'string' ? value : value[lang], vars);

type Labels = {
  onThisPage: string;
  prev: string;
  next: string;
  copy: string;
  copied: string;
};

/** Farben der HTTP-Methoden (immer zusammen mit dem Namen der Methode – Farbe nie allein) */
const METHOD: Record<string, string> = {
  GET: 'bg-emerald-400/12 text-emerald-300 ring-emerald-400/25',
  POST: 'bg-blue-400/12 text-blue-300 ring-blue-400/25',
  PUT: 'bg-violet-400/12 text-violet-300 ring-violet-400/25',
  PATCH: 'bg-amber-400/12 text-amber-200 ring-amber-400/25',
  DELETE: 'bg-red-400/12 text-red-300 ring-red-400/25',
};
const METHODS_CELL = /^(GET|POST|PUT|PATCH|DELETE)(\s*\/\s*(GET|POST|PUT|PATCH|DELETE))*$/;

function Methods({ value }: { value: string }) {
  return (
    <span className="flex flex-wrap gap-1">
      {value
        .split('/')
        .map((m) => m.trim())
        .map((m) => (
          <span key={m} className={cn('inline-block min-w-[52px] rounded px-1.5 py-0.5 text-center font-mono text-[11px] font-semibold tracking-wide ring-1 ring-inset', METHOD[m])}>
            {m}
          </span>
        ))}
    </span>
  );
}

/** Umbruch nur nach „/“ bzw. vor „?“ und „&“ – nie mitten in einem Wort */
const breakable = (s: string) => {
  const parts = s.split(/(?<=\/)|(?=[?&])/);
  // Kein Umbruch direkt nach dem ersten „/“
  if (parts[0] === '/' && parts.length > 1) parts.splice(0, 2, `/${parts[1]}`);
  return parts.flatMap((part, i) => (i === 0 ? [part] : [<wbr key={i} />, part]));
};

/** Pfad mit hervorgehobenen Platzhaltern ({id}) und abgesetzter Abfrage (?…) */
function PathText({ value }: { value: string }) {
  const q = value.indexOf('?');
  const path = q < 0 ? value : value.slice(0, q);
  const query = q < 0 ? null : value.slice(q);
  return (
    <span>
      {path.split(/(\{[^}]+\})/).map((part, i) =>
        part.startsWith('{') ? (
          <span key={i} className="whitespace-nowrap text-violet-300">
            {part}
          </span>
        ) : (
          <span key={i} className="text-gray-100">
            {breakable(part)}
          </span>
        ),
      )}
      {query && <span className="text-subtle">{breakable(query)}</span>}
    </span>
  );
}

function BlockView({ block, lang, vars, labels }: { block: Block; lang: Locale; vars: DocVars; labels: Labels }) {
  if ('p' in block) return <p className="leading-relaxed text-gray-300">{text(block.p, lang, vars)}</p>;
  if ('h3' in block) return <h3 className="pt-2 text-[15px] font-semibold text-white">{text(block.h3, lang, vars)}</h3>;
  if ('note' in block) {
    const warn = block.tone === 'warning';
    return (
      <div className={cn('flex gap-3 rounded-xl border p-4 text-sm leading-relaxed', warn ? 'border-amber-400/30 bg-amber-400/[0.07] text-amber-100' : 'border-blue-400/30 bg-blue-400/[0.07] text-blue-100')}>
        {warn ? <TriangleAlert className="mt-0.5 size-4 shrink-0 text-amber-300" aria-hidden /> : <Info className="mt-0.5 size-4 shrink-0 text-blue-300" aria-hidden />}
        <p>{text(block.note, lang, vars)}</p>
      </div>
    );
  }
  if ('code' in block) return <CodeBlock code={fill(block.code, vars)} title={block.title ? text(block.title, lang, vars) : undefined} labels={labels} />;
  if ('copy' in block) {
    const value = fill(block.copy.value, vars);
    return (
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border border-line bg-[#070910] py-1.5 pr-1.5 pl-4">
        <span className="text-[12px] text-subtle">{text(block.copy.label, lang, vars)}</span>
        <code className="min-w-0 flex-1 font-mono text-[13px] break-all text-emerald-300">{value}</code>
        <CopyButton value={value} label={labels} />
      </div>
    );
  }
  if ('changes' in block) {
    return (
      <ol className="relative space-y-6 border-l border-line pl-6">
        {block.changes.map((c) => (
          <li key={c.date} className="relative">
            <span className="absolute top-1.5 -left-[29px] size-2.5 rounded-full bg-blue-400 ring-4 ring-[#0b0e17]" aria-hidden />
            <time className="text-[13px] font-medium text-white tabular-nums">{new Date(`${c.date}T12:00:00Z`).toLocaleDateString(lang === 'de' ? 'de-DE' : 'en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}</time>
            <ul className="mt-2 list-disc space-y-1.5 pl-5 text-[15px] leading-relaxed text-gray-300">
              {c.items.map((item) => (
                <li key={item.de}>{text(item, lang, vars)}</li>
              ))}
            </ul>
          </li>
        ))}
      </ol>
    );
  }
  if ('ul' in block || 'ol' in block) {
    const items = 'ul' in block ? block.ul : block.ol;
    const List = 'ul' in block ? 'ul' : 'ol';
    return (
      <List className={'ul' in block ? 'list-disc space-y-2 pl-5 leading-relaxed text-gray-300 marker:text-gray-500' : 'list-decimal space-y-2 pl-5 leading-relaxed text-gray-300 marker:text-gray-500'}>
        {items.map((item) => (
          <li key={item.de}>{text(item, lang, vars)}</li>
        ))}
      </List>
    );
  }
  const hasMethods = block.table.rows.some((r) => typeof r[0] === 'string' && METHODS_CELL.test(r[0]));
  // Endpunkt-Tabellen (Methode · Pfad · Zweck) auf dem Handy als gestapelte Liste statt waagerecht scrollender Tabelle
  const stacked = hasMethods && block.table.head.length === 3;
  return (
    <>
      {stacked && (
        <ul className="divide-y divide-line rounded-xl border border-line sm:hidden">
          {block.table.rows.map((row, i) => (
            <li key={i} className="space-y-1.5 px-3.5 py-3">
              <div className="flex flex-wrap items-start gap-2">
                {typeof row[0] === 'string' && <Methods value={row[0]} />}
                <span className="min-w-0 font-mono text-[12.5px]">{typeof row[1] === 'string' ? <PathText value={fill(row[1], vars)} /> : text(row[1]!, lang, vars)}</span>
              </div>
              <p className="text-sm leading-relaxed text-gray-300">{text(row[2]!, lang, vars)}</p>
            </li>
          ))}
        </ul>
      )}
      <div className={cn('overflow-x-auto rounded-xl border border-line', stacked && 'hidden sm:block')}>
        <table className="w-full min-w-[560px] text-left text-sm">
          <thead className="bg-white/[0.03] text-[12px] tracking-wide text-subtle uppercase">
            <tr>
              {block.table.head.map((h) => (
                <th key={h.de} className="px-3.5 py-2.5 font-medium">
                  {text(h, lang, vars)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {block.table.rows.map((row, i) => (
              <tr key={i} className="transition-colors hover:bg-white/[0.02]">
                {row.map((cell, j) => {
                  const last = j === row.length - 1;
                  if (typeof cell === 'string' && j === 0 && hasMethods && METHODS_CELL.test(cell)) {
                    return (
                      <td key={j} className="w-[1%] px-3.5 py-2.5 align-top whitespace-nowrap">
                        <Methods value={cell} />
                      </td>
                    );
                  }
                  if (typeof cell === 'string' && !last) {
                    return (
                      <td key={j} className={cn('px-3.5 py-2.5 align-top font-mono text-[12.5px] text-gray-100', cell.startsWith('/') ? 'min-w-[200px]' : 'whitespace-pre-wrap')}>
                        {cell.startsWith('/') ? <PathText value={fill(cell, vars)} /> : fill(cell, vars)}
                      </td>
                    );
                  }
                  return (
                    <td key={j} className="px-3.5 py-2.5 align-top text-gray-300">
                      {text(cell, lang, vars)}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

export interface DocLink {
  href: string;
  title: string;
}

/** Inhalt einer Doku-Seite (die Seitenleiste kommt aus dem Layout der Dokumentation) */
export function DocView({ page, lang, vars, badge, prev, next, labels }: { page: DocPage; lang: Locale; vars: DocVars; badge?: string; prev?: DocLink | null; next?: DocLink | null; labels: Labels }) {
  const sections = page.sections.map((s, i) => ({
    id: `s${i + 1}`,
    title: fill(s.heading[lang], vars),
  }));
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-12 xl:grid-cols-[minmax(0,1fr)_220px]">
      <article className="min-w-0 max-w-4xl">
        {badge && <p className="mb-3 inline-block rounded bg-violet-500/20 px-2 py-0.5 text-[12px] font-medium text-violet-200">{badge}</p>}
        <h1 className="text-3xl font-semibold tracking-[-0.02em] text-white sm:text-4xl">{page.title[lang]}</h1>
        <p className="mt-3 text-lg leading-relaxed text-muted">{fill(page.summary[lang], vars)}</p>
        {page.sections.map((s, i) => (
          <section key={s.heading.de} id={`s${i + 1}`} className="mt-10 scroll-mt-24 border-t border-line pt-8 first-of-type:border-t-0 first-of-type:pt-0">
            <h2 className="text-xl font-semibold text-white">
              <a href={`#s${i + 1}`} className="hover:text-blue-300">
                {fill(s.heading[lang], vars)}
              </a>
            </h2>
            <div className="mt-4 space-y-4">
              {s.blocks.map((b, j) => (
                <BlockView key={j} block={b} lang={lang} vars={vars} labels={labels} />
              ))}
            </div>
          </section>
        ))}
        {(prev || next) && (
          <nav className="mt-14 grid gap-3 border-t border-line pt-8 sm:grid-cols-2" aria-label={`${labels.prev} / ${labels.next}`}>
            {prev ? (
              <Link href={prev.href} className="surface group flex items-center gap-3 p-4 transition-colors hover:border-white/25">
                <ArrowLeft className="size-4 shrink-0 text-subtle group-hover:text-white" aria-hidden />
                <span className="min-w-0">
                  <span className="block text-[12px] text-subtle">{labels.prev}</span>
                  <span className="block truncate text-sm font-medium text-white">{prev.title}</span>
                </span>
              </Link>
            ) : (
              <span />
            )}
            {next && (
              <Link href={next.href} className="surface group flex items-center justify-end gap-3 p-4 text-right transition-colors hover:border-white/25">
                <span className="min-w-0">
                  <span className="block text-[12px] text-subtle">{labels.next}</span>
                  <span className="block truncate text-sm font-medium text-white">{next.title}</span>
                </span>
                <ArrowRight className="size-4 shrink-0 text-subtle group-hover:text-white" aria-hidden />
              </Link>
            )}
          </nav>
        )}
      </article>
      {sections.length > 1 && (
        <aside className="hidden xl:block">
          <DocToc sections={sections} label={labels.onThisPage} />
        </aside>
      )}
    </div>
  );
}
