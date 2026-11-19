import type { Metadata } from 'next';
import { ArrowUpRight } from 'lucide-react';
import type { StatusDTO } from '@chfree/shared';
import { StatusBoard } from '@/components/status/status-board';
import { getDict, resolveLang } from '@/i18n';
import { apiPublic } from '@/lib/api/server';
import { pageMetadata } from '@/lib/seo';
import { site } from '@/lib/site';

type Props = { params: Promise<{ lang: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const lang = await resolveLang(params);
  const t = getDict(lang).status;
  return pageMetadata(lang, 'status', { title: t.metaTitle, description: t.metaDescription });
}



export default async function StatusPage({ params }: Props) {
  const lang = await resolveLang(params);
  const t = getDict(lang).status;
  const res = await apiPublic<{ status: StatusDTO }>('/status', 0);
  const status = res.ok ? res.data.status : null;
  // Überschrift, Einleitung und Link sind im Admin-Bereich einstellbar (leer = Standardtext)
  const page = status?.page;
  return (
    <div className="container-page py-14 sm:py-20">
      <div className="mx-auto max-w-5xl">
        <p className="label">Status</p>
        <h1 className="h2 mt-3">{page?.title[lang] || t.title}</h1>
        <p className="lead mt-4">{page?.intro[lang] || t.intro}</p>
        <div className="mt-10">
          <StatusBoard initial={status} />
        </div>
        {(page?.showExternalLink ?? true) && (
          <p className="mt-8 text-sm text-muted">
            {t.allServices}{' '}
            <a href={site.statusUrl} target="_blank" rel="noopener" className="inline-flex items-center gap-0.5 text-blue-400 hover:text-blue-300">
              {site.statusUrl.replace(/^https?:\/\//, '')} <ArrowUpRight className="size-3.5" aria-hidden />
            </a>
          </p>
        )}
      </div>
    </div>
  );
}
