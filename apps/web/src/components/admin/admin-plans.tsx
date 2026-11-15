'use client';

/**
 * Produkte (Minecraft-Server, Discord-Bots) mit ihren Paketen im Admin-Bereich: Kapazität, Fair-Use-System
 * und die Pakete selbst (anlegen, ändern, sortieren, entfernen). Teil des Einstellungs-Formulars –
 * gespeichert wird dort immer das komplette Einstellungs-Objekt.
 */
import { useState, type ReactNode } from 'react';
import { ArrowDown, ArrowUp, ChevronDown, Plus } from 'lucide-react';
import { cpuLabelFor, defaultPlans, maxPlans, planIdFromName, type PlanSetting, type ProductKind, type ProductSettings } from '@chfree/shared';
import { ActionButton } from '@/components/admin/admin-actions';
import { PRODUCT_LABEL, formatMb, formatThreads } from '@/components/admin/admin-labels';
import { CapacityInput, Labeled, NumberInput, Toggle } from '@/components/admin/admin-settings';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/api/client';
import { cn } from '@/lib/utils';

const nf = (n: number) => n.toLocaleString('de-DE');

/** Grenzen wie bei der Prüfung auf dem Server (normalizeSiteSettings) */
const RANGES = [
  ['memoryMb', 'RAM', 64, 262_144, ' MB'],
  ['cpuPercent', 'CPU', 5, 3200, ' %'],
  ['diskMb', 'Speicher', 128, 2_097_152, ' MB'],
  ['backups', 'Backup-Slots', 0, 20, ''],
  ['databases', 'Datenbank-Slots', 0, 20, ''],
  ['allocations', 'Netzwerk-Slots', 1, 10, ''],
] as const;

function planIssues(p: PlanSetting): string[] {
  const issues: string[] = [];
  if (!p.name.trim()) issues.push('Name fehlt – ohne Namen wird das Paket beim Speichern verworfen.');
  for (const [key, label, min, max, unit] of RANGES) {
    if (p[key] < min || p[key] > max) issues.push(`${label}: erlaubt sind ${nf(min)}–${nf(max)}${unit} – der Wert wird beim Speichern angepasst.`);
  }
  return issues;
}

function newPlan(kind: ProductKind): PlanSetting {
  const cpuPercent = kind === 'discord' ? 50 : 100;
  return {
    // Die ID vergibt der Server beim Speichern (aus dem Namen)
    id: '',
    name: '',
    tagline: { de: '', en: '' },
    memoryMb: kind === 'discord' ? 512 : 4096,
    cpuPercent,
    cpuLabel: cpuLabelFor(cpuPercent),
    diskMb: kind === 'discord' ? 2048 : 10_240,
    swapMb: 0,
    ioWeight: 500,
    databases: 0,
    backups: kind === 'discord' ? 0 : 1,
    allocations: 1,
    highlighted: false,
    capacity: null,
    features: [],
    enabled: true,
    reserved: 0,
  };
}

function Badge({ tone, children }: { tone: 'blue' | 'gray' | 'amber'; children: ReactNode }) {
  const cls = { blue: 'bg-blue-500/15 text-blue-300', gray: 'bg-white/5 text-gray-300', amber: 'bg-amber-400/10 text-amber-300' }[tone];
  return <span className={cn('rounded px-1.5 py-0.5 text-[11px] font-normal', cls)}>{children}</span>;
}

function IconButton({ label, disabled, onClick, children }: { label: string; disabled?: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className="inline-flex size-7 shrink-0 items-center justify-center rounded-md border border-line-strong text-gray-300 transition-colors hover:border-white/30 hover:bg-white/5 disabled:pointer-events-none disabled:opacity-40 [&_svg]:size-3.5"
    >
      {children}
    </button>
  );
}

/** Öffentliche Anzeige der Belegung: „Noch 12 von 100 Plätzen frei“ / „Ausgebucht“ / unbegrenzt */
function PublicUsage({ capacity, used }: { capacity: number | null; used: number }) {
  if (capacity === null) return <span className="text-gray-200">unbegrenzt (keine Anzeige)</span>;
  if (capacity - used > 0)
    return (
      <span className="text-emerald-300">
        Noch {nf(capacity - used)} von {nf(capacity)} Plätzen frei
      </span>
    );
  return <span className="text-amber-300">Ausgebucht</span>;
}

/** Überträgt die gespeicherten Slots des Pakets auf alle bestehenden Server mit diesem Paket */
function ApplySlots({ planId, count, unsaved }: { planId: string; count: number; unsaved: boolean }) {
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  return (
    <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-line pt-4">
      {unsaved ? (
        <p className="text-[13px] text-amber-300">
          Neue Server bekommen die Slots ab dem Speichern. Für die {nf(count)} bestehenden Server mit diesem Paket: erst speichern, dann hier übertragen.
        </p>
      ) : (
        <>
          <ActionButton
            label={`Slots auf ${nf(count)} ${count === 1 ? 'bestehenden Server' : 'bestehende Server'} übertragen`}
            confirm="Wirklich übertragen?"
            run={async () => {
              setResult(null);
              const res = await api<{ result: { total: number; updated: number; failed: number; error: string | null } }>(`/admin/plans/${planId}/apply-slots`, { body: {} });
              const r = res.result;
              setResult({
                ok: r.failed === 0,
                text: r.failed === 0 ? `${nf(r.updated)} Server aktualisiert.` : `${nf(r.updated)} aktualisiert, ${nf(r.failed)} fehlgeschlagen${r.error ? ` – ${r.error}` : ''}`,
              });
            }}
          />
          {result ? (
            <span className={cn('text-[13px]', result.ok ? 'text-emerald-300' : 'text-red-300')}>{result.text}</span>
          ) : (
            <span className="text-[13px] text-subtle">RAM, CPU und Speicher der Server bleiben unverändert.</span>
          )}
        </>
      )}
    </div>
  );
}

/* ------------------------------------------------------------ Paket */

function PlanRow({
  plan: p,
  saved,
  count,
  open,
  first,
  last,
  onToggle,
  onChange,
  onMove,
  onRemove,
}: {
  plan: PlanSetting;
  /** Gespeicherter Stand dieses Pakets (fehlt bei einem neuen Paket) */
  saved?: PlanSetting;
  /** Bestehende Server mit diesem Paket (über die Website) */
  count: number;
  open: boolean;
  first: boolean;
  last: boolean;
  onToggle: () => void;
  onChange: (v: Partial<PlanSetting>) => void;
  onMove: (dir: -1 | 1) => void;
  onRemove: () => void;
}) {
  const used = count + p.reserved;
  const issues = planIssues(p);
  return (
    <li className={cn('rounded-lg border', open ? 'border-line-strong' : 'border-line')}>
      <div className="flex items-center gap-2 px-3 py-2.5">
        <button type="button" className="flex min-w-0 flex-1 items-center gap-2.5 text-left" aria-expanded={open} onClick={onToggle}>
          <ChevronDown className={cn('size-4 shrink-0 text-subtle transition-transform', open && 'rotate-180')} aria-hidden />
          <span className="min-w-0">
            <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm font-medium text-white">
              {p.name.trim() || <span className="text-muted">Neues Paket</span>}
              {p.highlighted && <Badge tone="blue">hervorgehoben</Badge>}
              {!p.enabled && <Badge tone="gray">inaktiv</Badge>}
              {!p.id && <Badge tone="amber">neu</Badge>}
              {issues.length > 0 && <Badge tone="amber">prüfen</Badge>}
            </span>
            <span className="mt-0.5 block text-[12px] text-subtle">
              {formatMb(p.memoryMb)} RAM · {nf(p.cpuPercent)} % CPU · {formatMb(p.diskMb)} Speicher · {nf(p.backups)} Backups · {nf(p.databases)} Datenbanken ·{' '}
              {nf(p.allocations)} {p.allocations === 1 ? 'Port' : 'Ports'} ·{' '}
              {p.capacity === null ? `${nf(used)} belegt (unbegrenzt)` : `${nf(used)} / ${nf(p.capacity)} Plätze belegt`}
            </span>
          </span>
        </button>
        <IconButton label="Nach oben" disabled={first} onClick={() => onMove(-1)}>
          <ArrowUp aria-hidden />
        </IconButton>
        <IconButton label="Nach unten" disabled={last} onClick={() => onMove(1)}>
          <ArrowDown aria-hidden />
        </IconButton>
      </div>

      {open && (
        <div className="space-y-4 border-t border-line p-4">
          <div className="grid gap-4 md:grid-cols-3">
            <Labeled label="Name" hint="höchstens 40 Zeichen">
              <input className="input" value={p.name} maxLength={40} placeholder="z. B. Starter" onChange={(e) => onChange({ name: e.target.value })} />
            </Labeled>
            <Labeled label="Kurzbeschreibung (Deutsch)">
              <input className="input" value={p.tagline.de} maxLength={160} onChange={(e) => onChange({ tagline: { ...p.tagline, de: e.target.value } })} />
            </Labeled>
            <Labeled label="Kurzbeschreibung (Englisch)" hint="Fehlt eine Sprache, gilt die andere">
              <input className="input" value={p.tagline.en} maxLength={160} onChange={(e) => onChange({ tagline: { ...p.tagline, en: e.target.value } })} />
            </Labeled>
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            <Labeled label="RAM (MB)" hint={`= ${formatMb(p.memoryMb)}`}>
              <NumberInput value={p.memoryMb} min={64} max={262144} step={64} onChange={(v) => onChange({ memoryMb: v })} />
            </Labeled>
            <Labeled label="CPU (%)" hint={`= ${formatThreads(p.cpuPercent)} (100 % = 1 Thread)`}>
              <NumberInput value={p.cpuPercent} min={5} max={3200} step={5} onChange={(v) => onChange({ cpuPercent: v, cpuLabel: cpuLabelFor(v) })} />
            </Labeled>
            <Labeled label="Speicher (MB)" hint={`= ${formatMb(p.diskMb)}`}>
              <NumberInput value={p.diskMb} min={128} max={2097152} step={128} onChange={(v) => onChange({ diskMb: v })} />
            </Labeled>
            <Labeled label="Maximale Plätze" hint="leer = unbegrenzt">
              <CapacityInput value={p.capacity} onChange={(v) => onChange({ capacity: v })} />
            </Labeled>
            <Labeled label="Außerhalb belegt" hint="z. B. altes System">
              <NumberInput value={p.reserved} max={1000000} onChange={(v) => onChange({ reserved: v })} />
            </Labeled>
            <div className="text-[13px] leading-relaxed text-muted sm:pt-7">
              <p className="text-subtle">
                Über die Website belegt: {nf(count)}
                {p.reserved > 0 ? ` · außerhalb: ${nf(p.reserved)}` : ''} · gesamt: {nf(used)}
              </p>
              <p className="mt-1">
                Öffentlich: <PublicUsage capacity={p.capacity} used={used} />
              </p>
            </div>
          </div>
          <div className="rounded-lg border border-line bg-black/20 p-4">
            <p className="text-sm font-medium text-gray-200">Slots im Panel</p>
            <p className="mt-1 text-[13px] leading-relaxed text-subtle">
              Wie viele Backups, Datenbanken und Ports ein Nutzer in seinem Server im Pterodactyl-Panel selbst anlegen darf.
            </p>
            <div className="mt-4 grid gap-4 sm:grid-cols-3">
              <Labeled label="Backup-Slots" hint="0–20. 0 = keine Backups. Ab 1 legt das System auch den automatischen täglichen Backup-Zeitplan an.">
                <NumberInput value={p.backups} max={20} onChange={(v) => onChange({ backups: v })} />
              </Labeled>
              <Labeled label="Datenbank-Slots" hint="0–20. Braucht einen Datenbank-Host im Panel (Admin → Databases).">
                <NumberInput value={p.databases} max={20} onChange={(v) => onChange({ databases: v })} />
              </Labeled>
              <Labeled label="Netzwerk-Slots (Ports)" hint="1–10. 1 = nur der Hauptport. Weitere Ports legt der Nutzer im Panel unter „Network“ an.">
                <NumberInput value={p.allocations} min={1} max={10} onChange={(v) => onChange({ allocations: v })} />
              </Labeled>
            </div>
            {p.allocations > 1 && (
              <p className="mt-3 text-[13px] leading-relaxed text-subtle">
                Damit Nutzer zusätzliche Ports selbst anlegen können, muss im Panel unter Settings → Advanced die „Automatic Allocation Creation“ mit einem Portbereich
                eingeschaltet sein – sonst bleibt der Knopf dort ohne Wirkung.
              </p>
            )}
            {count > 0 && (
              <ApplySlots planId={p.id} count={count} unsaved={!saved || saved.backups !== p.backups || saved.databases !== p.databases || saved.allocations !== p.allocations} />
            )}
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <Toggle checked={p.highlighted ?? false} onChange={(v) => onChange({ highlighted: v })} label="Hervorgehoben" hint="Hervorgehobene Karte auf der Website" />
            <Toggle checked={p.enabled} onChange={(v) => onChange({ enabled: v })} label="Aktiv (wählbar)" hint="Aus = nicht mehr wählbar, bestehende Server laufen weiter" />
          </div>
          {issues.length > 0 && (
            <ul className="space-y-0.5 text-[13px] text-amber-300">
              {issues.map((i) => (
                <li key={i}>{i}</li>
              ))}
            </ul>
          )}
          {count > 0 && (
            <p className="text-[13px] text-amber-300">
              {nf(count)} {count === 1 ? 'bestehender Server nutzt' : 'bestehende Server nutzen'} dieses Paket. Beim Entfernen laufen sie mit ihren bisherigen Ressourcen
              weiter; geänderte Ressourcen (RAM, CPU, Speicher) gelten nur für neue Server. Slots lassen sich oben auf bestehende Server übertragen.
            </p>
          )}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-[12px] text-subtle">
              {p.id ? (
                <>
                  ID: <span className="font-mono text-gray-300">{p.id}</span> (bleibt auch bei einem neuen Namen gleich)
                </>
              ) : (
                <>
                  ID wird beim Speichern aus dem Namen erzeugt{p.name.trim() ? <>: <span className="font-mono text-gray-300">{planIdFromName(p.name)}</span></> : ''}
                </>
              )}
            </p>
            <ActionButton
              label="Entfernen"
              confirm={count > 0 ? `Wirklich entfernen? ${nf(count)} Server nutzen es` : 'Wirklich entfernen?'}
              danger
              run={async () => onRemove()}
            />
          </div>
        </div>
      )}
    </li>
  );
}

/* ------------------------------------------------------------ Produkt */

export function ProductEditor({
  kind,
  product,
  onChange,
  planCounts,
  productCount,
  savedPlans = [],
}: {
  kind: ProductKind;
  product: ProductSettings;
  onChange: (v: Partial<ProductSettings>) => void;
  /** Über die Website belegte Plätze je Paket-ID */
  planCounts: Record<string, number>;
  /** Über die Website belegte Plätze des Produkts (null = unbekannt) */
  productCount: number | null;
  /** Gespeicherter Stand der Pakete (für „Slots übertragen“) */
  savedPlans?: PlanSetting[];
}) {
  // Immer nur ein Paket aufgeklappt (Index in der Liste)
  const [open, setOpen] = useState<number | null>(null);
  const plans = product.plans;
  const limit = maxPlans(kind);
  const site = productCount ?? plans.reduce((sum, p) => sum + (planCounts[p.id] ?? 0), 0);
  const used = site + product.reserved;
  const setPlans = (next: PlanSetting[]) => onChange({ plans: next });

  const move = (index: number, dir: -1 | 1) => {
    const to = index + dir;
    if (to < 0 || to >= plans.length) return;
    const next = [...plans];
    [next[index], next[to]] = [next[to]!, next[index]!];
    setPlans(next);
    setOpen((o) => (o === index ? to : o === to ? index : o));
  };

  return (
    <div className="space-y-5 rounded-lg border border-line p-4">
      <div>
        <p className="text-sm font-semibold text-white">{PRODUCT_LABEL[kind]}</p>
        <p className="mt-0.5 text-[13px] text-subtle">
          Über die Website belegt: {nf(site)}
          {product.reserved > 0 ? ` · außerhalb: ${nf(product.reserved)}` : ''} · gesamt {nf(used)} · Öffentlich:{' '}
          {product.enabled ? <PublicUsage capacity={product.capacity} used={used} /> : <span className="text-amber-300">nicht angeboten</span>}
        </p>
      </div>

      <Toggle
        checked={product.enabled}
        onChange={(v) => onChange({ enabled: v })}
        label="Auf der Website anbieten"
        hint="Aus = das Produkt ist nicht mehr bestellbar. Bestehende Server laufen weiter."
      />
      <div className="grid gap-4 sm:grid-cols-2">
        <Labeled label="Maximale Plätze gesamt" hint="Über alle Pakete zusammen · leer = unbegrenzt">
          <CapacityInput value={product.capacity} onChange={(v) => onChange({ capacity: v })} />
        </Labeled>
        <Labeled label="Außerhalb belegt" hint="Server auf denselben Nodes, die nicht über diese Website erstellt wurden">
          <NumberInput value={product.reserved} max={1000000} onChange={(v) => onChange({ reserved: v })} />
        </Labeled>
      </div>
      <Toggle
        checked={product.fairUse}
        onChange={(v) => onChange({ fairUse: v })}
        label="Fair-Use-System"
        hint="An = maximale Laufzeit am Stück + Wochen-Offline-Zeit wie bei Minecraft. Aus = Dauerbetrieb, nur der 30-Tage-Zyklus gilt – empfohlen für Discord-Bots."
      />

      <div>
        <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
          <p className="text-sm font-medium text-gray-200">
            Pakete ({plans.length} von {limit})
          </p>
          <p className="text-[12px] text-subtle">Reihenfolge wie auf der Website · zum Bearbeiten aufklappen</p>
        </div>
        {plans.length > 0 ? (
          <ul className="space-y-2">
            {plans.map((p, index) => (
              <PlanRow
                key={index}
                plan={p}
                saved={p.id ? savedPlans.find((x) => x.id === p.id) : undefined}
                count={planCounts[p.id] ?? 0}
                open={open === index}
                first={index === 0}
                last={index === plans.length - 1}
                onToggle={() => setOpen(open === index ? null : index)}
                onChange={(v) => setPlans(plans.map((x, i) => (i === index ? { ...x, ...v } : x)))}
                onMove={(dir) => move(index, dir)}
                onRemove={() => {
                  setPlans(plans.filter((_, i) => i !== index));
                  setOpen(null);
                }}
              />
            ))}
          </ul>
        ) : (
          <p className="rounded-lg border border-amber-400/25 bg-amber-400/[0.07] p-3 text-[13px] text-amber-200">
            Keine Pakete – ohne Paket ist {kind === 'discord' ? 'kein Discord-Bot' : 'kein Minecraft-Server'} bestellbar.
          </p>
        )}
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            icon={<Plus />}
            disabled={plans.length >= limit}
            onClick={() => {
              setPlans([...plans, newPlan(kind)]);
              setOpen(plans.length);
            }}
          >
            Paket hinzufügen
          </Button>
          <ActionButton
            label="Standard-Pakete wiederherstellen"
            confirm="Alle Pakete durch die Standard-Pakete ersetzen?"
            run={async () => {
              setPlans(defaultPlans(kind));
              setOpen(null);
            }}
          />
          <span className="text-[12px] text-subtle">
            {plans.length >= limit ? `Höchstens ${limit} Pakete – zum Hinzufügen erst eines entfernen.` : `höchstens ${limit} Pakete`}
          </span>
        </div>
      </div>
    </div>
  );
}
