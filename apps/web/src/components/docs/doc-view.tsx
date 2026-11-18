/** Darstellung einer Doku-Seite (/docs) aus ihren Bausteinen */
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { localePath, type Locale } from '@chfree/shared';
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

export function DocView({ page, lang, vars, back, badge }: { page: DocPage; lang: Locale; vars: DocVars; back: string; badge?: string }) {
  return (
    <div className="container-page py-12 sm:py-16">
      <div className="mx-auto max-w-3xl">
        <Link href={localePath(lang, 'docs')} className="inline-flex items-center gap-1.5 text-sm text-muted hover:text-white">
          <ArrowLeft className="size-4" aria-hidden /> {back}
        </Link>
        {badge && <p className="mt-6 inline-block rounded bg-violet-500/20 px-2 py-0.5 text-[12px] font-medium text-violet-200">{badge}</p>}
        <h1 className={badge ? 'mt-3 text-3xl font-semibold tracking-[-0.02em] text-white sm:text-4xl' : 'mt-6 text-3xl font-semibold tracking-[-0.02em] text-white sm:text-4xl'}>{page.title[lang]}</h1>
        <p className="mt-3 text-lg leading-relaxed text-muted">{fill(page.summary[lang], vars)}</p>
        {page.sections.length > 2 && (
          <nav className="mt-8 rounded-lg border border-line p-4" aria-label={page.title[lang]}>
            <ul className="space-y-1.5 text-sm">
              {page.sections.map((s, i) => (
                <li key={s.heading.de}>
                  <a href={`#s${i + 1}`} className="text-blue-400 hover:text-blue-300">
                    {fill(s.heading[lang], vars)}
                  </a>
                </li>
              ))}
            </ul>
          </nav>
        )}
        {page.sections.map((s, i) => (
          <section key={s.heading.de} id={`s${i + 1}`} className="mt-10 scroll-mt-24">
            <h2 className="text-xl font-semibold text-white">{fill(s.heading[lang], vars)}</h2>
            <div className="mt-4 space-y-4">
              {s.blocks.map((b, j) => (
                <BlockView key={j} block={b} lang={lang} vars={vars} />
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
