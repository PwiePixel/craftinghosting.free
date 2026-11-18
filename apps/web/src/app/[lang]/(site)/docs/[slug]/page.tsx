import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { freeHostingConfig } from '@chfree/shared';
import { DocView } from '@/components/docs/doc-view';
import { userDocs } from '@/content/docs/user';
import { getDict, resolveLang } from '@/i18n';
import { site } from '@/lib/site';

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
  const page = userDocs.find((p) => p.slug === slug);
  if (!page) notFound();
  const vars = { panel: site.panelUrl.replace(/^https?:\/\//, ''), days: String(freeHostingConfig.cycle.days) };
  return <DocView page={page} lang={lang} vars={vars} back={getDict(lang).docs.back} />;
}
