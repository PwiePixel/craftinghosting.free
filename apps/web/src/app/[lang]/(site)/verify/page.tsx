import type { Metadata } from 'next';
import { VerifyFlow } from '@/components/start/verify-flow';
import { getDict, resolveLang } from '@/i18n';
import { pageMetadata } from '@/lib/seo';

type Props = { params: Promise<{ lang: string }>; searchParams: Promise<Record<string, string | undefined>> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const lang = await resolveLang(params);
  return pageMetadata(lang, 'verify', { title: getDict(lang).verify.metaTitle, noIndex: true });
}

export default async function VerifyPage({ params, searchParams }: Props) {
  await resolveLang(params);
  const { token } = await searchParams;
  return (
    <div className="container-page py-14 sm:py-20">
      <VerifyFlow token={token} />
    </div>
  );
}
