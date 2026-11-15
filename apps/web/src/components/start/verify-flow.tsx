'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { ArrowUpRight, Check, CircleX, LoaderCircle } from 'lucide-react';
import { localePath, type VerifyResult, type WaitlistInfo } from '@chfree/shared';
import { ButtonLink } from '@/components/ui/button';
import { useDict, useLang } from '@/i18n/client';
import { api, ApiClientError } from '@/lib/api/client';
import { PanelSetupForm } from './panel-setup-form';

type State =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'setup'; email: string }
  | { kind: 'done'; email: string; panelUrl: string; existing: boolean }
  | { kind: 'waitlist'; waitlist: WaitlistInfo };

export function DoneCard({ email, panelUrl, existing }: { email: string; panelUrl: string; existing: boolean }) {
  const lang = useLang();
  const t = useDict();
  const v = t.verify;
  return (
    <div>
      <ol className="space-y-3 text-sm">
        {v.doneSteps(existing).map((step, i) => (
          <li key={step} className="flex items-center gap-3 text-gray-200">
            <span className={i < 2 ? 'flex size-5 items-center justify-center rounded-full bg-emerald-400/15' : 'flex size-5 items-center justify-center'}>
              {i < 2 ? <Check className="size-3 text-emerald-400" strokeWidth={3} /> : <LoaderCircle className="size-4 animate-spin text-blue-400" />}
            </span>
            {step}
          </li>
        ))}
      </ol>
      <div className="mt-7 rounded-lg border border-line bg-background p-5">
        <p className="text-sm font-medium text-white">{v.loginTitle}</p>
        <dl className="mt-3 space-y-1.5 text-sm">
          <div className="flex gap-3">
            <dt className="w-20 shrink-0 text-subtle">{v.loginPanel}</dt>
            <dd className="font-mono text-gray-200">{panelUrl.replace(/^https?:\/\//, '')}</dd>
          </div>
          <div className="flex gap-3">
            <dt className="w-20 shrink-0 text-subtle">{v.loginEmail}</dt>
            <dd className="break-all text-gray-200">{email}</dd>
          </div>
          <div className="flex gap-3">
            <dt className="w-20 shrink-0 text-subtle">{v.loginPassword}</dt>
            <dd className="text-gray-200">{existing ? v.passwordExisting : v.passwordNew}</dd>
          </div>
        </dl>
      </div>
      <p className="mt-4 text-[13px] leading-relaxed text-subtle">{v.doneHint}</p>
      <div className="mt-7 flex flex-col gap-3 sm:flex-row">
        <ButtonLink href={panelUrl} external size="lg" className="sm:flex-1">
          {t.common.toPanel} <ArrowUpRight aria-hidden />
        </ButtonLink>
        <ButtonLink href={localePath(lang, 'myServers')} variant="secondary" size="lg">
          {t.common.myServers}
        </ButtonLink>
      </div>
    </div>
  );
}

export function VerifyFlow({ token }: { token?: string }) {
  const router = useRouter();
  const lang = useLang();
  const t = useDict();
  const v = t.verify;
  const [state, setState] = useState<State>(token ? { kind: 'loading' } : { kind: 'error', message: v.incomplete });
  const started = useRef(false);

  useEffect(() => {
    if (!token || started.current) return;
    started.current = true;
    api<VerifyResult>('/auth/verify', { body: { token } })
      .then((res) => {
        if (res.next === 'overview') {
          router.replace(localePath(lang, 'myServers'));
          router.refresh();
        } else if (res.next === 'waitlist' && res.waitlist) {
          setState({ kind: 'waitlist', waitlist: res.waitlist });
        } else if (res.next === 'panel_setup') {
          setState({ kind: 'setup', email: res.user.email });
        } else {
          setState({ kind: 'done', email: res.user.email, panelUrl: res.panelUrl, existing: res.existingPanelAccount });
        }
      })
      .catch((err) => setState({ kind: 'error', message: err instanceof ApiClientError ? err.message : v.failed }));
  }, [token, router, lang, v.failed]);

  return (
    <div className="surface mx-auto max-w-lg p-7 sm:p-9">
      {state.kind === 'loading' && (
        <div className="flex flex-col items-center py-10 text-center">
          <LoaderCircle className="size-8 animate-spin text-blue-400" aria-hidden />
          <p className="mt-4 text-muted">{v.checking}</p>
        </div>
      )}

      {state.kind === 'error' && (
        <div>
          <CircleX className="size-8 text-red-400" aria-hidden />
          <h1 className="mt-5 text-2xl font-semibold tracking-tight text-white">{v.invalidTitle}</h1>
          <p className="mt-2 text-muted">{state.message}</p>
          <div className="mt-7 flex flex-wrap gap-3">
            <ButtonLink href={localePath(lang, 'login')}>{v.requestNew}</ButtonLink>
            <ButtonLink href={localePath(lang, 'start')} variant="secondary">
              {t.common.createServer}
            </ButtonLink>
          </div>
        </div>
      )}

      {state.kind === 'setup' && (
        <div>
          <p className="flex items-center gap-2 text-sm font-medium text-emerald-300">
            <Check className="size-4" aria-hidden /> {v.confirmed}
          </p>
          <h1 className="mt-3 text-2xl font-semibold tracking-tight text-white">{v.setupTitle}</h1>
          <p className="mt-2 leading-relaxed text-muted">{v.setupText}</p>
          <div className="mt-7">
            <PanelSetupForm
              email={state.email}
              onDone={(r) => setState({ kind: 'done', email: state.email, panelUrl: r.panelUrl, existing: r.existingPanelAccount })}
            />
          </div>
        </div>
      )}

      {state.kind === 'done' && (
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-white">{v.doneTitle}</h1>
          <p className="mt-2 text-muted">{v.doneText}</p>
          <div className="mt-7">
            <DoneCard email={state.email} panelUrl={state.panelUrl} existing={state.existing} />
          </div>
        </div>
      )}

      {state.kind === 'waitlist' && (
        <div>
          <p className="flex items-center gap-2 text-sm font-medium text-emerald-300">
            <Check className="size-4" aria-hidden /> {v.confirmed}
          </p>
          <h1 className="mt-3 text-2xl font-semibold tracking-tight text-white">{t.early.verifyTitle}</h1>
          <p className="mt-2 leading-relaxed text-muted">{t.early.verifyText}</p>
          <dl className="mt-7 grid grid-cols-2 gap-4 rounded-lg border border-line bg-background p-5">
            <div>
              <dt className="text-[13px] text-subtle">{t.early.positionLabel}</dt>
              <dd className="mt-0.5 text-2xl font-semibold text-white">#{state.waitlist.position}</dd>
            </div>
            <div>
              <dt className="text-[13px] text-subtle">{t.early.hardwareLabel}</dt>
              <dd className="mt-0.5 text-base font-semibold text-white">{t.early.tiers[state.waitlist.tier]}</dd>
            </div>
          </dl>
          <p className="mt-4 text-[13px] leading-relaxed text-subtle">{t.early.tierNote[state.waitlist.tier]}</p>
          <div className="mt-7">
            <ButtonLink href={localePath(lang, 'myServers')} size="lg">
              {t.common.myServers}
            </ButtonLink>
          </div>
        </div>
      )}

      {state.kind !== 'loading' && state.kind !== 'done' && state.kind !== 'waitlist' && (
        <p className="mt-8 border-t border-line pt-5 text-[13px] text-subtle">
          {v.problems}{' '}
          <Link href={localePath(lang, 'faq')} className="text-gray-300 hover:text-white">
            FAQ
          </Link>
          {v.problemsAfter}
        </p>
      )}
    </div>
  );
}
