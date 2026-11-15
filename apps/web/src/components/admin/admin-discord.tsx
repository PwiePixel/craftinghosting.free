'use client';

/**
 * Admin → Discord: Zugangsdaten des Bots, Pflicht-Mitgliedschaft, Rollen, Einladungslink,
 * Willkommensnachricht, Rollen-Panels und Tickets. Bot-Token und Client-Secret werden nur gesendet,
 * nie zurückgegeben – ein leeres Feld lässt den gespeicherten Wert unverändert.
 */
import { useRouter } from 'next/navigation';
import { useState, type ReactNode } from 'react';
import { CheckCircle2, ExternalLink, Plus, RefreshCw, Save, Send, Trash2, XCircle } from 'lucide-react';
import {
  defaultDiscordWelcome,
  discordLimits,
  discordWelcomePlaceholders,
  type AdminDiscordDTO,
  type DiscordRolePanel,
  type DiscordSettings,
  type DiscordSetupStep,
  type SiteSettings,
} from '@chfree/shared';
import { Labeled, NumberInput, Section, Toggle } from '@/components/admin/admin-settings';
import { Button } from '@/components/ui/button';
import { api, ApiClientError } from '@/lib/api/client';
import { cn } from '@/lib/utils';

type Message = { ok: boolean; text: string } | null;

const onlyDigits = (v: string) => v.replace(/\D/g, '').slice(0, 22);

/** Liest mehrere Rollen-IDs aus einem Textfeld: getrennt durch Komma, Semikolon, Leerzeichen oder Zeilenumbruch */
function parseRoleIds(text: string): { ids: string[]; invalid: string[]; tooMany: boolean } {
  const parts = [...new Set(text.split(/[,;\s]+/).filter(Boolean))];
  const valid = parts.filter((p) => /^\d{15,22}$/.test(p));
  return { ids: valid.slice(0, discordLimits.autoRoles), invalid: parts.filter((p) => !/^\d{15,22}$/.test(p)), tooMany: valid.length > discordLimits.autoRoles };
}

function Text({ value, onChange, placeholder, maxLength = 200, type = 'text', mono }: { value: string; onChange: (v: string) => void; placeholder?: string; maxLength?: number; type?: string; mono?: boolean }) {
  return (
    <input
      type={type}
      className={cn('input', mono && 'font-mono text-[13px]')}
      value={value}
      maxLength={maxLength}
      placeholder={placeholder}
      autoComplete={type === 'password' ? 'new-password' : 'off'}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

/** Feld für eine Discord-ID (Rolle, Kanal, Server) */
function IdInput({ value, onChange, placeholder = 'z. B. 123456789012345678' }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  return <input type="text" inputMode="numeric" className="input font-mono text-[13px]" value={value} placeholder={placeholder} onChange={(e) => onChange(onlyDigits(e.target.value))} />;
}

function Area({ value, onChange, rows = 4, maxLength = 2000 }: { value: string; onChange: (v: string) => void; rows?: number; maxLength?: number }) {
  return <textarea className="input min-h-[88px] py-2.5 leading-relaxed" rows={rows} value={value} maxLength={maxLength} onChange={(e) => onChange(e.target.value)} />;
}

function Copy({ value }: { value: string }) {
  const [done, setDone] = useState(false);
  return (
    <span className="flex items-center gap-2">
      <code className="min-w-0 flex-1 truncate rounded-md border border-line bg-black/30 px-2.5 py-1.5 text-[13px] text-gray-200">{value}</code>
      <Button
        variant="secondary"
        size="sm"
        onClick={() => {
          void navigator.clipboard?.writeText(value).then(() => {
            setDone(true);
            setTimeout(() => setDone(false), 1500);
          });
        }}
      >
        {done ? 'Kopiert' : 'Kopieren'}
      </Button>
    </span>
  );
}

function Note({ message }: { message: Message }) {
  return message ? <span className={cn('text-sm', message.ok ? 'text-emerald-300' : 'text-red-300')}>{message.text}</span> : null;
}

const errorText = (err: unknown) => (err instanceof ApiClientError ? err.message : 'Das hat nicht geklappt.');

const GATEWAY: Record<AdminDiscordDTO['gateway']['status'], { label: string; cls: string }> = {
  online: { label: 'Bot ist online', cls: 'text-emerald-300' },
  connecting: { label: 'Bot verbindet sich …', cls: 'text-amber-300' },
  error: { label: 'Bot ist nicht verbunden', cls: 'text-red-300' },
  off: { label: 'Bot ist aus', cls: 'text-subtle' },
};

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 py-2 sm:flex-row sm:items-baseline sm:gap-4">
      <dt className="w-44 shrink-0 text-[13px] text-subtle">{label}</dt>
      <dd className="min-w-0 text-sm break-words text-gray-100">{children}</dd>
    </div>
  );
}

/** Kanal-ID eingeben und eine Nachricht des Bots dorthin posten */
function SendToChannel({ kind, panelId, disabled, hint }: { kind: 'roles' | 'tickets'; panelId?: string; disabled?: boolean; hint?: string }) {
  const [channelId, setChannelId] = useState('');
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<Message>(null);
  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        <div className="w-60">
          <IdInput value={channelId} onChange={setChannelId} placeholder="Kanal-ID" />
        </div>
        <Button
          variant="secondary"
          size="sm"
          icon={<Send />}
          loading={pending}
          disabled={disabled || channelId.length < 15}
          onClick={async () => {
            setPending(true);
            setMessage(null);
            try {
              await api('/admin/discord/send-panel', { body: { kind, panelId, channelId } });
              setMessage({ ok: true, text: 'Gepostet.' });
            } catch (err) {
              setMessage({ ok: false, text: errorText(err) });
            } finally {
              setPending(false);
            }
          }}
        >
          In Kanal senden
        </Button>
        <Note message={message} />
      </div>
      {hint && <p className="mt-1.5 text-[13px] text-subtle">{hint}</p>}
    </div>
  );
}

export function DiscordAdmin({ settings, status: initialStatus }: { settings: SiteSettings; status: AdminDiscordDTO }) {
  const router = useRouter();
  const [d, setD] = useState<DiscordSettings>(settings.discord);
  const [baseline, setBaseline] = useState(() => JSON.stringify(settings.discord));
  const [status, setStatus] = useState(initialStatus);
  const [botToken, setBotToken] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [steps, setSteps] = useState<DiscordSetupStep[] | null>(null);
  const [autoRolesText, setAutoRolesText] = useState(() => settings.discord.autoRoleIds.join(', '));
  const autoRoles = parseRoleIds(autoRolesText);
  const [pending, setPending] = useState<'save' | 'setup' | 'roles' | null>(null);
  const [message, setMessage] = useState<Message>(null);

  const set = (patch: Partial<DiscordSettings>) => setD((v) => ({ ...v, ...patch }));
  const setWelcome = (patch: Partial<DiscordSettings['welcome']>) => setD((v) => ({ ...v, welcome: { ...v.welcome, ...patch } }));
  const setPanel = (id: string, patch: Partial<DiscordRolePanel>) => setD((v) => ({ ...v, rolePanels: v.rolePanels.map((p) => (p.id === id ? { ...p, ...patch } : p)) }));
  const dirty = JSON.stringify(d) !== baseline || !!botToken || !!clientSecret;
  const savedPanels = (JSON.parse(baseline) as DiscordSettings).rolePanels;

  async function save(): Promise<boolean> {
    setPending('save');
    setMessage(null);
    try {
      if (botToken || clientSecret) {
        const res = await api<{ discord: AdminDiscordDTO }>('/admin/discord/secrets', { body: { ...(botToken ? { botToken } : {}), ...(clientSecret ? { clientSecret } : {}) } });
        setStatus(res.discord);
        setBotToken('');
        setClientSecret('');
      }
      // Aktuellen Stand holen, damit Änderungen aus anderen Reitern nicht überschrieben werden
      const current = (await api<{ settings: SiteSettings }>('/admin/settings')).settings;
      const saved = (await api<{ settings: SiteSettings }>('/admin/settings', { body: { ...current, discord: d } })).settings.discord;
      setD(saved);
      setBaseline(JSON.stringify(saved));
      setAutoRolesText(saved.autoRoleIds.join(', '));
      setStatus((await api<{ discord: AdminDiscordDTO }>('/admin/discord')).discord);
      setMessage({ ok: true, text: 'Gespeichert. Der Bot übernimmt Änderungen innerhalb von etwa 20 Sekunden.' });
      router.refresh();
      return true;
    } catch (err) {
      setMessage({ ok: false, text: errorText(err) });
      return false;
    } finally {
      setPending(null);
    }
  }

  async function setup() {
    if (dirty && !(await save())) return;
    setPending('setup');
    setSteps(null);
    try {
      const res = await api<{ steps: DiscordSetupStep[]; discord: AdminDiscordDTO }>('/admin/discord/setup', { body: {} });
      setSteps(res.steps);
      setStatus(res.discord);
    } catch (err) {
      setMessage({ ok: false, text: errorText(err) });
    } finally {
      setPending(null);
    }
  }

  const gateway = GATEWAY[status.gateway.status];
  const welcomeDefaults = defaultDiscordWelcome();

  return (
    <div className="space-y-5">
      <Section
        title="Discord-Bot verbinden"
        description="Der Bot verknüpft Website-Accounts mit Discord, prüft die Mitgliedschaft auf eurem Server, vergibt Rollen, begrüßt neue Mitglieder und betreibt das Ticketsystem."
      >
        <ol className="list-decimal space-y-2.5 pl-5 text-sm leading-relaxed text-muted">
          <li>
            Im{' '}
            <a href="https://discord.com/developers/applications" target="_blank" rel="noopener" className="text-blue-400 hover:text-blue-300">
              Discord Developer Portal
            </a>{' '}
            eine Anwendung anlegen. Unter <span className="text-gray-200">Bot</span> das Token erzeugen und bei „Privileged Gateway Intents“ den{' '}
            <span className="text-gray-200">Server Members Intent</span> einschalten (nötig für Willkommensnachricht, Auto-Rollen und „Rolle an alle“).
          </li>
          <li>
            Unter <span className="text-gray-200">OAuth2 → Redirects</span> diese Adresse eintragen:
            <span className="mt-1.5 block">
              <Copy value={status.redirectUri} />
            </span>
          </li>
          <li>
            Client-ID, Client-Secret (OAuth2), Bot-Token und die ID eures Discord-Servers unten eintragen und speichern. IDs kopierst du in Discord per Rechtsklick, wenn in den
            Einstellungen unter „Erweitert“ der Entwicklermodus an ist.
          </li>
          <li>
            Den Bot auf euren Server einladen
            {status.botInviteUrl ? (
              <>
                :{' '}
                <a href={status.botInviteUrl} target="_blank" rel="noopener" className="inline-flex items-center gap-1 text-blue-400 hover:text-blue-300">
                  Bot einladen <ExternalLink className="size-3.5" aria-hidden />
                </a>
              </>
            ) : (
              ' (der Link erscheint hier, sobald die Client-ID gespeichert ist)'
            )}
            . Er braucht das Recht „Administrator“, damit <code>/wartung</code> alle Kanäle sperren und wieder freigeben kann. Danach die Bot-Rolle in den Servereinstellungen über
            alle Rollen ziehen, die der Bot vergeben soll.
          </li>
          <li>„Verbindung prüfen &amp; einrichten“ klicken: Der Bot registriert seine Befehle und erstellt den Einladungslink.</li>
        </ol>

        <Toggle checked={d.enabled} onChange={(enabled) => set({ enabled })} label="Discord-Anbindung einschalten" hint="Ausgeschaltet trennt sich der Bot und die Website zeigt keine Discord-Verknüpfung." />
        <div className="grid gap-4 sm:grid-cols-2">
          <Labeled label="Client-ID (Application ID)">
            <IdInput value={d.clientId} onChange={(clientId) => set({ clientId })} />
          </Labeled>
          <Labeled label="Server-ID (Guild ID)">
            <IdInput value={d.guildId} onChange={(guildId) => set({ guildId })} />
          </Labeled>
          <Labeled label="Bot-Token" hint={status.hasBotToken ? 'Gespeichert (verschlüsselt). Nur ausfüllen, um es zu ersetzen.' : 'Noch nicht hinterlegt.'}>
            <Text type="password" mono value={botToken} onChange={setBotToken} placeholder={status.hasBotToken ? '•••••••••••• gespeichert' : 'Token aus „Bot“'} />
          </Labeled>
          <Labeled label="Client-Secret" hint={status.hasClientSecret ? 'Gespeichert (verschlüsselt). Nur ausfüllen, um es zu ersetzen.' : 'Noch nicht hinterlegt.'}>
            <Text type="password" mono value={clientSecret} onChange={setClientSecret} placeholder={status.hasClientSecret ? '•••••••••••• gespeichert' : 'Secret aus „OAuth2“'} />
          </Labeled>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <Button variant="secondary" icon={<RefreshCw />} loading={pending === 'setup'} onClick={setup}>
            Verbindung prüfen &amp; einrichten
          </Button>
          <span className={cn('text-sm font-medium', gateway.cls)}>{gateway.label}</span>
          {status.gateway.error && <span className="text-sm text-red-300">{status.gateway.error}</span>}
        </div>
        {steps && (
          <ul className="space-y-1.5 rounded-lg border border-line p-4">
            {steps.map((s) => (
              <li key={s.name} className="flex gap-2.5 text-sm">
                {s.ok ? <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-400" aria-hidden /> : <XCircle className="mt-0.5 size-4 shrink-0 text-red-400" aria-hidden />}
                <span>
                  <span className="font-medium text-white">{s.name}</span> <span className="break-words text-muted">– {s.detail}</span>
                </span>
              </li>
            ))}
          </ul>
        )}
        <dl className="divide-y divide-line rounded-lg border border-line px-4">
          <Row label="Bot">{status.bot ? status.bot.username : '–'}</Row>
          <Row label="Discord-Server">{status.guild ? `${status.guild.name}${status.guild.memberCount ? ` · ${status.guild.memberCount} Mitglieder` : ''}` : '–'}</Row>
          <Row label="Einladungslink">
            {status.inviteUrl ? (
              <a href={status.inviteUrl} target="_blank" rel="noopener" className="text-blue-400 hover:text-blue-300">
                {status.inviteUrl}
              </a>
            ) : (
              'noch nicht erstellt'
            )}
          </Row>
          <Row label="Verknüpfte Accounts">{status.linkedUsers}</Row>
          <Row label="Verknüpfen möglich">{status.linkReady ? 'Ja' : 'Nein – es fehlen Angaben oben'}</Row>
        </dl>
      </Section>

      <Section
        title="Pflicht-Mitgliedschaft"
        description="Schutz vor Mehrfach-Anmeldungen: Kostenlose Server bekommt nur, wer sein Discord-Konto verknüpft hat und Mitglied eures Servers ist. Jedes Discord-Konto lässt sich nur mit einem Account verknüpfen. Die Pflicht greift erst, wenn die Anbindung oben vollständig eingerichtet ist."
      >
        <Toggle
          checked={d.required}
          onChange={(required) => set({ required })}
          label="Discord-Mitgliedschaft ist Pflicht"
          hint="Gilt beim Erstellen und beim Reaktivieren. Offene Anfragen warten, bis das Konto verknüpft ist. Bereits laufende Server bleiben bestehen."
        />
        <Toggle
          checked={d.autoJoin}
          onChange={(autoJoin) => set({ autoJoin })}
          label="Beim Verknüpfen automatisch dem Server beitreten"
          hint="Discord fragt dabei nach der Erlaubnis „Servern beitreten“. Ausgeschaltet müssen Nutzer selbst über den Einladungslink beitreten."
        />
        <Labeled label="Mindestalter des Discord-Kontos (Tage)" hint="0 = egal. Frisch angelegte Konten sind das typische Werkzeug für Mehrfach-Anmeldungen." className="max-w-xs">
          <NumberInput value={d.minAccountAgeDays} min={0} max={3650} onChange={(minAccountAgeDays) => set({ minAccountAgeDays })} />
        </Labeled>
        <div className="grid gap-3 sm:grid-cols-2">
          <Labeled label="Hinweis auf der Website (Deutsch)" hint="Leer = Standardtext.">
            <Area rows={3} maxLength={400} value={d.requiredNote.de} onChange={(de) => set({ requiredNote: { ...d.requiredNote, de } })} />
          </Labeled>
          <Labeled label="Hinweis auf der Website (Englisch)">
            <Area rows={3} maxLength={400} value={d.requiredNote.en} onChange={(en) => set({ requiredNote: { ...d.requiredNote, en } })} />
          </Labeled>
        </div>
      </Section>

      <Section title="Rollen" description="Rollen-IDs kopierst du in Discord unter Servereinstellungen → Rollen per Rechtsklick. Die Bot-Rolle muss über diesen Rollen stehen.">
        <div className="grid gap-4 sm:grid-cols-2">
          <Labeled label="Customer-Rolle" hint="Bekommt automatisch, wer einen Server oder Bot bei euch hat – und verliert sie, wenn keiner mehr da ist.">
            <IdInput value={d.customerRoleId} onChange={(customerRoleId) => set({ customerRoleId })} />
          </Labeled>
          <Labeled label="Support-Rolle" hint="Sieht alle Tickets und darf sie schließen und löschen. Leer = nur Administratoren.">
            <IdInput value={d.supportRoleId} onChange={(supportRoleId) => set({ supportRoleId })} />
          </Labeled>
        </div>
        <Labeled
          label="Rollen beim Betreten des Servers"
          hint={
            <>
              Jedes neue Mitglied bekommt diese Rollen automatisch. Mehrere Rollen-IDs mit Komma, Leerzeichen oder Zeilenumbruch trennen (höchstens {discordLimits.autoRoles}).{' '}
              <span className={autoRoles.invalid.length || autoRoles.tooMany ? 'text-amber-300' : 'text-gray-300'}>
                {autoRoles.ids.length} von {discordLimits.autoRoles} Rollen erkannt
                {autoRoles.invalid.length > 0 && ` · keine gültige ID: ${autoRoles.invalid.join(', ')}`}
                {autoRoles.tooMany && ` · mehr als ${discordLimits.autoRoles} – die übrigen werden nicht gespeichert`}
              </span>
            </>
          }
        >
          {/* Eigener Text-Zustand: Das Feld zeigt genau, was getippt wurde (auch ein Komma am Ende) */}
          <textarea
            className="input min-h-[72px] py-2.5 font-mono text-[13px] leading-relaxed"
            rows={3}
            value={autoRolesText}
            placeholder="z. B. 123456789012345678, 234567890123456789"
            onChange={(e) => {
              const text = e.target.value.replace(/[^\d,;\s]/g, '');
              setAutoRolesText(text);
              set({ autoRoleIds: parseRoleIds(text).ids });
            }}
          />
        </Labeled>
        <div className="flex flex-wrap items-center gap-3">
          <Button
            variant="secondary"
            size="sm"
            icon={<RefreshCw />}
            loading={pending === 'roles'}
            disabled={!status.botReady || !d.customerRoleId}
            onClick={async () => {
              setPending('roles');
              setMessage(null);
              try {
                const res = await api<{ checked: number; failed: number }>('/admin/discord/sync-roles', { body: {} });
                setMessage({ ok: res.failed === 0, text: `Customer-Rolle für ${res.checked} verknüpfte Accounts abgeglichen${res.failed ? `, ${res.failed} fehlgeschlagen` : ''}.` });
              } catch (err) {
                setMessage({ ok: false, text: errorText(err) });
              } finally {
                setPending(null);
              }
            }}
          >
            Customer-Rolle jetzt für alle abgleichen
          </Button>
          <span className="text-[13px] text-subtle">Läuft sonst automatisch alle zwei Minuten.</span>
        </div>
      </Section>

      <Section title="Einladungslink" description="Der Bot erstellt eine dauerhafte Einladung und ersetzt sie, falls sie gelöscht wird. Die Website verwendet diesen Link überall dort, wo auf Discord verwiesen wird.">
        <Labeled label="Kanal für die Einladung" hint="Leer = Systemkanal des Servers bzw. der erste Textkanal." className="max-w-md">
          <IdInput value={d.inviteChannelId} onChange={(inviteChannelId) => set({ inviteChannelId })} placeholder="Kanal-ID (optional)" />
        </Labeled>
      </Section>

      <Section title="Willkommensnachricht" description="Der Bot begrüßt jedes neue Mitglied mit Profilbild und – wenn vorhanden – dem Profil-Banner.">
        <Toggle checked={d.welcome.enabled} onChange={(enabled) => setWelcome({ enabled })} label="Neue Mitglieder begrüßen" />
        <div className="grid gap-4 sm:grid-cols-2">
          <Labeled label="Kanal">
            <IdInput value={d.welcome.channelId} onChange={(channelId) => setWelcome({ channelId })} placeholder="Kanal-ID" />
          </Labeled>
          <Labeled label="Farbe des Balkens">
            <input type="color" className="h-10 w-16 cursor-pointer rounded border border-line bg-transparent p-0.5" value={d.welcome.color} onChange={(e) => setWelcome({ color: e.target.value })} />
          </Labeled>
        </div>
        <Labeled label="Text über dem Kasten">
          <Text value={d.welcome.content} maxLength={500} onChange={(content) => setWelcome({ content })} />
        </Labeled>
        <Labeled label="Überschrift">
          <Text value={d.welcome.title} maxLength={200} onChange={(title) => setWelcome({ title })} />
        </Labeled>
        <Labeled label="Text">
          <Area rows={7} value={d.welcome.description} onChange={(description) => setWelcome({ description })} />
        </Labeled>
        <div className="grid gap-4 sm:grid-cols-2">
          <Labeled label="Fußzeile">
            <Text value={d.welcome.footer} maxLength={200} onChange={(footer) => setWelcome({ footer })} />
          </Labeled>
          <Labeled label="Ersatzbild ohne eigenes Banner" hint="Adresse eines Bildes (https://…). Leer = kein Bild.">
            <Text type="url" value={d.welcome.fallbackImageUrl} maxLength={500} placeholder="https://…" onChange={(fallbackImageUrl) => setWelcome({ fallbackImageUrl })} />
          </Labeled>
        </div>
        <Toggle checked={d.welcome.showBanner} onChange={(showBanner) => setWelcome({ showBanner })} label="Profil-Banner des Mitglieds als großes Bild zeigen" />
        <div className="flex flex-wrap items-start justify-between gap-3">
          <ul className="grid gap-x-6 gap-y-1 text-[13px] text-subtle sm:grid-cols-2">
            {discordWelcomePlaceholders.map(([key, label]) => (
              <li key={key}>
                <code className="text-gray-300">{key}</code> – {label}
              </li>
            ))}
          </ul>
          <Button variant="ghost" size="sm" onClick={() => setWelcome({ content: welcomeDefaults.content, title: welcomeDefaults.title, description: welcomeDefaults.description, footer: welcomeDefaults.footer })}>
            Texte zurücksetzen
          </Button>
        </div>
      </Section>

      <Section
        title="Rollen-Panels"
        description="Nachrichten mit Buttons, über die sich Mitglieder selbst Rollen geben und wieder nehmen – zum Beispiel für Ankündigungen oder um zwischen Free Hosting und Paid Hosting zu wählen. Welche Kanäle eine Rolle sieht, legst du in Discord in den Kanal-Berechtigungen fest."
      >
        <ul className="space-y-4">
          {d.rolePanels.map((p) => {
            const saved = savedPanels.find((x) => x.id === p.id);
            const sendable = !!saved && JSON.stringify(saved) === JSON.stringify(p) && p.buttons.some((b) => b.roleId);
            return (
              <li key={p.id} className="space-y-4 rounded-lg border border-line p-4">
                <div className="flex flex-wrap items-end gap-3">
                  <Labeled label="Überschrift" className="min-w-[200px] flex-1">
                    <Text value={p.title} maxLength={100} onChange={(title) => setPanel(p.id, { title })} />
                  </Labeled>
                  <Button variant="danger" size="sm" icon={<Trash2 />} onClick={() => set({ rolePanels: d.rolePanels.filter((x) => x.id !== p.id) })}>
                    Panel löschen
                  </Button>
                </div>
                <Labeled label="Text">
                  <Area rows={4} maxLength={1500} value={p.text} onChange={(text) => setPanel(p.id, { text })} />
                </Labeled>
                <div className="space-y-2">
                  <p className="text-sm font-medium text-gray-200">Buttons</p>
                  {p.buttons.map((b, i) => {
                    const setButton = (patch: Partial<typeof b>) => setPanel(p.id, { buttons: p.buttons.map((x, j) => (j === i ? { ...x, ...patch } : x)) });
                    return (
                      <div key={i} className="grid gap-2 sm:grid-cols-[80px_1fr_1fr_auto]">
                        <input type="text" className="input text-center" value={b.emoji} maxLength={16} placeholder="Emoji" aria-label="Emoji" onChange={(e) => setButton({ emoji: e.target.value })} />
                        <input type="text" className="input" value={b.label} maxLength={60} placeholder="Beschriftung" aria-label="Beschriftung" onChange={(e) => setButton({ label: e.target.value })} />
                        <IdInput value={b.roleId} onChange={(roleId) => setButton({ roleId })} placeholder="Rollen-ID" />
                        <Button variant="ghost" size="sm" icon={<Trash2 />} aria-label="Button entfernen" onClick={() => setPanel(p.id, { buttons: p.buttons.filter((_, j) => j !== i) })} />
                      </div>
                    );
                  })}
                  <Button variant="secondary" size="sm" icon={<Plus />} disabled={p.buttons.length >= discordLimits.buttonsPerPanel} onClick={() => setPanel(p.id, { buttons: [...p.buttons, { label: '', emoji: '', roleId: '' }] })}>
                    Button hinzufügen
                  </Button>
                </div>
                <Toggle checked={p.exclusive} onChange={(exclusive) => setPanel(p.id, { exclusive })} label="Nur eine Rolle gleichzeitig" hint="Wer eine Rolle dieses Panels wählt, verliert die anderen – z. B. entweder Free Hosting oder Paid Hosting." />
                <SendToChannel kind="roles" panelId={p.id} disabled={!status.botReady || !sendable} hint={sendable ? `Oder im Kanal selbst: /rollenpanel` : 'Erst speichern und mindestens eine Rollen-ID eintragen – Buttons ohne Rollen-ID werden nicht gepostet.'} />
              </li>
            );
          })}
        </ul>
        <Button
          variant="secondary"
          size="sm"
          icon={<Plus />}
          disabled={d.rolePanels.length >= discordLimits.rolePanels}
          onClick={() => {
            const used = new Set(d.rolePanels.map((p) => p.id));
            let n = d.rolePanels.length + 1;
            while (used.has(`panel-${n}`)) n++;
            set({ rolePanels: [...d.rolePanels, { id: `panel-${n}`, title: 'Roles', text: '', exclusive: false, buttons: [{ label: '', emoji: '', roleId: '' }] }] });
          }}
        >
          Panel hinzufügen
        </Button>
      </Section>

      <Section
        title="Tickets"
        description="Mitglieder öffnen über das Ticket-Panel ein Ticket. Ist ihr Discord-Konto verknüpft, erkennt der Bot ihre Server und Bots; im Ticket stehen automatisch Account-ID und Server-ID des gewählten Produkts."
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Labeled label="Kategorie für Ticket-Kanäle" hint="Leer = der Bot legt die Kategorie „Tickets“ an.">
            <IdInput value={d.ticketCategoryId} onChange={(ticketCategoryId) => set({ ticketCategoryId })} placeholder="Kategorie-ID (optional)" />
          </Labeled>
          <Labeled label="Offene Tickets je Mitglied">
            <NumberInput value={d.maxOpenTickets} min={1} max={discordLimits.maxOpenTickets} onChange={(maxOpenTickets) => set({ maxOpenTickets })} />
          </Labeled>
        </div>
        <SendToChannel kind="tickets" disabled={!status.botReady} hint="Oder im Kanal selbst: /ticketpanel" />
      </Section>

      <Section title="Befehle des Bots" description="Alle Befehle sind nur für Mitglieder mit dem Recht „Administrator“.">
        <dl className="divide-y divide-line rounded-lg border border-line px-4">
          <Row label="/rolle geben · nehmen">Gibt oder nimmt einem Mitglied eine Rolle.</Row>
          <Row label="/rolle alle">Gibt allen Mitgliedern (ohne Bots) eine Rolle.</Row>
          <Row label="/wartung an">
            Sperrt alle Kanäle: Nur Administratoren sehen sie noch. Der Bot legt die Rolle „Wartung“ an, gibt sie allen Mitgliedern und zeigt einen Hinweis-Kanal. Die bisherigen
            Berechtigungen werden vorher gesichert.
          </Row>
          <Row label="/wartung aus">Stellt alle Berechtigungen wieder her, löscht den Hinweis-Kanal und die Rolle „Wartung“.</Row>
          <Row label="/ticketpanel">Postet das Ticket-Panel in den aktuellen Kanal.</Row>
          <Row label="/rollenpanel">Postet ein Rollen-Panel in den aktuellen Kanal.</Row>
        </dl>
      </Section>

      <div className="sticky bottom-3 z-10 flex flex-wrap items-center gap-3 rounded-xl border border-line-strong bg-[#0d1017]/95 px-4 py-3 shadow-xl backdrop-blur">
        <Button onClick={() => void save()} loading={pending === 'save'} disabled={!dirty} icon={<Save />}>
          Discord-Einstellungen speichern
        </Button>
        {message ? <Note message={message} /> : dirty && <span className="text-sm text-amber-300">Ungespeicherte Änderungen</span>}
      </div>
    </div>
  );
}
