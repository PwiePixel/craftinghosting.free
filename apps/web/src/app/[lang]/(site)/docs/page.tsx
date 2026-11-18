import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowRight, BookOpen, Lock } from 'lucide-react';
import { localePath } from '@chfree/shared';
import { partnerDoc } from '@/content/docs/partner';
import { userDocs } from '@/content/docs/user';
import { getDict, resolveLang } from '@/i18n';
import { getCurrentUser } from '@/lib/api/server';
import { pageMetadata } from '@/lib/seo';

type Props = { params: Promise<{ lang: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const lang = await resolveLang(params);
  const t = getDict(lang).docs;
  return pageMetadata(lang, 'docs', { title: t.metaTitle, description: t.metaDescription });
}

export default async function DocsPage({ params }: Props) {
  const lang = await resolveLang(params);
  const d = getDict(lang);
  const t = d.docs;
  // Die Partner-Dokumentation taucht nur für Partner-Konten (und Admins) auf
  const me = await getCurrentUser();
  const partner = !!me?.user.partner;
  const base = localePath(lang, 'docs');
  return (
    <div className="container-page py-12 sm:py-16">
      <div className="mx-auto max-w-4xl">
        <h1 className="text-3xl font-semibold tracking-[-0.02em] text-white sm:text-4xl">{t.title}</h1>
        <p className="mt-3 max-w-2xl text-lg leading-relaxed text-muted">{t.intro}</p>
        <ul className="mt-10 grid gap-4 sm:grid-cols-2">
          {userDocs.map((page) => (
            <li key={page.slug}>
              <Link href={`${base}/${page.slug}`} className="surface group flex h-full flex-col p-6 transition-colors hover:border-white/25">
                <BookOpen className="size-5 text-blue-400" aria-hidden />
                <h2 className="mt-4 text-lg font-semibold text-white">{page.title[lang]}</h2>
                <p className="mt-1.5 flex-1 text-sm leading-relaxed text-muted">{page.summary[lang]}</p>
                <span className="mt-4 inline-flex items-center gap-1 text-sm text-blue-400 group-hover:text-blue-300">
                  {t.read} <ArrowRight className="size-4" aria-hidden />
                </span>
              </Link>
            </li>
          ))}
          {partner && (
            <li>
              <Link href={`${base}/${partnerDoc.slug}`} className="surface group flex h-full flex-col border-violet-400/40 p-6 transition-colors hover:border-violet-300/70">
                <Lock className="size-5 text-violet-300" aria-hidden />
                <h2 className="mt-4 flex flex-wrap items-center gap-2 text-lg font-semibold text-white">
                  {partnerDoc.title[lang]} <span className="rounded bg-violet-500/20 px-1.5 py-0.5 text-[11px] font-medium text-violet-200">{t.partnerBadge}</span>
                </h2>
                <p className="mt-1.5 flex-1 text-sm leading-relaxed text-muted">{t.partnerCard}</p>
                <span className="mt-4 inline-flex items-center gap-1 text-sm text-violet-300 group-hover:text-violet-200">
                  {t.read} <ArrowRight className="size-4" aria-hidden />
                </span>
              </Link>
            </li>
          )}
        </ul>
        <p className="mt-10 text-sm text-subtle">
          {t.more}{' '}
          <Link href={localePath(lang, 'faq')} className="text-gray-300 hover:text-white">
            FAQ
          </Link>
        </p>
      </div>
    </div>
  );
}
