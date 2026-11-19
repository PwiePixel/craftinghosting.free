import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { localePath } from '@chfree/shared';
import { DocView } from '@/components/docs/doc-view';
import { userDocs } from '@/content/docs/user';
import { getDict, resolveLang } from '@/i18n';
import { docVars } from '@/content/docs/vars';

type Props = { params: Promise<{ lang: string; slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const lang = await resolveLang(params);
  const page = userDocs.find((p) => p.slug === slug);
  if (!page) return {};
  return { title: `${page.title[lang]} – ${getDict(lang).docs.metaTitle}`, description: page.summary[lang] };
}

/** Öffentliche Doku-Seiten. Die Partner-Dokumentation liegt in einem eigenen, geschützten Ordner. */
export default async function DocPageRoute({ params }: Props) {
  const { slug } = await params;
  const lang = await resolveLang(params);
  const index = userDocs.findIndex((p) => p.slug === slug);
  const page = userDocs[index];
  if (!page) notFound();
  const t = getDict(lang).docs;
  const base = localePath(lang, 'docs');
  const link = (i: number) => (userDocs[i] ? { href: `${base}/${userDocs[i].slug}`, title: userDocs[i].title[lang] } : null);
  return <DocView page={page} lang={lang} vars={docVars()} prev={index === 0 ? { href: base, title: t.overview } : link(index - 1)} next={link(index + 1)} labels={{ onThisPage: t.onThisPage, prev: t.prev, next: t.next }} />;
}
