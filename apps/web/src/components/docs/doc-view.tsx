/** Darstellung einer Doku-Seite (/docs) aus ihren Bausteinen */
import Link from 'next/link';
import { ArrowLeft, ArrowRight } from 'lucide-react';
import type { Locale } from '@chfree/shared';
import { DocToc } from './docs-nav';
import { fill, type Block, type DocPage, type DocVars, type L } from '@/content/docs/types';

const text = (value: string | L, lang: Locale, vars: DocVars) => fill(typeof value === 'string' ? value : value[lang], vars);

function BlockView({ block, lang, vars }: { block: Block; lang: Locale; vars: DocVars }) {
  if ('p' in block) return <p className="leading-relaxed text-gray-300">{text(block.p, lang, vars)}</p>;
  if ('note' in block) return <p className="rounded-lg border border-blue-400/30 bg-blue-400/[0.07] p-4 text-sm leading-relaxed text-blue-100">{text(block.note, lang, vars)}</p>;
  if ('code' in block) {
    return (
      <pre className="overflow-x-auto rounded-lg border border-line bg-black/40 p-4 font-mono text-[12.5px] leading-relaxed text-gray-200">
        <code>{fill(block.code, vars)}</code>
      </pre>
    );
  }
  if ('ul' in block || 'ol' in block) {
    const items = 'ul' in block ? block.ul : block.ol;
    const List = 'ul' in block ? 'ul' : 'ol';
    return (
      <List className={'ul' in block ? 'list-disc space-y-2 pl-5 leading-relaxed text-gray-300' : 'list-decimal space-y-2 pl-5 leading-relaxed text-gray-300'}>
        {items.map((item) => (
          <li key={item.de}>{text(item, lang, vars)}</li>
        ))}
      </List>
    );
  }
  return (
    <div className="overflow-x-auto rounded-lg border border-line">
      <table className="w-full min-w-[520px] text-left text-sm">
        <thead className="bg-white/[0.03] text-[13px] text-subtle">
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
            <tr key={i}>
              {row.map((cell, j) => (
                <td key={j} className={j < row.length - 1 && typeof cell === 'string' ? 'px-3.5 py-2.5 align-top font-mono text-[12.5px] whitespace-pre-wrap text-gray-100' : 'px-3.5 py-2.5 align-top text-gray-300'}>
                  {text(cell, lang, vars)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export interface DocLink {
  href: string;
  title: string;
}

/** Inhalt einer Doku-Seite (die Seitenleiste kommt aus dem Layout der Dokumentation) */
export function DocView({ page, lang, vars, badge, prev, next, labels }: { page: DocPage; lang: Locale; vars: DocVars; badge?: string; prev?: DocLink | null; next?: DocLink | null; labels: { onThisPage: string; prev: string; next: string } }) {
  const sections = page.sections.map((s, i) => ({ id: `s${i + 1}`, title: fill(s.heading[lang], vars) }));
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
                <BlockView key={j} block={b} lang={lang} vars={vars} />
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
