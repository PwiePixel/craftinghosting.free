'use client';

import { VerifyFlow } from './verify-flow';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import { Bot, Check, KeyRound, Pickaxe } from 'lucide-react';
import {
  createServerSchema,
  formatMb,
  freeHostingConfig,
  intlLocale,
  localePath,
  productKinds,
  serverTypesOf,
  startSchema,
  tr,
  type ProductKind,
  type PublicSiteDTO,
} from '@chfree/shared';
import { DiscordIcon } from '@/components/discord/discord-note';
import { Button } from '@/components/ui/button';
import { Alert, Field } from '@/components/ui/primitives';
import { useDict, useLang } from '@/i18n/client';
import { api } from '@/lib/api/client';
import { useForm } from '@/lib/use-form';
import { cn } from '@/lib/utils';


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
  products,
  initialPlan,
  initialKind,
  blockedKinds = [],
  takenPlans = [],
  lockedPlans = [],
  bonusSlots = 0,
  extra = {},
  userEmail,
  early = false,
  newsletterOption = false,
  discordSignup = false,
  needsDiscord = false,
}: {
  /** Produkte mit Paketen und Verfügbarkeit – kommen aus dem Admin-Bereich */
  products: PublicSiteDTO['products'];
  initialPlan?: string;
  initialKind?: ProductKind;
  /** Produkte, bei denen der Nutzer sein Limit schon erreicht hat */
  blockedKinds?: ProductKind[];
  /** Pakete, die der Nutzer schon hat und nicht noch einmal wählen kann (Einstellung „jedes Paket nur einmal“) */
  takenPlans?: string[];
  /** Pakete, für die gerade kein Slot frei ist (Grenze erreicht, aber ein anderes Paket ist über einen Bonus-Slot möglich) */
  lockedPlans?: string[];
  /** Anzahl zusätzlicher Slots aus Belohnungen (nur für den Hinweis) */
  bonusSlots?: number;
  /** Zusatzpakete: Paket-ID → erlaubte Anzahl (für den Hinweis „zusätzlich“) */
  extra?: Record<string, number>;
  userEmail?: string;
  /** Häkchen „Newsletter abonnieren“ anbieten (Admin-Einstellung; nur ohne Anmeldung) */
  newsletterOption?: boolean;
  /** Registrierung läuft über Discord (Anbindung eingerichtet) */
  discordSignup?: boolean;
  /** Angemeldet, aber Discord noch nicht verbunden: Der Server wird erst danach erstellt */
  needsDiscord?: boolean;
  /** Vorregistrierung (Early Access): Platz auf der Warteliste statt sofortiger Erstellung */
  early?: boolean;
}) {
  const router = useRouter();
  const lang = useLang();
  const t = useDict();
  const s = t.start;
  const e = t.early;
  // Angebotene Produkte (aktiv und mit mindestens einem Paket)
  const kinds = productKinds.filter((k) => products[k].enabled && products[k].plans.length > 0);
  const kindOk = (k: ProductKind) => !blockedKinds.includes(k);
  const startKind: ProductKind =
    kinds.find((k) => kindOk(k) && products[k].plans.some((p) => p.id === initialPlan)) ??
    (initialKind && kinds.includes(initialKind) && kindOk(initialKind) ? initialKind : undefined) ??
    kinds.find(kindOk) ??
    kinds[0] ??
    'minecraft';
  const [kind, setKind] = useState<ProductKind>(startKind);
  const bot = kind === 'discord';
  const plans = products[kind].plans;
  // Software eines Pakets: feste Software (z. B. Proxy-Paket) oder die im Bestellformular für alle freigegebene
  const typesFor = (pid: string, k: ProductKind = kind) => {
    const pl = products[k].plans.find((x) => x.id === pid);
    const all = serverTypesOf(k);
    if (pl && pl.serverTypes?.length) return all.filter((x) => pl.serverTypes.includes(x.id));
    return all.filter((x) => products[k].serverTypes.find((a) => a.id === x.id)?.general !== false);
  };
  const planOk = (id: string, k: ProductKind = kind) => !takenPlans.includes(id) && !lockedPlans.includes(id) && (products[k].plans.find((a) => a.id === id)?.available ?? false);
  const typeOk = (id: string, k: ProductKind = kind) => products[k].serverTypes.find((a) => a.id === id)?.available ?? true;

  const defaultPlan = (k: ProductKind) => {
    const list = products[k].plans;
    return (list.find((p) => p.highlighted && p.available) ?? list.find((p) => p.available) ?? list[0])?.id ?? '';
  };
  const defaultType = (k: ProductKind, pid: string) => {
    const list = typesFor(pid, k);
    const all = list.length ? list : serverTypesOf(k);
    return all.find((t) => t.recommended && typeOk(t.id, k)) ?? all.find((t) => typeOk(t.id, k)) ?? all[0]!;
  };
  const firstPlan = initialPlan && planOk(initialPlan, startKind) ? initialPlan : defaultPlan(startKind);
  const firstType = defaultType(startKind, firstPlan);
  const [planId, setPlanId] = useState(firstPlan);
  const serverTypes = typesFor(planId);
  const [typeId, setTypeId] = useState(firstType.id);
  const [version, setVersion] = useState(() => {
    // Versionsliste aus dem Admin-Bereich – die Standardversion nur, wenn sie darin vorkommt
    const list = products[startKind].serverTypes.find((x) => x.id === firstType.id)?.versions ?? firstType.versions;
    return list.includes(firstType.defaultVersion) ? firstType.defaultVersion : (list[0] ?? firstType.defaultVersion);
  });
  function switchKind(k: ProductKind) {
    if (k === kind) return;
    const pid = defaultPlan(k);
    const type = defaultType(k, pid);
    setKind(k);
    setPlanId(pid);
    setTypeId(type.id);
    setVersion(firstVersion(type.id, k));
  }
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [accept, setAccept] = useState(false);
  // Registrierung: über Discord (empfohlen) oder mit E-Mail-Adresse und Passwort
  const [method, setMethod] = useState<'discord' | 'password'>('discord');
  const [password, setPassword] = useState('');
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [newsletter, setNewsletter] = useState(false);
  // Wählbare Versionen kommen aus dem Admin-Bereich (Einstellungen → Minecraft-Versionen)
  const versionsOf = (id: string, k: ProductKind = kind) => {
    const list = products[k].serverTypes.find((a) => a.id === id)?.versions;
    return list?.length ? list : (serverTypesOf(k).find((t) => t.id === id)?.versions ?? ['latest']);
  };
  const firstVersion = (id: string, k: ProductKind = kind) => {
    const list = versionsOf(id, k);
    const preferred = serverTypesOf(k).find((t) => t.id === id)?.defaultVersion;
    return preferred && list.includes(preferred) ? preferred : list[0]!;
  };
  const [sentTo, setSentTo] = useState<string | null>(null);
  // Anderes Paket: Passt die gewählte Software nicht (z. B. Proxy-Paket), die erste passende wählen
  function selectPlan(pid: string) {
    setPlanId(pid);
    if (!typesFor(pid).some((x) => x.id === typeId)) {
      const next = defaultType(kind, pid);
      setTypeId(next.id);
      setVersion(firstVersion(next.id));
    }
  }

  const loggedIn = !!userEmail;
  const form = useForm(loggedIn ? createServerSchema : startSchema);
  const type = useMemo(() => serverTypes.find((t) => t.id === typeId) ?? serverTypes[0]!, [serverTypes, typeId]);
  const plan = plans.find((p) => p.id === planId);
  // Schrittnummern: Die Produktwahl erscheint nur, wenn es beide Angebote gibt
  const offset = kinds.length > 1 ? 1 : 0;

  const values = { planId, serverType: typeId, version, name, email, acceptTerms: accept || undefined, ...(newsletterOption && newsletter ? { newsletter: true } : {}) };

  const viaDiscord = discordSignup && !loggedIn && method === 'discord';

  function submit() {
    void form.submit(loggedIn ? { ...values, email: undefined, newsletter: undefined } : values, async (data) => {
      if (loggedIn) {
        await api('/servers', { body: data });
        // Fehlt noch etwas, bevor der Server erstellt wird (Discord verbinden, Panel-Zugang)? Dann direkt dorthin.
        const step = await api<{ next: string }>('/auth/continue', { body: {} }).catch(() => null);
        if (step && step.next !== 'overview' && step.next !== 'waitlist') {
          window.location.assign(`${localePath(lang, 'start')}?resume=1`);
          await new Promise(() => {});
        }
        router.push(localePath(lang, 'myServers', { neu: early ? 'waitlist' : '1' }));
        router.refresh();
      } else {
        const withPassword = discordSignup && method === 'password';
        if (withPassword && password.length < 8) {
          setPasswordError(s.passwordHint);
          return;
        }
        setPasswordError(null);
        const res = await api<{ ok: boolean; redirect?: string | null; resume?: boolean }>('/start', { body: withPassword ? { ...data, password } : data });
        // Konto mit Passwort angelegt und angemeldet: weiter mit dem nächsten Schritt (Discord verbinden)
        if (res.resume) {
          window.location.assign(`${localePath(lang, 'start')}?resume=1`);
          await new Promise(() => {});
        }
        // Registrierung über Discord: weiter zur Anmeldung bei Discord – von dort geht es zurück zum nächsten Schritt
        if (res.redirect) {
          window.location.assign(res.redirect);
          // Das Formular bleibt gesperrt, bis der Browser die Seite verlässt
          await new Promise(() => {});
        }
        setSentTo(email.trim().toLowerCase());
        window.scrollTo({ top: 0, behavior: 'smooth' });
      }
    });
  }

  // Nach dem Absenden: Code aus der E-Mail eingeben – danach geht es direkt mit dem Panel-Zugang weiter
  if (sentTo) {
    return (
      <div className="surface p-8 sm:p-10">
        <VerifyFlow
          embedded
          email={sentTo}
          onBack={() => setSentTo(null)}
          intro={
            <p className="mb-6 text-sm leading-relaxed text-muted">
              {s.sentBefore}
              <span className="text-white">{sentTo}</span>
              {early ? e.sentAfter(name.trim()) : s.sentAfter(name.trim())}
            </p>
          }
        />
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

      {kinds.length > 1 && (
        <Step n={1} title={s.stepProduct}>
          <div className="grid gap-3 sm:grid-cols-2" role="radiogroup" aria-label={s.stepProduct}>
            {kinds.map((k) => {
              const selected = k === kind;
              const ok = kindOk(k);
              const Icon = k === 'discord' ? Bot : Pickaxe;
              return (
                <label
                  key={k}
                  className={cn(
                    'relative flex cursor-pointer items-center gap-3 rounded-lg border p-4 transition-colors',
                    selected ? 'border-blue-500 bg-blue-500/[0.06]' : 'border-line-strong hover:border-white/25',
                    !ok && 'cursor-not-allowed opacity-50',
                  )}
                >
                  <input type="radio" name="kind" className="sr-only" checked={selected} disabled={!ok} onChange={() => switchKind(k)} />
                  <span className={cn('flex size-9 shrink-0 items-center justify-center rounded-lg', selected ? 'bg-blue-500/15 text-blue-300' : 'bg-white/[0.05] text-muted')}>
                    <Icon className="size-[18px]" aria-hidden />
                  </span>
                  <span className="min-w-0">
                    <span className="block font-medium text-white">{s.products[k].name}</span>
                    <span className="block text-[13px] text-muted">{ok ? s.products[k].text : s.hasServerTitle}</span>
                  </span>
                </label>
              );
            })}
          </div>
        </Step>
      )}

      <Step n={1 + offset} title={s.stepPlan}>
        {plans.length === 0 && <p className="text-sm text-muted">{s.noPlans}</p>}
        {bonusSlots > 0 && <p className="mb-3 text-sm text-emerald-300">🎁 {s.bonusSlots(bonusSlots)}</p>}
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
                <input type="radio" name="plan" className="sr-only" checked={selected} disabled={!ok} onChange={() => selectPlan(p.id)} />
                <span className="flex items-center justify-between">
                  <span className="font-medium text-white">{p.name}</span>
                  <span className={cn('flex size-5 items-center justify-center rounded-full border', selected ? 'border-blue-500 bg-blue-500' : 'border-line-strong')}>
                    {selected && <Check className="size-3 text-white" strokeWidth={3} />}
                  </span>
                </span>
                <span className="mt-1 block text-[13px] text-muted">
                  {s.planSpecs(formatMb(p.memoryMb, lang), formatMb(p.diskMb, lang), p.cpuPercent)}
                </span>
                {p.serverTypes?.length > 0 && (
                  <span className="mt-1 block text-[13px] text-blue-300">{s.planOnly(p.serverTypes.map((id) => serverTypesOf(kind).find((x) => x.id === id)?.name ?? id).join(', '))}</span>
                )}
                {extra[p.id] !== undefined && extra[p.id]! > 0 && <span className="mt-1 block text-[13px] text-emerald-300">{s.planExtra(extra[p.id]!)}</span>}
                {!ok && <span className="mt-1 block text-[13px] text-amber-300">{takenPlans.includes(p.id) ? s.planTaken : lockedPlans.includes(p.id) ? s.planLocked : s.soldOut}</span>}
                {ok && p.capacity != null && p.remaining != null && (
                  <span className="mt-1 block text-[13px] text-emerald-300">
                    {t.home.planLeft(p.remaining.toLocaleString(intlLocale(lang)), p.capacity.toLocaleString(intlLocale(lang)))}
                  </span>
                )}
              </label>
            );
          })}
        </div>
      </Step>

      <Step n={2 + offset} title={bot ? s.stepRuntime : s.stepSoftware}>
        <div className={cn('grid grid-cols-2 gap-2', bot ? 'sm:max-w-sm' : 'sm:grid-cols-[repeat(auto-fill,minmax(8.5rem,1fr))]')} role="radiogroup" aria-label={bot ? s.runtimeGroup : s.typeGroup}>
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
                    setVersion(firstVersion(type_.id));
                  }}
                />
                {type_.name}
                {!ok && <span className="block text-[11px] text-subtle">{s.soon}</span>}
              </label>
            );
          })}
        </div>
        <p className="mt-2 text-[13px] text-subtle">{tr(type.description, lang)}</p>
        {form.fieldErrors.serverType && <p className="mt-2 text-sm text-red-400">{form.fieldErrors.serverType}</p>}
        {bot ? (
          <p className="mt-2 text-[13px] text-subtle">{s.runtimeHint}</p>
        ) : (
          <div className="mt-4 max-w-xs">
            <Field label={s.version} htmlFor="version" error={form.fieldErrors.version}>
              <select id="version" value={version} onChange={(e) => setVersion(e.target.value)} className="input">
                {versionsOf(type.id).map((v) => (
                  <option key={v} value={v}>
                    {v === 'latest' ? t.common.latestVersion : v}
                  </option>
                ))}
              </select>
            </Field>
          </div>
        )}
      </Step>

      <Step n={3 + offset} title={s.stepName}>
        <Field label={s.nameLabel} htmlFor="name" error={form.fieldErrors.name} hint={bot ? s.nameHintBot : s.nameHint}>
          <input id="name" className="input" value={name} maxLength={freeHostingConfig.limits.serverNameMaxLength} onChange={(e) => setName(e.target.value)} />
        </Field>
      </Step>

      <Step n={4 + offset} title={loggedIn ? s.stepAccount : s.stepEmail}>
        {loggedIn ? (
          <p className="text-sm text-muted">
            {s.loggedInAs} <span className="text-white">{userEmail}</span>. {early ? e.loggedInHint : needsDiscord ? s.loggedInHintDiscord : s.loggedInHint}
          </p>
        ) : (
          <div className="space-y-5">
            {discordSignup && (
              <div className="grid gap-3 sm:grid-cols-2" role="radiogroup" aria-label={s.methodTitle}>
                {(['discord', 'password'] as const).map((m) => (
                  <label key={m} className={cn('flex cursor-pointer items-center gap-3 rounded-lg border p-4 transition-colors', method === m ? 'border-blue-500 bg-blue-500/[0.06]' : 'border-line-strong hover:border-white/25')}>
                    <input type="radio" name="signup-method" className="sr-only" checked={method === m} onChange={() => setMethod(m)} />
                    {m === 'discord' ? <DiscordIcon className="size-5 shrink-0 text-[#8b93ff]" /> : <KeyRound className="size-5 shrink-0 text-muted" aria-hidden />}
                    <span>
                      <span className="block text-sm font-medium text-white">{m === 'discord' ? s.methodDiscord : s.methodPassword}</span>
                      <span className="block text-[13px] text-subtle">{m === 'discord' ? s.methodDiscordHint : s.methodPasswordHint}</span>
                    </span>
                  </label>
                ))}
              </div>
            )}
            <Field label={s.emailLabel} htmlFor="email" error={form.fieldErrors.email} hint={discordSignup ? s.emailHintDiscord : s.emailHint}>
              <input id="email" type="email" autoComplete="email" className="input" value={email} onChange={(e) => setEmail(e.target.value)} />
            </Field>
            {discordSignup && method === 'password' && (
              <Field label={s.passwordLabel} htmlFor="signup-password" error={passwordError ?? form.fieldErrors.password} hint={s.passwordHint}>
                <input id="signup-password" type="password" autoComplete="new-password" className="input" value={password} maxLength={200} onChange={(e) => setPassword(e.target.value)} />
              </Field>
            )}
          </div>
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
            <Link href={localePath(lang, bot ? 'discordTerms' : 'rules')} target="_blank" className="text-gray-200 underline underline-offset-4 hover:text-white">
              {bot ? s.acceptRulesBot : s.acceptRules}
            </Link>
            {bot ? s.acceptSummaryBot(products.discord.fairUse) : s.acceptSummary}
            <Link href={localePath(lang, 'privacy')} target="_blank" className="text-gray-200 underline underline-offset-4 hover:text-white">
              {s.acceptPrivacy}
            </Link>
            {s.acceptAfter}
            {!bot && (
              <>
                {s.acceptEulaBefore}
                <a href="https://aka.ms/MinecraftEULA" target="_blank" rel="noopener noreferrer" className="text-gray-200 underline underline-offset-4 hover:text-white">
                  {s.acceptEula}
                </a>
                {s.acceptEulaAfter}
              </>
            )}
          </span>
        </label>
        {form.fieldErrors.acceptTerms && <p className="mt-2 text-sm text-red-400">{form.fieldErrors.acceptTerms}</p>}
        {newsletterOption && !loggedIn && (
          <label className="mt-4 flex cursor-pointer items-start gap-3 text-sm leading-relaxed text-muted">
            <input type="checkbox" checked={newsletter} onChange={(e) => setNewsletter(e.target.checked)} className="mt-1 size-4 shrink-0 accent-blue-600" />
            <span>{t.newsletter.checkbox}</span>
          </label>
        )}

        {discordSignup && !loggedIn && <p className="mt-5 max-w-2xl rounded-lg border border-[#5865f2]/40 bg-[#5865f2]/[0.08] p-4 text-sm leading-relaxed text-gray-200">{method === 'password' ? s.passwordNote : s.discordSignupNote}</p>}
        <Button type="submit" size="lg" loading={form.pending} disabled={!plan} icon={viaDiscord ? <DiscordIcon /> : undefined} className={cn('mt-6 w-full sm:w-auto', viaDiscord && 'bg-[#5865f2] hover:bg-[#6b76f5]')}>
          {viaDiscord ? s.submitDiscord : discordSignup && !loggedIn ? s.submitPassword : early ? (loggedIn ? e.submitLoggedIn : e.submit) : loggedIn ? s.submitLoggedIn(plan?.name ?? '') : s.submit}
        </Button>
      </div>
    </form>
  );
}
