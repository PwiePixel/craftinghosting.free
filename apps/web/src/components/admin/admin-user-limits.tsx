'use client';

/**
 * Admin → Nutzer → Grenzen: Für einen Nutzer abweichende Grenzen festlegen (z. B. 2 Minecraft-Server) und Pakete
 * freischalten bzw. deren Anzahl ändern (z. B. 1 Bedrock-Server, 1 Proxy). Leere Felder = Standard aus den Einstellungen.
 */
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { SlidersHorizontal, X } from 'lucide-react';
import { productKinds, type AdminUserDTO, type PlanSetting, type ProductKind, type SiteSettings, type UserLimitOverrides } from '@chfree/shared';
import { Button } from '@/components/ui/button';
import { api, ApiClientError } from '@/lib/api/client';

type Plan = PlanSetting & { kind: ProductKind };
const KIND = { minecraft: 'Minecraft', discord: 'Discord-Bot' } as const;

export function UserLimitsButton({ user }: { user: AdminUserDTO }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [settings, setSettings] = useState<SiteSettings | null>(null);
  const [form, setForm] = useState<UserLimitOverrides>(user.limitOverrides ?? { minecraft: null, discord: null, total: null, plans: {} });
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = Boolean(user.limitOverrides);

  async function show() {
    setOpen(true);
    setError(null);
    setForm(user.limitOverrides ?? { minecraft: null, discord: null, total: null, plans: {} });
    if (!settings) {
      try {
        setSettings((await api<{ settings: SiteSettings }>('/admin/settings')).settings);
      } catch (err) {
        setError(err instanceof ApiClientError ? err.message : String(err));
      }
    }
  }
  async function save() {
    setPending(true);
    setError(null);
    try {
      await api(`/admin/users/${user.id}/limits`, { body: form });
      setOpen(false);
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : String(err));
    } finally {
      setPending(false);
    }
  }

  const num = (v: string): number | null => (v.trim() === '' ? null : Math.max(0, Math.min(20, Math.round(Number(v) || 0))));
  const plans: Plan[] = settings ? productKinds.flatMap((k) => settings.products[k].plans.map((p) => ({ ...p, kind: k }))) : [];
  const special = plans.filter((p) => p.audience === 'granted' || p.perUser !== null);
  const normal = plans.filter((p) => p.audience === 'all' && p.perUser === null);

  return (
    <>
      <button
        type="button"
        onClick={() => void show()}
        className={`inline-flex h-8 items-center gap-1.5 rounded-md border px-2.5 text-[13px] transition-colors ${set ? 'border-blue-500/50 bg-blue-500/10 text-blue-100' : 'border-line-strong text-gray-200 hover:bg-white/5'}`}
        title="Grenzen und freigeschaltete Pakete"
      >
        <SlidersHorizontal className="size-3.5" aria-hidden /> Grenzen{set ? ' ✓' : ''}
      </button>
      {open && (
        <div className="fixed inset-0 z-[70] flex items-start justify-center overflow-y-auto bg-black/60 p-4 pt-[8vh]" role="dialog" aria-modal="true" aria-label={`Grenzen für ${user.email}`}>
          <div className="surface w-full max-w-xl p-5 shadow-2xl">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-[15px] font-semibold text-white">Grenzen für {user.email}</p>
                <p className="mt-1 text-[13px] leading-relaxed text-subtle">Leere Felder = Standard aus den Einstellungen. Bestehende Server bleiben; die Grenzen gelten für neue.</p>
              </div>
              <button type="button" onClick={() => setOpen(false)} className="rounded-md p-1 text-muted hover:bg-white/5 hover:text-white" aria-label="Schließen">
                <X className="size-4" />
              </button>
            </div>
            {!settings && !error && <p className="mt-5 text-sm text-subtle">Lädt …</p>}
            {settings && (
              <div className="mt-5 space-y-5">
                <div>
                  <p className="text-sm font-medium text-gray-200">Server pro Person</p>
                  <p className="mt-0.5 text-[12px] text-subtle">Gilt für {normal.length ? normal.map((p) => p.name).join(', ') : 'die normalen Pakete'} – der Nutzer wählt das Paket selbst.</p>
                  <div className="mt-2 grid gap-3 sm:grid-cols-3">
                    {(['minecraft', 'discord', 'total'] as const).map((key) => (
                      <label key={key} className="block text-[13px] text-muted">
                        {key === 'minecraft' ? 'Minecraft-Server' : key === 'discord' ? 'Discord-Bots' : 'Gesamt (0 = keine)'}
                        <input
                          className="input mt-1"
                          inputMode="numeric"
                          value={form[key] ?? ''}
                          placeholder={`Standard: ${settings.registration.limits[key]}`}
                          onChange={(e) => setForm((f) => ({ ...f, [key]: num(e.target.value) }))}
                        />
                      </label>
                    ))}
                  </div>
                </div>
                <div>
                  <p className="text-sm font-medium text-gray-200">Zusatzpakete und freigeschaltete Pakete</p>
                  <p className="mt-0.5 text-[12px] text-subtle">Zählen nicht gegen „Server pro Person“. Pakete mit dieser Einstellung legst du unter Einstellungen → Pakete an.</p>
                  {special.length === 0 ? (
                    <p className="mt-2 rounded-lg border border-line p-3 text-[13px] text-muted">Noch kein Paket mit eigener Grenze oder „Nur freigeschaltete Nutzer“.</p>
                  ) : (
                    <ul className="mt-2 divide-y divide-line rounded-lg border border-line">
                      {special.map((p) => {
                        const def = p.audience === 'granted' ? 0 : (p.perUser ?? 0);
                        const value = Object.hasOwn(form.plans, p.id) ? form.plans[p.id] : undefined;
                        return (
                          <li key={p.id} className="flex flex-wrap items-center justify-between gap-3 px-3 py-2.5">
                            <div className="min-w-0">
                              <p className="text-sm text-white">
                                {p.name} <span className="text-[12px] text-subtle">· {KIND[p.kind]}</span>
                              </p>
                              <p className="text-[12px] text-subtle">
                                {p.audience === 'granted' ? 'nur freigeschaltet' : `für alle, Standard ${def}`}
                                {p.serverTypes.length > 0 ? ` · Software: ${p.serverTypes.join(', ')}` : ''}
                                {!p.enabled ? ' · inaktiv' : ''}
                              </p>
                            </div>
                            <input
                              className="input w-28"
                              inputMode="numeric"
                              aria-label={`Anzahl ${p.name}`}
                              value={value ?? ''}
                              placeholder={`Standard: ${def}`}
                              onChange={(e) => {
                                const n = num(e.target.value);
                                setForm((f) => {
                                  const next = { ...f.plans };
                                  if (n === null) delete next[p.id];
                                  else next[p.id] = Math.min(10, n);
                                  return { ...f, plans: next };
                                });
                              }}
                            />
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>
              </div>
            )}
            {error && <p className="mt-4 text-sm text-red-300">{error}</p>}
            <div className="mt-6 flex flex-wrap justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => setForm({ minecraft: null, discord: null, total: null, plans: {} })} disabled={pending}>
                Alles auf Standard
              </Button>
              <Button size="sm" onClick={() => void save()} loading={pending} disabled={!settings}>
                Speichern
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
