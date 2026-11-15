'use client';

/**
 * Einstellungen im Admin-Bereich: Wartungsmodus, Registrierung (offen / Vorregistrierung / geschlossen),
 * Warteliste und die Zahlen auf der Startseite. Gespeichert wird immer das komplette Einstellungs-Objekt.
 */
import { useRouter } from 'next/navigation';
import { useState, type ReactNode } from 'react';
import { Save, Wrench } from 'lucide-react';
import { freeHostingConfig, type RegistrationMode, type SiteSettings } from '@chfree/shared';
import { Button } from '@/components/ui/button';
import { api, ApiClientError } from '@/lib/api/client';
import { cn } from '@/lib/utils';

/* ------------------------------------------------------------ Helfer */

/** ISO → Wert für <input type="datetime-local"> (Ortszeit des Browsers) */
export function toLocalInput(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

/** <input type="datetime-local"> → ISO (oder null) */
export function fromLocalInput(value: string): string | null {
  return value ? new Date(value).toISOString() : null;
}

async function saveSettings(next: SiteSettings): Promise<SiteSettings> {
  const res = await api<{ settings: SiteSettings }>('/admin/settings', { body: next });
  return res.settings;
}

export function Section({ title, description, children }: { title: string; description?: ReactNode; children: ReactNode }) {
  return (
    <section className="surface p-5 sm:p-6">
      <h2 className="text-[15px] font-semibold text-white">{title}</h2>
      {description && <p className="mt-1 max-w-3xl text-sm leading-relaxed text-muted">{description}</p>}
      <div className="mt-5 space-y-5">{children}</div>
    </section>
  );
}

export function Toggle({ checked, onChange, label, hint }: { checked: boolean; onChange: (v: boolean) => void; label: string; hint?: string }) {
  return (
    <label className="flex cursor-pointer items-start gap-3">
      <span className="relative mt-0.5 inline-flex shrink-0">
        <input type="checkbox" className="peer sr-only" checked={checked} onChange={(e) => onChange(e.target.checked)} />
        <span className="h-5 w-9 rounded-full bg-white/15 transition-colors peer-checked:bg-blue-600 peer-focus-visible:ring-2 peer-focus-visible:ring-blue-400/70" />
        <span className="absolute top-0.5 left-0.5 size-4 rounded-full bg-white transition-transform peer-checked:translate-x-4" />
      </span>
      <span>
        <span className="block text-sm font-medium text-gray-100">{label}</span>
        {hint && <span className="mt-0.5 block text-[13px] text-subtle">{hint}</span>}
      </span>
    </label>
  );
}

export function Labeled({ label, hint, children, className }: { label: string; hint?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <label className={cn('block', className)}>
      <span className="mb-1.5 block text-sm font-medium text-gray-200">{label}</span>
      {children}
      {hint && <span className="mt-1.5 block text-[13px] text-subtle">{hint}</span>}
    </label>
  );
}

function NumberInput({ value, onChange, min = 0, max, step = 1, className }: { value: number; onChange: (v: number) => void; min?: number; max?: number; step?: number; className?: string }) {
  return (
    <input
      type="number"
      className={cn('input max-w-[200px]', className)}
      value={Number.isFinite(value) ? value : ''}
      min={min}
      max={max}
      step={step}
      onChange={(e) => onChange(e.target.value === '' ? 0 : Number(e.target.value))}
    />
  );
}

function Segmented<T extends string>({ value, onChange, options }: { value: T; onChange: (v: T) => void; options: { value: T; label: string; hint?: string }[] }) {
  return (
    <div className="grid gap-2 sm:grid-cols-3" role="radiogroup">
      {options.map((o) => (
        <label
          key={o.value}
          className={cn(
            'cursor-pointer rounded-lg border p-3 transition-colors',
            value === o.value ? 'border-blue-500 bg-blue-500/[0.07]' : 'border-line-strong hover:border-white/25',
          )}
        >
          <input type="radio" className="sr-only" checked={value === o.value} onChange={() => onChange(o.value)} />
          <span className="block text-sm font-medium text-white">{o.label}</span>
          {o.hint && <span className="mt-0.5 block text-[12px] leading-snug text-muted">{o.hint}</span>}
        </label>
      ))}
    </div>
  );
}

function SaveBar({ pending, message, onSave, dirty }: { pending: boolean; message: { ok: boolean; text: string } | null; onSave: () => void; dirty: boolean }) {
  return (
    <div className="sticky bottom-4 z-10 flex flex-col gap-3 rounded-xl border border-line-strong bg-surface-2/95 p-4 backdrop-blur sm:flex-row sm:items-center sm:justify-between">
      <p className={cn('text-sm', message ? (message.ok ? 'text-emerald-300' : 'text-red-300') : 'text-muted')}>
        {message?.text ?? (dirty ? 'Ungespeicherte Änderungen' : 'Alles gespeichert')}
      </p>
      <Button onClick={onSave} loading={pending} icon={<Save />} disabled={!dirty}>
        Speichern
      </Button>
    </div>
  );
}

/* ------------------------------------------------------------ Formular */

/** Maximale Plätze: leer = unbegrenzt */
function CapacityInput({ value, onChange }: { value: number | null; onChange: (v: number | null) => void }) {
  return (
    <input
      type="number"
      min={0}
      placeholder="unbegrenzt"
      className="input max-w-[200px]"
      value={value ?? ''}
      onChange={(e) => onChange(e.target.value === '' ? null : Math.max(0, Math.round(Number(e.target.value))))}
    />
  );
}

export function SettingsForm({ initial, planCounts = {} }: { initial: SiteSettings; planCounts?: Record<string, number> }) {
  const router = useRouter();
  const [s, setS] = useState<SiteSettings>(initial);
  const [saved, setSaved] = useState<SiteSettings>(initial);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const dirty = JSON.stringify(s) !== JSON.stringify(saved);

  function patch<K extends keyof SiteSettings>(key: K, value: Partial<SiteSettings[K]>) {
    setMessage(null);
    setS((prev) => ({ ...prev, [key]: { ...prev[key], ...value } }));
  }

  async function onSave() {
    setPending(true);
    setMessage(null);
    try {
      const next = await saveSettings(s);
      setS(next);
      setSaved(next);
      setMessage({ ok: true, text: 'Gespeichert – die Website übernimmt die Änderungen in wenigen Sekunden.' });
      router.refresh();
    } catch (err) {
      setMessage({ ok: false, text: err instanceof ApiClientError ? err.message : 'Speichern fehlgeschlagen.' });
    } finally {
      setPending(false);
    }
  }

  const reg: { value: RegistrationMode; label: string; hint: string }[] = [
    { value: 'open', label: 'Offen', hint: 'Server werden direkt nach der E-Mail-Bestätigung erstellt.' },
    { value: 'preregistration', label: 'Vorregistrierung', hint: 'Early Access: Nutzer sichern sich einen Platz, du schaltest frei (Tab „Warteliste“).' },
    { value: 'closed', label: 'Geschlossen', hint: 'Keine neuen Server und keine neuen Plätze. Bestehende Server laufen weiter.' },
  ];

  return (
    <div className="space-y-5">
      <Section
        title="Wartungsmodus"
        description="Zeigt allen Besuchern eine Wartungsseite. Erreichbar bleiben Status, Anmeldung und Rechtstexte; Admins sehen die Website weiterhin normal. Aktionen (Server erstellen, reaktivieren, löschen) sind für Nutzer gesperrt. Automatische Löschungen pausieren während der Wartung und 24 h danach."
      >
        <Toggle checked={s.maintenance.enabled} onChange={(v) => patch('maintenance', { enabled: v })} label="Wartungsmodus aktiv" />
        <div className="grid gap-4 md:grid-cols-2">
          <Labeled label="Hinweis (Englisch)" hint="Leer = Standardtext">
            <textarea
              className="input h-24 py-2.5"
              value={s.maintenance.message.en}
              maxLength={1000}
              onChange={(e) => patch('maintenance', { message: { ...s.maintenance.message, en: e.target.value } })}
            />
          </Labeled>
          <Labeled label="Hinweis (Deutsch)" hint="Leer = englischer Hinweis bzw. Standardtext">
            <textarea
              className="input h-24 py-2.5"
              value={s.maintenance.message.de}
              maxLength={1000}
              onChange={(e) => patch('maintenance', { message: { ...s.maintenance.message, de: e.target.value } })}
            />
          </Labeled>
        </div>
        <Labeled label="Voraussichtlich bis (optional)">
          <input
            type="datetime-local"
            className="input max-w-[260px]"
            value={toLocalInput(s.maintenance.until)}
            onChange={(e) => patch('maintenance', { until: fromLocalInput(e.target.value) })}
          />
        </Labeled>
      </Section>

      <Section title="Registrierung" description="Legt fest, was auf „Server erstellen“ passiert. Die Texte der Website passen sich automatisch an.">
        <Segmented value={s.registration.mode} onChange={(v) => patch('registration', { mode: v })} options={reg} />
        <Labeled
          label="Kostenlose Server pro Person"
          hint="Gilt im Modus „Offen“. In der Vorregistrierung ist immer ein Platz pro Person möglich. Bestehende Server bleiben bei einer Senkung erhalten."
        >
          <NumberInput value={s.registration.maxServersPerUser} min={1} max={10} onChange={(v) => patch('registration', { maxServersPerUser: v })} />
        </Labeled>
      </Section>

      <Section
        title="Pakete & Kapazität"
        description="Wie viele kostenlose Server es je Paket höchstens geben darf. Auf der Website steht dann z. B. „Noch 12 von 100 Plätzen frei“, bei 0 freien Plätzen „Ausgebucht“. „Außerhalb belegt“ ist für Server, die auf denselben Nodes laufen, aber nicht über diese Website erstellt wurden (z. B. altes System)."
      >
        <div className="space-y-3">
          {freeHostingConfig.plans.map((p) => {
            const cfg = s.plans[p.id] ?? { capacity: p.capacity, reserved: 0 };
            const site = planCounts[p.id] ?? 0;
            const used = site + cfg.reserved;
            const setPlan = (v: Partial<typeof cfg>) => patch('plans', { [p.id]: { ...cfg, ...v } });
            return (
              <div key={p.id} className="grid gap-4 rounded-lg border border-line p-4 md:grid-cols-[1fr_auto_auto] md:items-end">
                <div>
                  <p className="text-sm font-medium text-white">{p.name}</p>
                  <p className="mt-0.5 text-[13px] text-subtle">
                    Über die Website belegt: {site}
                    {cfg.reserved > 0 ? ` · außerhalb: ${cfg.reserved}` : ''} · gesamt: {used}
                  </p>
                  <p className="mt-1 text-[13px] text-muted">
                    Öffentlich:{' '}
                    {cfg.capacity === null ? (
                      <span className="text-gray-200">unbegrenzt (keine Anzeige)</span>
                    ) : cfg.capacity - used > 0 ? (
                      <span className="text-emerald-300">
                        Noch {cfg.capacity - used} von {cfg.capacity} Plätzen frei
                      </span>
                    ) : (
                      <span className="text-amber-300">Ausgebucht</span>
                    )}
                  </p>
                </div>
                <Labeled label="Maximale Plätze" hint="leer = unbegrenzt">
                  <CapacityInput value={cfg.capacity} onChange={(v) => setPlan({ capacity: v })} />
                </Labeled>
                <Labeled label="Außerhalb belegt" hint="z. B. altes System">
                  <NumberInput value={cfg.reserved} max={1000000} onChange={(v) => setPlan({ reserved: v })} />
                </Labeled>
              </div>
            );
          })}
        </div>
      </Section>

      <Section
        title="Warteliste (Early Access)"
        description="Die ersten Plätze bekommen einen Server auf AMD EPYC, alle weiteren auf Intel Xeon. Die Hardware-Stufe steuert die Pterodactyl-Locations (PTERODACTYL_LOCATION_IDS_EPYC / _XEON)."
      >
        <div className="grid gap-5 md:grid-cols-2">
          <Labeled label="Plätze auf AMD EPYC (gesamt)" hint="0 = alle Plätze auf Intel Xeon">
            <NumberInput value={s.waitlist.epycSlots} max={100000} onChange={(v) => patch('waitlist', { epycSlots: v })} />
          </Labeled>
          <Labeled
            label="Davon außerhalb belegt"
            hint={`z. B. Server aus dem alten System auf dem EPYC. Für die Warteliste bleiben ${Math.max(0, s.waitlist.epycSlots - s.waitlist.epycReserved)} EPYC-Plätze.`}
          >
            <NumberInput value={s.waitlist.epycReserved} max={100000} onChange={(v) => patch('waitlist', { epycReserved: v })} />
          </Labeled>
          <div>
            <span className="mb-1.5 block text-sm font-medium text-gray-200">Vormerkungen außerhalb dieser Website</span>
            <p className="flex h-11 items-center text-[15px] font-semibold text-white">{s.waitlist.externalCount.toLocaleString('de-DE')}</p>
            <span className="mt-1.5 block text-[13px] text-subtle">
              Ändern im Tab „Warteliste“ mit + / − – sie belegen dort echte Plätze in der Reihenfolge, in der du sie hinzufügst.
            </span>
          </div>
        </div>
        <Toggle checked={s.waitlist.showCounter} onChange={(v) => patch('waitlist', { showCounter: v })} label="Anzahl auf der Startseite anzeigen" hint="„… auf der Warteliste“ unter dem Hero-Bereich" />
      </Section>

      <Section
        title="Zahlen auf der Startseite"
        description="Registrierte Nutzer, aktive Server und Uptime. Automatisch = aus der Datenbank bzw. dem Status-Verlauf. Der Zusatz ist für echte Nutzer/Server, die noch im alten System laufen."
      >
        <Toggle checked={s.stats.show} onChange={(v) => patch('stats', { show: v })} label="Zahlen anzeigen" />
        <div className="grid gap-5 lg:grid-cols-3">
          {(
            [
              ['users', 'Registrierte Nutzer', 'Nutzer im alten System'],
              ['servers', 'Aktive Server', 'Server im alten System'],
            ] as const
          ).map(([key, label, offsetLabel]) => {
            const v = s.stats[key];
            return (
              <div key={key} className="space-y-3 rounded-lg border border-line p-4">
                <p className="text-sm font-medium text-white">{label}</p>
                <select className="input" value={v.mode} onChange={(e) => patch('stats', { [key]: { ...v, mode: e.target.value as 'auto' | 'manual' } })}>
                  <option value="auto">Automatisch (+ Zusatz)</option>
                  <option value="manual">Fester Wert</option>
                </select>
                {v.mode === 'auto' ? (
                  <Labeled label={`Zusatz: ${offsetLabel}`}>
                    <NumberInput value={v.offset} max={100000000} onChange={(n) => patch('stats', { [key]: { ...v, offset: n } })} />
                  </Labeled>
                ) : (
                  <Labeled label="Wert">
                    <NumberInput value={v.value} max={100000000} onChange={(n) => patch('stats', { [key]: { ...v, value: n } })} />
                  </Labeled>
                )}
              </div>
            );
          })}
          <div className="space-y-3 rounded-lg border border-line p-4">
            <p className="text-sm font-medium text-white">Uptime</p>
            <select className="input" value={s.stats.uptime.mode} onChange={(e) => patch('stats', { uptime: { ...s.stats.uptime, mode: e.target.value as 'auto' | 'manual' } })}>
              <option value="auto">Automatisch (30 Tage Status-Verlauf)</option>
              <option value="manual">Fester Wert (z. B. externes Monitoring)</option>
            </select>
            {s.stats.uptime.mode === 'manual' && (
              <Labeled label="Wert in %">
                <NumberInput value={s.stats.uptime.value} max={100} step={0.01} onChange={(n) => patch('stats', { uptime: { ...s.stats.uptime, value: n } })} />
              </Labeled>
            )}
          </div>
        </div>
      </Section>

      <SaveBar pending={pending} message={message} onSave={onSave} dirty={dirty} />
    </div>
  );
}

/* ------------------------------------------------------------ Schnellschalter */

/** Wartungsmodus mit einem Klick (Übersicht) */
export function MaintenanceQuickToggle({ settings }: { settings: SiteSettings }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [armed, setArmed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const on = settings.maintenance.enabled;
  return (
    <div className="flex flex-col items-start gap-1.5">
      <Button
        variant={on ? 'primary' : armed ? 'danger' : 'secondary'}
        size="sm"
        icon={<Wrench />}
        loading={pending}
        onClick={async () => {
          if (!on && !armed) {
            setArmed(true);
            setTimeout(() => setArmed(false), 4000);
            return;
          }
          setPending(true);
          setError(null);
          try {
            await saveSettings({ ...settings, maintenance: { ...settings.maintenance, enabled: !on } });
            router.refresh();
          } catch (err) {
            setError(err instanceof ApiClientError ? err.message : 'Fehlgeschlagen.');
          } finally {
            setPending(false);
            setArmed(false);
          }
        }}
      >
        {on ? 'Wartung beenden' : armed ? 'Wirklich Wartung starten?' : 'Wartungsmodus starten'}
      </Button>
      {error && <span className="text-[12px] text-red-400">{error}</span>}
    </div>
  );
}

/* ------------------------------------------------------------ Status je Komponente */

const IMPACT_OPTIONS = [
  ['auto', 'Automatisch (Prüfung)'],
  ['operational', 'Online'],
  ['degraded', 'Beeinträchtigt'],
  ['partial_outage', 'Teilausfall'],
  ['major_outage', 'Down / Störung'],
  ['maintenance', 'Wartung'],
] as const;

export function StatusOverrides({ settings, components }: { settings: SiteSettings; components: { id: string; name: string; live: string | null }[] }) {
  const router = useRouter();
  const [overrides, setOverrides] = useState<Record<string, string>>(settings.status.overrides);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const dirty = JSON.stringify(overrides) !== JSON.stringify(settings.status.overrides);

  async function onSave() {
    setPending(true);
    setMessage(null);
    try {
      const clean = Object.fromEntries(Object.entries(overrides).filter(([, v]) => v !== 'auto'));
      const next = await saveSettings({ ...settings, status: { overrides: clean as SiteSettings['status']['overrides'] } });
      setOverrides(next.status.overrides);
      setMessage({ ok: true, text: 'Gespeichert.' });
      router.refresh();
    } catch (err) {
      setMessage({ ok: false, text: err instanceof ApiClientError ? err.message : 'Speichern fehlgeschlagen.' });
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="space-y-4">
      <ul className="divide-y divide-line overflow-hidden rounded-lg border border-line">
        {components.map((c) => (
          <li key={c.id} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-sm font-medium text-white">{c.name}</p>
              {c.live && <p className="text-[12px] text-subtle">Aktuell angezeigt: {c.live}</p>}
            </div>
            <select className="input sm:max-w-[240px]" value={overrides[c.id] ?? 'auto'} onChange={(e) => setOverrides((o) => ({ ...o, [c.id]: e.target.value }))}>
              {IMPACT_OPTIONS.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={onSave} loading={pending} disabled={!dirty} icon={<Save />}>
          Status speichern
        </Button>
        {message && <span className={cn('text-sm', message.ok ? 'text-emerald-300' : 'text-red-300')}>{message.text}</span>}
      </div>
    </div>
  );
}
