import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { localePath, serverPagePath, type ServerDetailDTO } from '@chfree/shared';
import { CopyText } from '@/components/my/client-bits';
import { ServerManager } from '@/components/my/server-manage';
import { Alert } from '@/components/ui/primitives';
import { getDict, resolveLang } from '@/i18n';
import { apiServer, requireUser } from '@/lib/api/server';
import { pageMetadata } from '@/lib/seo';

type Props = { params: Promise<{ lang: string; id: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const lang = await resolveLang(params);
  return pageMetadata(lang, 'myServers', { title: getDict(lang).manage.metaTitle, noIndex: true });
}

export const dynamic = 'force-dynamic';

/** Ein Server unter „Meine Server“: Zustand, Starten/Stoppen, Konsole und Ports */
export default async function ServerPage({ params }: Props) {
  const lang = await resolveLang(params);
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const d = getDict(lang);
  await requireUser(lang, 'myServers', serverPagePath(lang, id));
  const res = await apiServer<ServerDetailDTO>(`/servers/${id}`, lang);
  if (!res.ok && res.status === 404) notFound();

  return (
    <div className="container-wide py-10 sm:py-14">
      <div>
        <Link href={localePath(lang, 'myServers')} className="inline-flex items-center gap-1.5 text-sm text-muted hover:text-white">
          <ArrowLeft className="size-4" aria-hidden /> {d.manage.back}
        </Link>
        {!res.ok ? (
          <div className="mt-6">
            <Alert tone="error">{d.my.loadError}</Alert>
          </div>
        ) : (
          <>
            <div className="mt-4 mb-6">
              <h1 className="text-2xl font-semibold tracking-[-0.02em] break-words text-white sm:text-3xl">{res.data.server.name}</h1>
              <p className="mt-1.5 text-[13px] text-subtle">
                {d.start.products[res.data.server.kind].name} · {res.data.server.planName} · {res.data.server.serverTypeName}
                {res.data.server.kind === 'minecraft' && <> {res.data.server.version === 'latest' ? d.common.latestShort : res.data.server.version}</>}
              </p>
              {res.data.server.address && (
                <div className="mt-2">
                  <CopyText value={res.data.server.address} />
                </div>
              )}
            </div>
            <ServerManager initial={res.data} />
          </>
        )}
      </div>
    </div>
  );
}
