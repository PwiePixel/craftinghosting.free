import type { Metadata } from 'next';
import Link from 'next/link';
import { localePath } from '@chfree/shared';
import { CancelSubscriptionForm } from '@/components/extras/cancel-form';
import { getDict, resolveLang } from '@/i18n';
import { pageMetadata } from '@/lib/seo';

type Props = { params: Promise<{ lang: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const lang = await resolveLang(params);
  const t = getDict(lang).extras.cancelPage;
  return pageMetadata(lang, 'cancelSubscription', { title: t.metaTitle, description: t.metaDescription });
}

/** „Verträge hier kündigen“: Abos kostenpflichtiger Extras lassen sich hier ohne Anmeldung kündigen (§ 312k BGB) */
export default async function CancelSubscriptionPage({ params }: Props) {
  const lang = await resolveLang(params);
  const d = getDict(lang);
  const t = d.extras.cancelPage;
  return (
    <div className="container-page py-14 sm:py-20">
      <div className="mx-auto max-w-2xl">
        <h1 className="h2">{t.title}</h1>
        <p className="lead mt-4">{t.intro}</p>
        <div className="surface mt-8 p-6">
          <CancelSubscriptionForm />
        </div>
        <p className="mt-6 text-sm leading-relaxed text-muted">{t.inAccount}</p>
        <p className="mt-2 text-[13px] text-subtle">
          <Link href={localePath(lang, 'extrasTerms')} className="underline underline-offset-4 hover:text-white">
            {d.extras.termsLink}
          </Link>
        </p>
      </div>
    </div>
  );
}
