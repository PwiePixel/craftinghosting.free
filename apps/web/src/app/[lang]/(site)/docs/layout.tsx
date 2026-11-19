import type { ReactNode } from 'react';
import { localePath } from '@chfree/shared';
import { DocsNav, type DocNavEntry } from '@/components/docs/docs-nav';
import { partnerDoc } from '@/content/docs/partner';
import { fill, type DocPage, type DocVars } from '@/content/docs/types';
import { userDocs } from '@/content/docs/user';
import { getDict, resolveLang } from '@/i18n';
import { docVars } from '@/content/docs/vars';


const entry = (page: DocPage, lang: 'de' | 'en', vars: DocVars): DocNavEntry => ({
  slug: page.slug,
  title: page.title[lang],
  sections: page.sections.map((s, i) => ({ id: `s${i + 1}`, title: fill(s.heading[lang], vars) })),
});

/** Dokumentation wie ein Wiki: Seitenleiste mit allen Seiten bleibt beim Wechseln stehen */
export default async function DocsLayout({ children, params }: { children: ReactNode; params: Promise<{ lang: string }> }) {
  const lang = await resolveLang(params);
  const t = getDict(lang).docs;
  const vars = docVars();
  return (
    <div className="container-page py-10 sm:py-14">
      <div className="grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-[250px_minmax(0,1fr)] lg:gap-12">
        <DocsNav
          base={localePath(lang, 'docs')}
          entries={userDocs.map((p) => entry(p, lang, vars))}
          partner={entry(partnerDoc, lang, vars)}
          labels={{ overview: t.overview, pages: t.pages, partnerSection: t.partnerSection, menu: t.menu }}
        />
        <div className="min-w-0">{children}</div>
      </div>
    </div>
  );
}
