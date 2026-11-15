'use client';

/**
 * Einstellungen im Admin-Bereich: Wartungsmodus, Registrierung (offen / Vorregistrierung / geschlossen),
 * Produkte & Pakete, Hardware-Angaben, Spenden, Warteliste und die Zahlen auf der Startseite.
 * Gespeichert wird immer das komplette Einstellungs-Objekt.
 */
import { useRouter } from 'next/navigation';
import { useState, type ReactNode } from 'react';
import { Plus, Save, Wrench } from 'lucide-react';
import { describeServerLimits, productKinds, serverLimitBounds, type ProductKind, type RegistrationMode, type ServerLimits, type SiteSettings } from '@chfree/shared';
import { ActionButton } from '@/components/admin/admin-actions';
import { ProductEditor } from '@/components/admin/admin-plans';
import { MoreSettings } from '@/components/admin/admin-settings-more';
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

export function NumberInput({ value, onChange, min = 0, max, step = 1, className }: { value: number; onChange: (v: number) => void; min?: number; max?: number; step?: number; className?: string }) {
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
export function CapacityInput({ value, onChange }: { value: number | null; onChange: (v: number | null) => void }) {
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

/** Nur https-Links sind als Zahlungslink erlaubt (wie auf dem Server) */
function isHttpsUrl(value: string): boolean {
  try {
    return new URL(value.trim()).protocol === 'https:';
  } catch {
    return false;
  }
}

const MAX_LOCATIONS = 12;
const MAX_CPUS = 6;

export function SettingsForm({
  initial,
  planCounts = {},
  productCounts = {},
}: {
  initial: SiteSettings;
  /** Über die Website belegte Plätze je Paket-ID (aus der Übersicht) */
  planCounts?: Record<string, number>;
  /** Über die Website belegte Plätze je Produkt (aus der Übersicht) */
  productCounts?: Partial<Record<ProductKind, number>>;
}) {
  const router = useRouter();
  const [s, setS] = useState<SiteSettings>(initial);
  const [saved, setSaved] = useState<SiteSettings>(initial);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const dirty = JSON.stringify(s) !== JSON.stringify(saved);

  const limits = s.registration.limits;
  const setLimits = (value: Partial<ServerLimits>) => patch('registration', { limits: { ...limits, ...value } });

  function patch<K extends keyof SiteSettings>(key: K, value: Partial<SiteSettings[K]>) {
    setMessage(null);
    setS((prev) => ({ ...prev, [key]: { ...prev[key], ...value } }));
  }

  /** Für verschachtelte Einstellungen (Regeln, Versionen …): beliebige Änderung am ganzen Objekt */
  function update(fn: (prev: SiteSettings) => SiteSettings) {
    setMessage(null);
    setS(fn);
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
        <div>
          <p className="text-sm font-medium text-gray-200">Kostenlose Server pro Person</p>
          <p className="mt-1 max-w-3xl text-[13px] leading-relaxed text-subtle">
            Gilt im Modus „Offen“. In der Vorregistrierung ist immer ein Platz pro Person möglich. Bestehende Server bleiben bei einer Senkung erhalten.
          </p>
          <div className="mt-4 grid gap-5 sm:grid-cols-3">
            <Labeled label="Minecraft-Server" hint="0–10 je Person. 0 = keiner.">
              <NumberInput value={limits.minecraft} min={0} max={serverLimitBounds.perKind} onChange={(minecraft) => setLimits({ minecraft })} />
            </Labeled>
            <Labeled label="Discord-Bots" hint="0–10 je Person. 0 = keiner.">
              <NumberInput value={limits.discord} min={0} max={serverLimitBounds.perKind} onChange={(discord) => setLimits({ discord })} />
            </Labeled>
            <Labeled label="Zusammen höchstens" hint="Obergrenze über beide Angebote. 0 = keine zusätzliche Grenze.">
              <NumberInput value={limits.total} min={0} max={serverLimitBounds.total} onChange={(total) => setLimits({ total })} />
            </Labeled>
          </div>
          <div className="mt-5 grid gap-4 sm:grid-cols-2">
            <Toggle
              checked={limits.uniquePlan.minecraft}
              onChange={(minecraft) => setLimits({ uniquePlan: { ...limits.uniquePlan, minecraft } })}
              label="Jedes Minecraft-Paket nur einmal"
              hint="Zum Beispiel ein 4-GB- und ein 6-GB-Server, aber nicht zweimal 4 GB."
            />
            <Toggle
              checked={limits.uniquePlan.discord}
              onChange={(discord) => setLimits({ uniquePlan: { ...limits.uniquePlan, discord } })}
              label="Jedes Discord-Bot-Paket nur einmal"
              hint="Ausgeschaltet darf dasselbe Bot-Paket mehrfach gewählt werden."
            />
          </div>
          <p className="mt-4 rounded-lg border border-line bg-black/20 px-3.5 py-2.5 text-sm text-muted">
            <span className="text-gray-200">So steht es auf der Website:</span> {describeServerLimits(limits, 'de')}
          </p>
        </div>
      </Section>

      <Section
        title="Produkte & Pakete"
        description="Minecraft-Server und Discord-Bots – jeweils mit eigenen Paketen und eigener Kapazität. Auf der Website steht dann z. B. „Noch 12 von 100 Plätzen frei“, bei 0 freien Plätzen „Ausgebucht“. „Außerhalb belegt“ ist für Server, die auf denselben Nodes laufen, aber nicht über diese Website erstellt wurden (z. B. altes System). Je Paket stellst du auch die Slots im Panel ein (Backups, Datenbanken, Ports). Geänderte Ressourcen gelten für neue Server, Slots lassen sich auf bestehende übertragen; Nodes und Eggs stellst du im Tab „Pterodactyl“ ein."
      >
        <div className="space-y-4">
          {productKinds.map((kind) => (
            <ProductEditor
              key={kind}
              kind={kind}
              product={s.products[kind]}
              onChange={(v) => patch('products', { [kind]: { ...s.products[kind], ...v } })}
              planCounts={planCounts}
              productCount={productCounts[kind] ?? null}
              savedPlans={saved.products[kind].plans}
            />
          ))}
        </div>
      </Section>

      <Section
        title="Fair-Use für Discord-Bots"
        description="Discord-Bots dürfen durchgehend online sein. Damit die geteilte Bot-Node für alle schnell bleibt, gelten statt Laufzeit-Pausen diese Regeln – sie werden automatisch durchgesetzt (jede Minute geprüft) und stehen mit genau diesen Werten in den Nutzungsbedingungen für Discord-Bots (/discord-bot/terms-of-use)."
      >
        <Toggle
          checked={s.botFairUse.enabled}
          onChange={(v) => patch('botFairUse', { enabled: v })}
          label="Fair-Use-System für Discord-Bots aktiv"
          hint="Aus = keine automatische Prüfung; es gelten nur die Paket-Limits und der 30-Tage-Zyklus."
        />
        <div className="grid gap-5 md:grid-cols-3">
          <Labeled label="CPU-Schwelle (%)" hint="Anteil am CPU-Limit des Pakets, ab dem die Last als „hoch“ zählt (50–100).">
            <NumberInput value={s.botFairUse.cpuThresholdPercent} min={50} max={100} onChange={(v) => patch('botFairUse', { cpuThresholdPercent: v })} />
          </Labeled>
          <Labeled label="Dauerlast ab (Minuten)" hint="So lange am Stück über der Schwelle → Stopp. Zur Halbzeit kommt eine Vorwarnung per E-Mail.">
            <NumberInput value={s.botFairUse.cpuWindowMinutes} min={5} max={1440} onChange={(v) => patch('botFairUse', { cpuWindowMinutes: v })} />
          </Labeled>
          <Labeled label="Pause nach Stopp (Minuten)" hint="Erst danach lässt sich der Bot wieder starten.">
            <NumberInput value={s.botFairUse.cooldownMinutes} min={5} max={1440} onChange={(v) => patch('botFairUse', { cooldownMinutes: v })} />
          </Labeled>
          <Labeled label="Sperre ab Verwarnungen" hint="Jeder automatische Stopp ist eine Verwarnung. 0 = nie automatisch sperren.">
            <NumberInput value={s.botFairUse.maxStrikes} min={0} max={50} onChange={(v) => patch('botFairUse', { maxStrikes: v })} />
          </Labeled>
          <Labeled label="… innerhalb von (Tagen)" hint="Zeitfenster, in dem die Verwarnungen gezählt werden.">
            <NumberInput value={s.botFairUse.strikeWindowDays} min={1} max={90} onChange={(v) => patch('botFairUse', { strikeWindowDays: v })} />
          </Labeled>
          <div />
          <Labeled label="Inaktiv nach (Tagen offline)" hint="So viele Tage am Stück offline → Platz wird freigegeben (Laufzeit endet vorzeitig, reaktivierbar). 0 = aus.">
            <NumberInput value={s.botFairUse.inactiveDays} min={0} max={365} onChange={(v) => patch('botFairUse', { inactiveDays: v })} />
          </Labeled>
          <Labeled label="Erinnerung (Tage vorher)" hint="E-Mail, bevor der Platz freigegeben wird. 0 = keine Erinnerung.">
            <NumberInput value={s.botFairUse.inactiveWarningDays} min={0} max={30} onChange={(v) => patch('botFairUse', { inactiveWarningDays: v })} />
          </Labeled>
        </div>
        <p className="text-[13px] leading-relaxed text-subtle">
          Gesperrte Bots (Grund „abuse“) hebst du unter „Server“ mit „Entsperren“ wieder auf. Das klassische Fair-Use-System (24 h am Stück, Wochen-Offline-Zeit) lässt sich
          für Discord-Bots oben unter „Produkte &amp; Pakete“ zusätzlich einschalten – empfohlen ist: aus.
        </p>
      </Section>

      <Section
        title="Hardware & Standorte"
        description="Angaben zur Hardware auf der Website: Sie erscheinen auf der Startseite, in den FAQ und in den Rechtstexten (z. B. „Standorte: DE“)."
      >
        <div>
          <span className="mb-1.5 block text-sm font-medium text-gray-200">Standorte</span>
          <div className="space-y-2">
            {s.hardware.locations.map((l, index) => {
              const setLocation = (v: Partial<typeof l>) => patch('hardware', { locations: s.hardware.locations.map((x, i) => (i === index ? { ...x, ...v } : x)) });
              return (
                <div key={index} className="grid gap-2 sm:grid-cols-[110px_1fr_1fr_auto] sm:items-center">
                  <input
                    className="input font-mono uppercase"
                    value={l.code}
                    maxLength={3}
                    placeholder="DE"
                    aria-label="Ländercode"
                    onChange={(e) => setLocation({ code: e.target.value.toUpperCase().replace(/[^A-Z]/g, '') })}
                  />
                  <input
                    className="input"
                    value={l.name.de}
                    maxLength={60}
                    placeholder="Name (Deutsch), z. B. Deutschland"
                    aria-label="Name (Deutsch)"
                    onChange={(e) => setLocation({ name: { ...l.name, de: e.target.value } })}
                  />
                  <input
                    className="input"
                    value={l.name.en}
                    maxLength={60}
                    placeholder="Name (Englisch), z. B. Germany"
                    aria-label="Name (Englisch)"
                    onChange={(e) => setLocation({ name: { ...l.name, en: e.target.value } })}
                  />
                  <ActionButton label="Entfernen" danger run={async () => patch('hardware', { locations: s.hardware.locations.filter((_, i) => i !== index) })} />
                </div>
              );
            })}
            {s.hardware.locations.length === 0 && <p className="text-[13px] text-amber-300">Kein Standort eingetragen – auf der Website wird dann kein Standort genannt.</p>}
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              icon={<Plus />}
              disabled={s.hardware.locations.length >= MAX_LOCATIONS}
              onClick={() => patch('hardware', { locations: [...s.hardware.locations, { code: '', name: { de: '', en: '' } }] })}
            >
              Standort hinzufügen
            </Button>
            <span className="text-[12px] text-subtle">Ländercode mit 2–3 Buchstaben (z. B. DE), jeder Code nur einmal. Zeilen ohne gültigen Code werden beim Speichern verworfen.</span>
          </div>
        </div>
        <div>
          <span className="mb-1.5 block text-sm font-medium text-gray-200">Prozessoren</span>
          <div className="space-y-2">
            {s.hardware.cpus.map((cpu, index) => (
              <div key={index} className="grid gap-2 sm:grid-cols-[1fr_auto] sm:items-center">
                <input
                  className="input"
                  value={cpu}
                  maxLength={80}
                  placeholder="z. B. Intel Xeon E5-2680 v4"
                  aria-label={`Prozessor ${index + 1}`}
                  onChange={(e) => patch('hardware', { cpus: s.hardware.cpus.map((x, i) => (i === index ? e.target.value : x)) })}
                />
                <ActionButton label="Entfernen" danger run={async () => patch('hardware', { cpus: s.hardware.cpus.filter((_, i) => i !== index) })} />
              </div>
            ))}
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              icon={<Plus />}
              disabled={s.hardware.cpus.length >= MAX_CPUS}
              onClick={() => patch('hardware', { cpus: [...s.hardware.cpus, ''] })}
            >
              Prozessor hinzufügen
            </Button>
            <span className="text-[12px] text-subtle">Leere Zeilen werden beim Speichern verworfen.</span>
          </div>
        </div>
      </Section>

      <Section
        title="Spenden"
        description="Spenden-Seite mit einem Zahlungslink von SumUp. Die Seite liegt unter /donate bzw. /de/spenden; ist sie aktiv, erscheint im Header der Link „Spenden“."
      >
        <Toggle checked={s.donate.enabled} onChange={(v) => patch('donate', { enabled: v })} label="Spenden-Seite aktiv" />
        <Labeled label="SumUp-Zahlungslink" hint="Muss mit https:// beginnen, z. B. https://pay.sumup.com/b2c/…">
          <input
            type="url"
            inputMode="url"
            className="input max-w-xl"
            value={s.donate.url}
            maxLength={500}
            placeholder="https://pay.sumup.com/b2c/…"
            onChange={(e) => patch('donate', { url: e.target.value })}
          />
        </Labeled>
        {s.donate.url.trim() !== '' && !isHttpsUrl(s.donate.url) && (
          <p className="text-[13px] text-amber-300">Das ist kein gültiger https-Link – er wird beim Speichern verworfen.</p>
        )}
        {s.donate.enabled && !isHttpsUrl(s.donate.url) && (
          <p className="text-[13px] text-amber-300">
            Ohne gültigen https-Zahlungslink schaltet der Server die Spenden-Seite beim Speichern wieder aus.
          </p>
        )}
      </Section>

      <Section
        title="Warteliste (Early Access)"
        description="Optional gibt es zwei Hardware-Stufen: Die ersten Plätze bekommen einen Server auf AMD EPYC, alle weiteren auf Intel Xeon (gesteuert über die Pterodactyl-Locations PTERODACTYL_LOCATION_IDS_EPYC / _XEON). Bei 0 EPYC-Plätzen gibt es nur eine Hardware-Stufe (aktuell Intel Xeon) – öffentlich wird dann nichts zu EPYC angezeigt."
      >
        <div className="grid gap-5 md:grid-cols-2">
          <Labeled label="Plätze auf AMD EPYC (gesamt)" hint="0 = nur eine Hardware-Stufe (aktuell Intel Xeon), EPYC wird nirgends erwähnt">
            <NumberInput value={s.waitlist.epycSlots} max={100000} onChange={(v) => patch('waitlist', { epycSlots: v })} />
          </Labeled>
          <Labeled
            label="Davon außerhalb belegt"
            hint={
              s.waitlist.epycSlots > 0
                ? `z. B. Server aus dem alten System auf dem EPYC. Für die Warteliste bleiben ${Math.max(0, s.waitlist.epycSlots - s.waitlist.epycReserved)} EPYC-Plätze.`
                : 'Nur von Bedeutung, wenn es EPYC-Plätze gibt.'
            }
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

      <MoreSettings s={s} update={update} />

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
