'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import { ArrowLeft, Check, MailCheck } from 'lucide-react';
import { createServerSchema, formatMb, freeHostingConfig, intlLocale, localePath, startSchema, tr } from '@chfree/shared';
import { Button } from '@/components/ui/button';
import { Alert, Field } from '@/components/ui/primitives';
import { useDict, useLang } from '@/i18n/client';
import { api } from '@/lib/api/client';
import { useForm } from '@/lib/use-form';
import { cn } from '@/lib/utils';

export interface Availability {
  plans: { id: string; available: boolean; capacity?: number | null; remaining?: number | null }[];
  serverTypes: { id: string; available: boolean }[];
}

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <section className="border-t border-line pt-7 first:border-t-0 first:pt-0">
      <h2 className="flex items-center gap-3 text-[15px] font-semibold text-white">
        <span className="flex size-6 items-center justify-center rounded-full bg-white/[0.06] font-mono text-xs text-muted">{n}</span>
        {title}
      </h2>
      <div className="mt-4">{children}</div>
    </section>
  );
}

export function StartForm({
  availability,
  initialPlan,
  userEmail,
  early = false,
}: {
  availability: Availability | null;
  initialPlan?: string;
  userEmail?: string;
  /** Vorregistrierung (Early Access): Platz auf der Warteliste statt sofortiger Erstellung */
  early?: boolean;
}) {
  const router = useRouter();
  const lang = useLang();
  const t = useDict();
  const s = t.start;
  const e = t.early;
  const { plans, serverTypes } = freeHostingConfig;
  const planOk = (id: string) => availability?.plans.find((a) => a.id === id)?.available ?? true;
  const typeOk = (id: string) => availability?.serverTypes.find((a) => a.id === id)?.available ?? true;

  const firstType = serverTypes.find((t) => t.recommended && typeOk(t.id)) ?? serverTypes.find((t) => typeOk(t.id)) ?? serverTypes[0]!;
  const [planId, setPlanId] = useState(initialPlan && planOk(initialPlan) ? initialPlan : (plans.find((p) => p.highlighted && planOk(p.id)) ?? plans[0]!).id);
  const [typeId, setTypeId] = useState(firstType.id);
  const [version, setVersion] = useState(firstType.defaultVersion);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [accept, setAccept] = useState(false);
  const [sentTo, setSentTo] = useState<string | null>(null);

  const loggedIn = !!userEmail;
  const form = useForm(loggedIn ? createServerSchema : startSchema);
  const type = useMemo(() => serverTypes.find((t) => t.id === typeId)!, [serverTypes, typeId]);
  const plan = plans.find((p) => p.id === planId)!;

  const values = { planId, serverType: typeId, version, name, email, acceptTerms: accept || undefined };

  function submit() {
    void form.submit(loggedIn ? { ...values, email: undefined } : values, async (data) => {
      if (loggedIn) {
        await api('/servers', { body: data });
        router.push(localePath(lang, 'myServers', { neu: early ? 'waitlist' : '1' }));
        router.refresh();
      } else {
        await api('/start', { body: data });
        setSentTo(email.trim().toLowerCase());
        window.scrollTo({ top: 0, behavior: 'smooth' });
      }
    });
  }

  if (sentTo) {
    return (
      <div className="surface p-8 sm:p-10">
        <span className="flex size-11 items-center justify-center rounded-full bg-blue-500/15">
          <MailCheck className="size-5 text-blue-400" aria-hidden />
        </span>
        <h1 className="mt-6 text-2xl font-semibold tracking-tight text-white">{s.sentTitle}</h1>
        <p className="mt-3 leading-relaxed text-muted">
          {s.sentBefore}
          <span className="text-white">{sentTo}</span>
          {early ? e.sentAfter(name.trim()) : s.sentAfter(name.trim())}
        </p>
        <ul className="mt-6 space-y-2 text-sm text-muted">
          <li>· {s.sentValid}</li>
          <li>· {s.sentSpam}</li>
        </ul>
        <div className="mt-8 flex flex-wrap gap-3">
          <Button variant="secondary" loading={form.pending} onClick={submit}>
            {s.resend}
          </Button>
          <Button variant="ghost" icon={<ArrowLeft />} onClick={() => setSentTo(null)}>
            {s.changeDetails}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <form
      noValidate
      className="surface space-y-7 p-6 sm:p-8"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      {form.error && <Alert tone="error">{form.error}</Alert>}

      <Step n={1} title={s.stepPlan}>
        <div className="grid gap-3 sm:grid-cols-2" role="radiogroup" aria-label={s.stepPlan}>
          {plans.map((p) => {
            const ok = planOk(p.id);
            const selected = p.id === planId;
            return (
              <label
                key={p.id}
                className={cn(
                  'relative cursor-pointer rounded-lg border p-4 transition-colors',
                  selected ? 'border-blue-500 bg-blue-500/[0.06]' : 'border-line-strong hover:border-white/25',
                  !ok && 'cursor-not-allowed opacity-50',
                )}
              >
                <input type="radio" name="plan" className="sr-only" checked={selected} disabled={!ok} onChange={() => setPlanId(p.id)} />
                <span className="flex items-center justify-between">
                  <span className="font-medium text-white">{p.name}</span>
                  <span className={cn('flex size-5 items-center justify-center rounded-full border', selected ? 'border-blue-500 bg-blue-500' : 'border-line-strong')}>
                    {selected && <Check className="size-3 text-white" strokeWidth={3} />}
                  </span>
                </span>
                <span className="mt-1 block text-[13px] text-muted">
                  {s.planSpecs(formatMb(p.memoryMb, lang), formatMb(p.diskMb, lang), p.cpuPercent)}
                </span>
                {!ok && <span className="mt-1 block text-[13px] text-amber-300">{s.soldOut}</span>}
                {ok && (() => {
                  const a = availability?.plans.find((x) => x.id === p.id);
                  return a?.capacity != null && a.remaining != null ? (
                    <span className="mt-1 block text-[13px] text-emerald-300">
                      {t.home.planLeft(a.remaining.toLocaleString(intlLocale(lang)), a.capacity.toLocaleString(intlLocale(lang)))}
                    </span>
                  ) : null;
                })()}
              </label>
            );
          })}
        </div>
      </Step>

      <Step n={2} title={s.stepSoftware}>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-5" role="radiogroup" aria-label={s.typeGroup}>
          {serverTypes.map((type_) => {
            const ok = typeOk(type_.id);
            const selected = type_.id === typeId;
            return (
              <label
                key={type_.id}
                title={ok ? tr(type_.description, lang) : s.soonTitle}
                className={cn(
                  'cursor-pointer rounded-lg border px-3 py-2.5 text-center text-sm transition-colors',
                  selected ? 'border-blue-500 bg-blue-500/[0.06] text-white' : 'border-line-strong text-gray-300 hover:border-white/25',
                  !ok && 'cursor-not-allowed opacity-40',
                )}
              >
                <input
                  type="radio"
                  name="type"
                  className="sr-only"
                  checked={selected}
                  disabled={!ok}
                  onChange={() => {
                    setTypeId(type_.id);
                    setVersion(type_.defaultVersion);
                  }}
                />
                {type_.name}
                {!ok && <span className="block text-[11px] text-subtle">{s.soon}</span>}
              </label>
            );
          })}
        </div>
        <p className="mt-2 text-[13px] text-subtle">{tr(type.description, lang)}</p>
        <div className="mt-4 max-w-xs">
          <Field label={s.version} htmlFor="version" error={form.fieldErrors.version}>
            <select id="version" value={version} onChange={(e) => setVersion(e.target.value)} className="input">
              {type.versions.map((v) => (
                <option key={v} value={v}>
                  {v === 'latest' ? t.common.latestVersion : v}
                </option>
              ))}
            </select>
          </Field>
        </div>
      </Step>

      <Step n={3} title={s.stepName}>
        <Field label={s.nameLabel} htmlFor="name" error={form.fieldErrors.name} hint={s.nameHint}>
          <input id="name" className="input" value={name} maxLength={freeHostingConfig.limits.serverNameMaxLength} onChange={(e) => setName(e.target.value)} />
        </Field>
      </Step>

      <Step n={4} title={loggedIn ? s.stepAccount : s.stepEmail}>
        {loggedIn ? (
          <p className="text-sm text-muted">
            {s.loggedInAs} <span className="text-white">{userEmail}</span>. {early ? e.loggedInHint : s.loggedInHint}
          </p>
        ) : (
          <Field label={s.emailLabel} htmlFor="email" error={form.fieldErrors.email} hint={s.emailHint}>
            <input id="email" type="email" autoComplete="email" className="input" value={email} onChange={(e) => setEmail(e.target.value)} />
          </Field>
        )}
      </Step>

      <div className="border-t border-line pt-7">
        <label className="flex cursor-pointer items-start gap-3 text-sm leading-relaxed text-muted">
          <input type="checkbox" checked={accept} onChange={(e) => setAccept(e.target.checked)} className="mt-1 size-4 shrink-0 accent-blue-600" />
          <span>
            {s.acceptBefore}
            <Link href={localePath(lang, 'terms')} target="_blank" className="text-gray-200 underline underline-offset-4 hover:text-white">
              {s.acceptTerms}
            </Link>
            {s.acceptAnd}
            <Link href={localePath(lang, 'rules')} target="_blank" className="text-gray-200 underline underline-offset-4 hover:text-white">
              {s.acceptRules}
            </Link>
            {s.acceptSummary}
            <Link href={localePath(lang, 'privacy')} target="_blank" className="text-gray-200 underline underline-offset-4 hover:text-white">
              {s.acceptPrivacy}
            </Link>
            {s.acceptAfter}
          </span>
        </label>
        {form.fieldErrors.acceptTerms && <p className="mt-2 text-sm text-red-400">{form.fieldErrors.acceptTerms}</p>}

        <Button type="submit" size="lg" loading={form.pending} className="mt-6 w-full sm:w-auto">
          {early ? (loggedIn ? e.submitLoggedIn : e.submit) : loggedIn ? s.submitLoggedIn(plan.name) : s.submit}
        </Button>
      </div>
    </form>
  );
}
