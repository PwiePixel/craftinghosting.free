'use client';

/**
 * Admin → Partner-API: Partner (z. B. ein Minecraft-Launcher) anlegen und verwalten. Beim Anlegen entstehen
 * automatisch ein Konto mit dem Namen des Partners, ein Panel-Konto und ein API-Key – der Key ist nur einmal sichtbar.
 */
import { useState } from 'react';
import { Copy, KeyRound, Plus, Save, Trash2 } from 'lucide-react';
import type { AdminPartnerDTO, AdminPartnerInput } from '@chfree/shared';
import { Labeled, Section, Toggle } from '@/components/admin/admin-settings';
import { Button } from '@/components/ui/button';
import { api, ApiClientError } from '@/lib/api/client';
import { cn } from '@/lib/utils';

type Plan = { id: string; name: string; memoryMb: number; enabled: boolean };
type Message = { ok: boolean; text: string } | null;
const errorText = (err: unknown) => (err instanceof ApiClientError ? err.message : 'Das hat nicht geklappt.');
const dateTime = (iso: string | null) => (iso ? new Date(iso).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' }) : 'noch nie');
const numberOf = (v: string, fallback: number) => (Number.isFinite(Number(v)) && v.trim() !== '' ? Math.round(Number(v)) : fallback);
const nodesOf = (v: string) => [...new Set(v.split(/[\s,;]+/).map(Number).filter((n) => Number.isInteger(n) && n > 0))];

const emptyInput = (planId: string): AdminPartnerInput => ({ name: '', planId, maxServers: 100, maxServersPerPlayer: 1, sessionMaxHours: 24, cooldownHours: 2, heartbeatTimeoutSeconds: 180, deleteAfterIdleDays: 30, nodeIds: [] });

function Fields({ value, set, plans }: { value: AdminPartnerInput; set: (patch: Partial<AdminPartnerInput>) => void; plans: Plan[] }) {
  const num = (key: keyof AdminPartnerInput, label: string, hint: string) => (
    <Labeled label={label} hint={hint}>
      <input className="input" inputMode="numeric" value={String(value[key])} onChange={(e) => set({ [key]: numberOf(e.target.value.replace(/\D/g, ''), 0) } as Partial<AdminPartnerInput>)} />
    </Labeled>
  );
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      <Labeled label="Name des Partners" hint="So heißen auch das Konto und das Panel-Konto.">
        <input className="input" value={value.name} maxLength={60} placeholder="z. B. Nova Launcher" onChange={(e) => set({ name: e.target.value })} />
      </Labeled>
      <Labeled label="Paket" hint="Jeder Server des Partners bekommt dieses Paket. Auch nicht öffentliche Pakete sind möglich.">
        <select className="input" value={value.planId} onChange={(e) => set({ planId: e.target.value })}>
          {plans.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name} – {p.memoryMb >= 1024 ? `${p.memoryMb / 1024} GB` : `${p.memoryMb} MB`} RAM{p.enabled ? '' : ' · nicht öffentlich'}
            </option>
          ))}
        </select>
      </Labeled>
      {num('maxServers', 'Server insgesamt (höchstens)', 'Zählt nicht gegen die Plätze der Website.')}
      {num('maxServersPerPlayer', 'Server je Spieler', 'So viele Server darf ein Nutzer des Partners haben.')}
      {num('sessionMaxHours', 'Laufzeit bis zur Pause (Stunden)', 'Danach wird der Server gestoppt.')}
      {num('cooldownHours', 'Länge der Pause (Stunden)', 'Erst danach lässt sich der Server über die API wieder starten.')}
      {num('heartbeatTimeoutSeconds', 'Stopp ohne Lebenszeichen nach (Sekunden)', 'Mindestens 60. Meldet sich der Launcher so lange nicht, geht der Server aus.')}
      {num('deleteAfterIdleDays', 'Ungenutzte Server löschen nach (Tagen)', '0 = nie. Gezählt ab dem letzten Start.')}
      <Labeled label="Feste Nodes (IDs, optional)" hint="Leer = wie normale Minecraft-Server. Hier sind auch private Nodes erlaubt, z. B. „4, 5“.">
        <input className="input" value={value.nodeIds.join(', ')} placeholder="z. B. 4, 5" onChange={(e) => set({ nodeIds: nodesOf(e.target.value) })} />
      </Labeled>
    </div>
  );
}

/** Der Key im Klartext – nur direkt nach dem Anlegen bzw. Erneuern */
function KeyBox({ apiKey, name }: { apiKey: string; name: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="rounded-lg border border-emerald-400/40 bg-emerald-400/[0.07] p-4" role="status">
      <p className="text-sm font-medium text-emerald-100">API-Key für „{name}“ – wird nur jetzt angezeigt</p>
      <p className="mt-1 text-[13px] leading-relaxed text-emerald-100/85">
        Kopiere ihn und gib ihn dem Partner auf einem sicheren Weg. Wir speichern nur einen Fingerabdruck; geht der Key verloren, stellst du einen neuen aus.
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <code className="rounded bg-black/40 px-2.5 py-1.5 font-mono text-[13px] break-all text-white">{apiKey}</code>
        <Button
          size="sm"
          variant="secondary"
          icon={<Copy />}
          onClick={() => {
            void navigator.clipboard?.writeText(apiKey).then(() => setCopied(true));
          }}
        >
          {copied ? 'Kopiert' : 'Kopieren'}
        </Button>
      </div>
    </div>
  );
}

function PartnerCard({ partner, plans, onChange }: { partner: AdminPartnerDTO; plans: Plan[]; onChange: (list: AdminPartnerDTO[]) => void }) {
  const [value, setValue] = useState<AdminPartnerInput & { enabled: boolean }>(partner);
  const [pending, setPending] = useState<'save' | 'key' | 'delete' | null>(null);
  const [message, setMessage] = useState<Message>(null);
  const [newKey, setNewKey] = useState<string | null>(null);
  const [armed, setArmed] = useState<'key' | 'delete' | null>(null);
  const body = (): AdminPartnerInput & { enabled: boolean } => ({ name: value.name, planId: value.planId, maxServers: value.maxServers, maxServersPerPlayer: value.maxServersPerPlayer, sessionMaxHours: value.sessionMaxHours, cooldownHours: value.cooldownHours, heartbeatTimeoutSeconds: value.heartbeatTimeoutSeconds, deleteAfterIdleDays: value.deleteAfterIdleDays, nodeIds: value.nodeIds, enabled: value.enabled });

  async function run(kind: 'save' | 'key' | 'delete', action: () => Promise<string | null>) {
    setPending(kind);
    setMessage(null);
    try {
      const text = await action();
      if (text) setMessage({ ok: true, text });
    } catch (err) {
      setMessage({ ok: false, text: errorText(err) });
    } finally {
      setPending(null);
      setArmed(null);
    }
  }
  const save = () =>
    run('save', async () => {
      const res = await api<{ partners: AdminPartnerDTO[] }>(`/admin/partners/${partner.id}`, { body: body() });
      onChange(res.partners);
      return 'Gespeichert.';
    });
  const rotate = () =>
    run('key', async () => {
      const res = await api<{ apiKey: string }>(`/admin/partners/${partner.id}/rotate-key`, { body: {} });
      setNewKey(res.apiKey);
      return 'Neuer Key ausgestellt – der alte gilt ab sofort nicht mehr.';
    });
  const remove = () =>
    run('delete', async () => {
      // Löscht in Runden: zuerst die Server (im Panel), zum Schluss den Partner
      for (let round = 0; round < 400; round++) {
        const res = await api<{ deleted: boolean; remaining: number }>(`/admin/partners/${partner.id}/delete`, { body: {} });
        if (res.deleted) break;
        setMessage({ ok: true, text: `Server werden gelöscht – noch ${res.remaining} …` });
      }
      onChange((await api<{ partners: AdminPartnerDTO[] }>('/admin/partners')).partners);
      return null;
    });

  return (
    <Section
      title={partner.name}
      description={
        <>
          Konto <span className="font-mono text-[12px] text-gray-300">{partner.accountEmail}</span> · Panel-Konto <span className="font-mono text-[12px] text-gray-300">{partner.panelUsername ?? '–'}</span> · Key{' '}
          <span className="font-mono text-[12px] text-gray-300">{partner.keyPrefix}…</span> · zuletzt benutzt {dateTime(partner.lastUsedAt)}
        </>
      }
    >
      <dl className="mb-5 flex flex-wrap gap-x-10 gap-y-2 text-sm">
        {[
          ['Server', `${partner.servers} von ${partner.maxServers}`],
          ['Laufen gerade', String(partner.running)],
          ['Spieler', String(partner.players)],
          ['Status', partner.enabled ? 'aktiv' : 'deaktiviert'],
        ].map(([label, text]) => (
          <div key={label}>
            <dt className="text-[13px] text-subtle">{label}</dt>
            <dd className={cn('mt-0.5 font-medium', label === 'Status' && !partner.enabled ? 'text-amber-300' : 'text-white')}>{text}</dd>
          </div>
        ))}
      </dl>
      {newKey && (
        <div className="mb-5">
          <KeyBox apiKey={newKey} name={partner.name} />
        </div>
      )}
      <Fields value={value} set={(patch) => setValue({ ...value, ...patch })} plans={plans} />
      <div className="mt-5">
        <Toggle checked={value.enabled} onChange={(enabled) => setValue({ ...value, enabled })} label="Zugang aktiv" hint="Ausgeschaltet wird der API-Key abgelehnt; laufende Server des Partners werden gestoppt. Daten bleiben erhalten." />
      </div>
      <div className="mt-5 flex flex-wrap items-center gap-2">
        <Button size="sm" icon={<Save />} loading={pending === 'save'} disabled={pending !== null || value.name.trim().length < 2} onClick={save}>
          Speichern
        </Button>
        <Button size="sm" variant="secondary" icon={<KeyRound />} loading={pending === 'key'} disabled={pending !== null} onClick={() => (armed === 'key' ? rotate() : setArmed('key'))}>
          {armed === 'key' ? 'Wirklich? Der alte Key gilt dann nicht mehr' : 'Neuen API-Key ausstellen'}
        </Button>
        <Button size="sm" variant="danger" icon={<Trash2 />} loading={pending === 'delete'} disabled={pending !== null} onClick={() => (armed === 'delete' ? remove() : setArmed('delete'))}>
          {armed === 'delete' ? `Wirklich löschen – samt ${partner.servers} Servern und allen Daten?` : 'Partner löschen'}
        </Button>
        {message && <span className={cn('text-sm', message.ok ? 'text-emerald-300' : 'text-red-300')}>{message.text}</span>}
      </div>
    </Section>
  );
}

export function PartnerManager({ initial, plans, apiBase }: { initial: AdminPartnerDTO[]; plans: Plan[]; apiBase: string }) {
  const [partners, setPartners] = useState(initial);
  const [value, setValue] = useState<AdminPartnerInput>(emptyInput(plans[0]?.id ?? ''));
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<Message>(null);
  const [created, setCreated] = useState<{ apiKey: string; name: string } | null>(null);

  async function create() {
    setPending(true);
    setMessage(null);
    try {
      const res = await api<{ apiKey: string; partners: AdminPartnerDTO[] }>('/admin/partners', { body: value });
      setCreated({ apiKey: res.apiKey, name: value.name.trim() });
      setPartners(res.partners);
      setValue(emptyInput(value.planId));
    } catch (err) {
      setMessage({ ok: false, text: errorText(err) });
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="space-y-5">
      <Section
        title="Partner-API"
        description="Für Partner, die unser Hosting in ihr Programm einbauen – z. B. ein Minecraft-Launcher, in dem Spieler Server erstellen, die bei uns laufen. Jeder Partner bekommt einen API-Key. Alle seine Server laufen unter seinem eigenen Konto; jeder seiner Nutzer bekommt automatisch eine Spieler-ID, die im Servernamen steht."
      >
        <ul className="list-disc space-y-1.5 pl-5 text-sm leading-relaxed text-muted">
          <li>Ein Server läuft nur, solange der Launcher des Hosts sich meldet. Schließt der Spieler den Launcher, fährt der Server herunter – die Welt bleibt gespeichert.</li>
          <li>Nach der eingestellten Laufzeit (Standard 24 Stunden) folgt eine Pause (Standard 2 Stunden). Danach muss der Server über die API neu gestartet werden.</li>
          <li>Diese Server haben keinen 30-Tage-Zyklus, zählen nicht gegen die Plätze der Website und erscheinen unter „Server“ beim Konto des Partners.</li>
          <li>
            Adresse der API: <code className="rounded bg-white/5 px-1.5 py-0.5 font-mono text-[12px] text-gray-200">{apiBase}</code> · Beschreibung für den Partner: <code className="font-mono text-[12px] text-gray-200">docs/partner-api.md</code> im Projekt.
          </li>
          <li>Der API-Key gehört auf den Server des Partners, nicht in den Launcher selbst – aus einem Programm, das an Spieler verteilt wird, lässt er sich auslesen.</li>
        </ul>
      </Section>

      <Section title="Neuen Partner anlegen" description="Dabei entstehen automatisch ein Konto mit dem Namen des Partners, ein Panel-Konto dafür und der API-Key.">
        {plans.length === 0 ? (
          <p className="text-sm text-amber-200">Es gibt noch kein Minecraft-Paket (Einstellungen → Produkte &amp; Pakete).</p>
        ) : (
          <>
            <Fields value={value} set={(patch) => setValue({ ...value, ...patch })} plans={plans} />
            <div className="mt-5 flex flex-wrap items-center gap-3">
              <Button icon={<Plus />} loading={pending} disabled={value.name.trim().length < 2} onClick={create}>
                Partner anlegen und API-Key erzeugen
              </Button>
              {message && <span className={cn('text-sm', message.ok ? 'text-emerald-300' : 'text-red-300')}>{message.text}</span>}
            </div>
          </>
        )}
        {created && (
          <div className="mt-5">
            <KeyBox apiKey={created.apiKey} name={created.name} />
          </div>
        )}
      </Section>

      {partners.map((p) => (
        <PartnerCard key={p.id} partner={p} plans={plans} onChange={setPartners} />
      ))}
    </div>
  );
}
