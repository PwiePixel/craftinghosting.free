'use client';

/**
 * Admin → Einstellungen → Server-Software: der Katalog dessen, was beim Erstellen eines Minecraft-Servers zur Wahl
 * steht. Je Eintrag: auf der Website / über die Partner-API anbieten, und wie die Software auf den Server kommt –
 * über das Software-Verzeichnis MCJars (dafür genügt das eine Egg von Paper als Grundlage) oder über ein eigenes Egg.
 * Eigene Einträge lassen sich hinzufügen (z. B. weitere Software aus MCJars oder ein eigenes Egg für Bedrock).
 */
import { useEffect, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { DIRECTORY_NOT_GAME_SERVERS, type SiteSettings, type SoftwareInstall, type SoftwareItem } from '@chfree/shared';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/api/client';
import { cn } from '@/lib/utils';
import { Labeled, Section, Toggle } from './admin-settings';

type Update = (fn: (prev: SiteSettings) => SiteSettings) => void;
type DirectoryType = { id: string; name: string; group: string; deprecated: boolean; experimental: boolean; versions: number };
type PanelEgg = { nestId: number; nestName: string; eggId: number; name: string };
type Status = { directory: DirectoryType[] | null; eggs: PanelEgg[]; baseEgg: boolean; status: Record<string, { method: 'egg' | 'directory' | null; ownEgg: boolean }> };
/** Einträge bei MCJars, die keine Spielserver sind (Proxys, Warteräume): immer nur über ein eigenes Egg */
const NOT_GAME = (d: DirectoryType) => DIRECTORY_NOT_GAME_SERVERS.includes(d.id) || d.versions === 0;

const INSTALL_LABEL: Record<SoftwareInstall, string> = {
  auto: 'Automatisch (eigenes Egg, sonst MCJars)',
  directory: 'Über MCJars (kein eigenes Egg nötig)',
  egg: 'Über ein eigenes Egg',
};

const slug = (name: string) =>
  name
    .toLowerCase()
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/^[^a-z]+/, '')
    .slice(0, 24);

export function SoftwareCatalog({ s, update }: { s: SiteSettings; update: Update }) {
  const [info, setInfo] = useState<Status | null>(null);
  const [draft, setDraft] = useState({ name: '', directory: '', edition: 'java' as 'java' | 'bedrock' });
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let stop = false;
    api<Status>('/admin/software')
      .then((r) => !stop && setInfo(r))
      .catch(() => !stop && setInfo(null));
    return () => {
      stop = true;
    };
  }, []);

  const set = (id: string, patch: Partial<SoftwareItem>) => update((p) => ({ ...p, software: p.software.map((x) => (x.id === id ? { ...x, ...patch } : x)) }));
  const remove = (id: string) => update((p) => ({ ...p, software: p.software.filter((x) => x.id !== id), versions: Object.fromEntries(Object.entries(p.versions).filter(([k]) => k !== id)) }));
  const directory = info?.directory ?? null;
  const known = new Set(directory?.map((d) => d.id));

  function add() {
    const name = draft.name.trim();
    const id = slug(name);
    if (!name || id.length < 2) return setError('Bitte einen Namen angeben (mindestens zwei Buchstaben).');
    if (s.software.some((x) => x.id === id) || id === 'python' || id === 'nodejs') return setError('Einen Eintrag mit diesem Namen gibt es schon.');
    setError(null);
    update((p) => ({
      ...p,
      software: [
        ...p.software,
        { id, name: name.slice(0, 30), description: { de: '', en: '' }, edition: draft.edition, directory: draft.edition === 'java' ? draft.directory : '', install: draft.edition === 'java' && draft.directory ? 'auto' : 'egg', website: false, partner: false, versionVariable: '', custom: true, eggOnly: !(draft.edition === 'java' && draft.directory) },
      ],
    }));
    setDraft({ name: '', directory: '', edition: 'java' });
  }

  /** Wie der Eintrag nach dem aktuellen (gespeicherten) Stand installiert wird */
  const statusText = (item: SoftwareItem): { text: string; ok: boolean } => {
    const st = info?.status[item.id];
    if (!st) return { text: 'Stand nach dem Speichern sichtbar.', ok: true };
    if (item.eggOnly && st.method === null) return { text: 'Nicht verfügbar: Diese Software läuft nur über ein eigenes Egg – ordne ihr im Reiter „Pterodactyl“ eines zu.', ok: false };
    if (st.method === 'directory') return { text: `Wird über MCJars eingerichtet (${item.directory}) – auf der gewählten Grundlage, mit passender Java-Version.`, ok: true };
    if (st.method === 'egg') return { text: 'Wird über das eigene Egg installiert (Zuordnung unter „Pterodactyl“).', ok: true };
    if (!info?.baseEgg && item.directory) return { text: 'Nicht verfügbar: Es ist keine Grundlage gewählt und dem Typ Paper ist kein Egg zugeordnet.', ok: false };
    return { text: item.directory ? 'Nicht verfügbar: Für „Über ein eigenes Egg“ ist kein Egg zugeordnet (Reiter „Pterodactyl“).' : 'Nicht verfügbar: Diese Software gibt es nicht bei MCJars – sie braucht ein eigenes Egg (Reiter „Pterodactyl“).', ok: false };
  };

  return (
    <Section
      title="Server-Software"
      description={
        <>
          Was beim Erstellen eines Minecraft-Servers zur Wahl steht – und wie es installiert wird. Für alles, was es im Software-Verzeichnis <strong>MCJars</strong> gibt (Paper, Purpur, Fabric, Forge, NeoForge, Quilt, Spigot …), brauchst du
          kein eigenes Egg: Der Server wird mit der unten gewählten Grundlage (Nest und Egg) angelegt, danach richten wir die gewählte Software in der gewählten Version ein und stellen die passende Java-Version ein. Bedrock und Proxys (Velocity, BungeeCord) laufen ausschließlich über ein
          eigenes Egg. Eggs ordnest du im Reiter „Pterodactyl“ zu.
        </>
      }
    >
      <Labeled
        label="Grundlage für MCJars (Nest und Egg)"
        hint="Mit diesem Egg legt das Panel den Server an; danach kommt die gewählte Software darauf. Am besten ein einfaches Java-Egg mit dem Startbefehl „java … -jar server.jar“ und Images für mehrere Java-Versionen (z. B. das Paper-Egg)."
      >
        <select
          className="input md:max-w-xl"
          value={s.softwareBase ? `${s.softwareBase.nestId}:${s.softwareBase.eggId}` : ''}
          onChange={(e) => {
            const egg = info?.eggs.find((x) => `${x.nestId}:${x.eggId}` === e.target.value);
            update((p) => ({ ...p, softwareBase: egg ? { nestId: egg.nestId, eggId: egg.eggId, name: `${egg.nestName} › ${egg.name}` } : null }));
          }}
        >
          <option value="">Automatisch: das Egg, das Paper zugeordnet ist</option>
          {s.softwareBase && !info?.eggs.some((x) => x.nestId === s.softwareBase!.nestId && x.eggId === s.softwareBase!.eggId) && <option value={`${s.softwareBase.nestId}:${s.softwareBase.eggId}`}>{s.softwareBase.name || `Egg ${s.softwareBase.eggId}`}</option>}
          {info?.eggs.map((x) => (
            <option key={`${x.nestId}:${x.eggId}`} value={`${x.nestId}:${x.eggId}`}>
              {x.nestName} › {x.name}
            </option>
          ))}
        </select>
      </Labeled>
      {info && info.eggs.length === 0 && <p className="text-[13px] text-amber-200">Die Eggs des Panels ließen sich gerade nicht laden – die Auswahl der Grundlage ist deshalb leer.</p>}
      {info && !info.baseEgg && <p className="rounded-lg border border-amber-400/40 bg-amber-400/[0.06] px-3 py-2 text-sm text-amber-200">Es ist noch keine Grundlage vorhanden: Wähle oben ein Egg oder ordne dem Typ Paper im Reiter „Pterodactyl“ eines zu.</p>}
      {info && directory === null && <p className="text-[13px] text-amber-200">MCJars ist gerade nicht erreichbar – die Auswahl der Software ist deshalb ein Textfeld.</p>}
      <ul className="divide-y divide-line overflow-hidden rounded-lg border border-line">
        {s.software.map((item) => {
          const st = statusText(item);
          return (
            <li key={item.id} className="space-y-3 px-4 py-4">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                <p className="text-sm font-medium text-white">
                  {item.name} <span className="font-mono text-[11px] font-normal text-subtle">{item.id}</span>
                </p>
                <span className={cn('rounded px-1.5 py-0.5 text-[11px]', item.edition === 'bedrock' ? 'bg-emerald-400/15 text-emerald-200' : 'bg-white/5 text-subtle')}>{item.edition === 'bedrock' ? 'Bedrock Edition' : 'Java Edition'}</span>
                {item.custom && <span className="rounded bg-blue-400/15 px-1.5 py-0.5 text-[11px] text-blue-200">eigener Eintrag</span>}
                {item.custom && (
                  <button type="button" className="ml-auto inline-flex items-center gap-1 text-[13px] text-subtle hover:text-red-300" onClick={() => remove(item.id)}>
                    <Trash2 className="size-3.5" aria-hidden /> entfernen
                  </button>
                )}
              </div>
              <div className="grid gap-x-6 gap-y-3 md:grid-cols-2">
                <Toggle checked={item.website} onChange={(website) => set(item.id, { website })} label="Auf der Website anbieten" hint="Steht im Bestellformular zur Wahl." />
                {item.edition === 'java' && !item.eggOnly ? (
                  <Toggle checked={item.partner} onChange={(partner) => set(item.id, { partner })} label="Über die Partner-API anbieten" hint="Für Launcher-Partner wählbar." />
                ) : (
                  <p className="text-[13px] text-subtle">Über die Partner-API nicht wählbar (dort nur Java-Spielserver, die über MCJars eingerichtet werden).</p>
                )}
                <Labeled label="Installation" hint={item.eggOnly ? 'Diese Software läuft nur über ein eigenes Egg (Bedrock, Proxys und alles, was es bei MCJars nicht gibt).' : undefined}>
                  {item.eggOnly ? (
                    <select className="input" value="egg" disabled>
                      <option value="egg">Nur über ein eigenes Egg</option>
                    </select>
                  ) : (
                    <select className="input" value={item.install} onChange={(e) => set(item.id, { install: e.target.value as SoftwareInstall })}>
                      {(['auto', 'directory', 'egg'] as const).map((v) => (
                        <option key={v} value={v}>
                          {INSTALL_LABEL[v]}
                        </option>
                      ))}
                    </select>
                  )}
                </Labeled>
                {item.custom && item.edition === 'java' ? (
                  <Labeled label="Software bei MCJars" hint="Leer = nicht über MCJars (dann braucht der Eintrag ein eigenes Egg).">
                    {directory ? (
                      <select className="input" value={item.directory} onChange={(e) => set(item.id, { directory: e.target.value, eggOnly: !e.target.value, install: e.target.value ? (item.install === 'egg' && item.eggOnly ? 'auto' : item.install) : 'egg', partner: e.target.value ? item.partner : false })}>
                        <option value="">– keine (nur über ein eigenes Egg) –</option>
                        {item.directory && !known.has(item.directory) && <option value={item.directory}>{item.directory}</option>}
                        {directory.map((d) => (
                          <option key={d.id} value={d.id} disabled={NOT_GAME(d)}>
                            {d.name}
                            {d.deprecated ? ' (veraltet)' : d.experimental ? ' (experimentell)' : ''}
                            {NOT_GAME(d) ? ' – Proxy: nur über ein eigenes Egg' : ''}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <input className="input font-mono" placeholder="z. B. MOHIST" value={item.directory} maxLength={24} onChange={(e) => set(item.id, { directory: e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, '') })} />
                    )}
                  </Labeled>
                ) : (
                  <Labeled label="Software bei MCJars">
                    <p className="pt-2 text-sm text-gray-300">{item.directory ? <span className="font-mono">{item.directory}</span> : 'nicht vorhanden – eigenes Egg nötig'}</p>
                  </Labeled>
                )}
                {item.custom && (
                  <>
                    <Labeled label="Name">
                      <input className="input" value={item.name} maxLength={30} onChange={(e) => set(item.id, { name: e.target.value })} />
                    </Labeled>
                    <Labeled label="Beschreibung (Deutsch)" hint="Erscheint im Bestellformular unter der Auswahl.">
                      <input className="input" value={item.description.de} maxLength={200} onChange={(e) => set(item.id, { description: { ...item.description, de: e.target.value } })} />
                    </Labeled>
                    <Labeled label="Beschreibung (Englisch)" hint="Leer = der deutsche Text.">
                      <input className="input" value={item.description.en} maxLength={200} onChange={(e) => set(item.id, { description: { ...item.description, en: e.target.value } })} />
                    </Labeled>
                  </>
                )}
                {(item.install === 'egg' || item.eggOnly) && (
                  <Labeled label="Variable des Eggs für die Version" hint="Leer = wird automatisch erkannt (z. B. MINECRAFT_VERSION, BEDROCK_VERSION).">
                    <input className="input font-mono" placeholder="automatisch" value={item.versionVariable} maxLength={40} onChange={(e) => set(item.id, { versionVariable: e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, '') })} />
                  </Labeled>
                )}
              </div>
              <p className={cn('text-[13px]', st.ok ? 'text-subtle' : 'text-amber-200')}>{st.text}</p>
            </li>
          );
        })}
      </ul>

      <div className="rounded-lg border border-line p-4">
        <p className="text-sm font-medium text-gray-200">Software hinzufügen</p>
        <div className="mt-3 grid gap-3 md:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)_auto] md:items-end">
          <Labeled label="Name">
            <input className="input" placeholder="z. B. Mohist" value={draft.name} maxLength={30} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
          </Labeled>
          <Labeled label="Edition">
            <select className="input" value={draft.edition} onChange={(e) => setDraft({ ...draft, edition: e.target.value as 'java' | 'bedrock' })}>
              <option value="java">Java</option>
              <option value="bedrock">Bedrock</option>
            </select>
          </Labeled>
          <Labeled label="Software bei MCJars">
            {draft.edition === 'bedrock' ? (
              <p className="pt-2 text-[13px] text-subtle">Bedrock gibt es nicht bei MCJars – eigenes Egg nötig.</p>
            ) : directory ? (
              <select className="input" value={draft.directory} onChange={(e) => setDraft({ ...draft, directory: e.target.value })}>
                <option value="">– keine (eigenes Egg) –</option>
                {directory.map((d) => (
                  <option key={d.id} value={d.id} disabled={NOT_GAME(d)}>
                    {d.name}
                    {d.deprecated ? ' (veraltet)' : d.experimental ? ' (experimentell)' : ''}
                    {NOT_GAME(d) ? ' – Proxy: nur über ein eigenes Egg' : ''}
                  </option>
                ))}
              </select>
            ) : (
              <input className="input font-mono" placeholder="z. B. MOHIST" value={draft.directory} maxLength={24} onChange={(e) => setDraft({ ...draft, directory: e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, '') })} />
            )}
          </Labeled>
          <Button type="button" variant="secondary" icon={<Plus />} onClick={add}>
            Hinzufügen
          </Button>
        </div>
        {error && <p className="mt-2 text-sm text-red-300">{error}</p>}
        <p className="mt-2 text-[13px] text-subtle">Neue Einträge sind zunächst ausgeschaltet. Nach dem Speichern erscheinen sie auch unter „Minecraft-Versionen“ und im Reiter „Pterodactyl“.</p>
      </div>
    </Section>
  );
}
