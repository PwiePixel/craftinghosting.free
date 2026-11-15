'use client';

/**
 * Admin → Discord: Belohnungssystem (Einladungen und Server-Boosts), Ankündigung und Honeypot-Kanal.
 * Die Einstellungen gehören zu den Discord-Einstellungen und werden mit „Speichern“ dort gesichert.
 */
import { useState } from 'react';
import { Plus, RefreshCw, Send, Trash2 } from 'lucide-react';
import {
  discordLimits,
  type AdminDiscordDTO,
  type AdminRewardsDTO,
  type BoostRewardSlot,
  type BoostRewardTier,
  type DiscordSettings,
  type InviteRewardKind,
  type InviteRewardTier,
  type ProductKind,
  type SiteSettings,
} from '@chfree/shared';
import { Labeled, NumberInput, Section, Toggle } from '@/components/admin/admin-settings';
import { Button } from '@/components/ui/button';
import { api, ApiClientError } from '@/lib/api/client';
import { cn } from '@/lib/utils';

type Message = { ok: boolean; text: string } | null;
const errorText = (err: unknown) => (err instanceof ApiClientError ? err.message : 'Das hat nicht geklappt.');
const onlyDigits = (v: string) => v.replace(/\D/g, '').slice(0, 22);

function IdInput({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  return <input type="text" inputMode="numeric" className="input font-mono text-[13px]" value={value} placeholder={placeholder} onChange={(e) => onChange(onlyDigits(e.target.value))} />;
}

function Note({ message }: { message: Message }) {
  return message ? <span className={cn('text-sm', message.ok ? 'text-emerald-300' : 'text-red-300')}>{message.text}</span> : null;
}

const KIND_LABEL: Record<ProductKind, string> = { minecraft: 'Minecraft-Server', discord: 'Discord-Bot' };
const REWARD_LABEL: Record<InviteRewardKind, string> = { choice: 'Slot nach Wahl (Minecraft oder Bot)', minecraft: 'Minecraft-Server', discord: 'Discord-Bot' };

export function RewardsSections({
  d,
  set,
  settings,
  status,
  dirty,
}: {
  d: DiscordSettings;
  set: (patch: Partial<DiscordSettings>) => void;
  settings: SiteSettings;
  status: AdminDiscordDTO;
  /** Es gibt ungespeicherte Änderungen – Ankündigung und Einrichtung arbeiten mit dem gespeicherten Stand */
  dirty: boolean;
}) {
  const inv = d.inviteRewards;
  const boost = d.boostRewards;
  const setInv = (patch: Partial<DiscordSettings['inviteRewards']>) => set({ inviteRewards: { ...inv, ...patch } });
  const setBoost = (patch: Partial<DiscordSettings['boostRewards']>) => set({ boostRewards: { ...boost, ...patch } });
  const setTier = (index: number, patch: Partial<InviteRewardTier>) => setInv({ tiers: inv.tiers.map((t, i) => (i === index ? { ...t, ...patch } : t)) });
  const setBoostTier = (index: number, patch: Partial<BoostRewardTier>) => setBoost({ tiers: boost.tiers.map((t, i) => (i === index ? { ...t, ...patch } : t)) });
  const plans = (kind: ProductKind) => settings.products[kind].plans;

  /** Auswahl für einen Boost-Slot: „Angebot:Paket-Regel“ */
  const slotOptions: { value: string; label: string }[] = (['minecraft', 'discord'] as const).flatMap((kind) => [
    { value: `${kind}:smallest`, label: `${KIND_LABEL[kind]} – kleinstes Paket` },
    { value: `${kind}:largest`, label: `${KIND_LABEL[kind]} – größtes Paket` },
    ...plans(kind).map((p) => ({ value: `${kind}:${p.id}`, label: `${KIND_LABEL[kind]} – ${p.name}` })),
  ]);
  const parseSlot = (value: string): BoostRewardSlot => {
    const [kind, ...rest] = value.split(':');
    return { kind: kind === 'discord' ? 'discord' : 'minecraft', planId: rest.join(':') };
  };

  return (
    <>
      <Section
        title="Belohnungen für Einladungen"
        description="Wer aktive Nutzer auf euren Discord-Server bringt, bekommt zusätzliche Slots. Der Bot merkt sich, über wessen Einladungslink jemand beigetreten ist. Eine Einladung zählt, sobald die eingeladene Person ihr Discord-Konto mit einem Website-Account verknüpft hat und ihr Server in den letzten Tagen online war. Wird eine Stufe erreicht, schreibt der Bot eine Direktnachricht mit einem Button zum Einlösen."
      >
        <Toggle checked={inv.enabled} onChange={(enabled) => setInv({ enabled })} label="Belohnungen für Einladungen einschalten" hint="Einladungen merkt sich der Bot immer – eingeschaltet werden hier nur die Belohnungen." />
        <div className="grid gap-4 sm:grid-cols-3">
          <Labeled label="Server online in den letzten … Tagen" hint="1–90. So lange zurück darf der Server der eingeladenen Person zuletzt gelaufen sein.">
            <NumberInput value={inv.activeDays} min={1} max={90} onChange={(activeDays) => setInv({ activeDays })} />
          </Labeled>
          <Labeled label="Mindestens … Tage Mitglied" hint="0–90. Schützt vor Konten, die nur kurz beitreten. 0 = zählt sofort.">
            <NumberInput value={inv.minMemberDays} min={0} max={90} onChange={(minMemberDays) => setInv({ minMemberDays })} />
          </Labeled>
          <Labeled label="Ersatz-Kanal" hint="Kanal-ID. Hat jemand Direktnachrichten deaktiviert, erwähnt der Bot die Person hier und verweist auf „!rewards“. Gilt auch für Boosts.">
            <IdInput value={inv.fallbackChannelId} onChange={(fallbackChannelId) => setInv({ fallbackChannelId })} placeholder="Kanal-ID" />
          </Labeled>
        </div>

        <div>
          <p className="text-sm font-medium text-gray-200">Stufen</p>
          <p className="mt-1 text-[13px] text-subtle">Jede Stufe gibt es je Person einmal. Bei „Slot nach Wahl“ entscheidet die Person beim Einlösen zwischen Minecraft-Server und Discord-Bot.</p>
          <ul className="mt-3 space-y-2">
            {inv.tiers.map((t, index) => (
              <li key={index} className="grid gap-3 rounded-lg border border-line bg-black/20 p-3 sm:grid-cols-[130px_1fr_1fr_auto] sm:items-end">
                <Labeled label="Einladungen">
                  <NumberInput value={t.invites} min={1} max={10000} onChange={(invites) => setTier(index, { invites })} className="max-w-none" />
                </Labeled>
                <Labeled label="Belohnung">
                  <select className="input" value={t.reward} onChange={(e) => setTier(index, { reward: e.target.value as InviteRewardKind, planId: t.planId === 'smallest' ? 'smallest' : '' })}>
                    {(Object.keys(REWARD_LABEL) as InviteRewardKind[]).map((k) => (
                      <option key={k} value={k}>
                        {REWARD_LABEL[k]}
                      </option>
                    ))}
                  </select>
                </Labeled>
                <Labeled label="Paket">
                  <select className="input" value={t.planId} onChange={(e) => setTier(index, { planId: e.target.value })}>
                    <option value="">jedes Paket</option>
                    <option value="smallest">nur das kleinste Paket</option>
                    {t.reward !== 'choice' &&
                      plans(t.reward).map((p) => (
                        <option key={p.id} value={p.id}>
                          nur {p.name}
                        </option>
                      ))}
                  </select>
                </Labeled>
                <Button variant="ghost" size="sm" icon={<Trash2 />} onClick={() => setInv({ tiers: inv.tiers.filter((_, i) => i !== index) })}>
                  Entfernen
                </Button>
              </li>
            ))}
          </ul>
          <Button
            variant="secondary"
            size="sm"
            icon={<Plus />}
            className="mt-3"
            disabled={inv.tiers.length >= discordLimits.rewardTiers}
            onClick={() => setInv({ tiers: [...inv.tiers, { id: '', invites: (inv.tiers[inv.tiers.length - 1]?.invites ?? 5) + 5, reward: 'choice', planId: '' }] })}
          >
            Stufe hinzufügen
          </Button>
        </div>
      </Section>

      <Section
        title="Belohnungen für Server-Boosts"
        description="Solange jemand euren Discord-Server boostet, bekommt der verknüpfte Website-Account zusätzliche Server. Es gilt immer die höchste erreichte Stufe (die Stufen addieren sich nicht). Steigt jemand auf und hat schon einen Server im kleineren Paket, stuft das System diesen automatisch auf das größere Paket hoch. Endet der Boost, laufen die Server bis zum Ende ihrer Laufzeit weiter und lassen sich danach nicht mehr verlängern."
      >
        <Toggle checked={boost.enabled} onChange={(enabled) => setBoost({ enabled })} label="Belohnungen für Boosts einschalten" />
        <ul className="space-y-2">
          {boost.tiers.map((t, index) => (
            <li key={index} className="rounded-lg border border-line bg-black/20 p-3">
              <div className="flex flex-wrap items-end gap-3">
                <Labeled label="Ab … Boosts" className="w-32">
                  <NumberInput value={t.boosts} min={1} max={50} onChange={(boosts) => setBoostTier(index, { boosts })} className="max-w-none" />
                </Labeled>
                <div className="min-w-0 flex-1 space-y-2">
                  <p className="text-sm font-medium text-gray-200">Zusätzliche Server</p>
                  {t.slots.map((s, si) => (
                    <div key={si} className="flex items-center gap-2">
                      <select
                        className="input"
                        value={`${s.kind}:${s.planId}`}
                        onChange={(e) => setBoostTier(index, { slots: t.slots.map((x, i) => (i === si ? parseSlot(e.target.value) : x)) })}
                      >
                        {slotOptions.map((o) => (
                          <option key={o.value} value={o.value}>
                            {o.label}
                          </option>
                        ))}
                      </select>
                      <Button variant="ghost" size="sm" disabled={t.slots.length <= 1} onClick={() => setBoostTier(index, { slots: t.slots.filter((_, i) => i !== si) })}>
                        ✕
                      </Button>
                    </div>
                  ))}
                  <div className="flex flex-wrap gap-2">
                    <Button variant="secondary" size="sm" icon={<Plus />} disabled={t.slots.length >= discordLimits.boostSlots} onClick={() => setBoostTier(index, { slots: [...t.slots, { kind: 'minecraft', planId: 'smallest' }] })}>
                      Server
                    </Button>
                    <Button variant="ghost" size="sm" icon={<Trash2 />} onClick={() => setBoost({ tiers: boost.tiers.filter((_, i) => i !== index) })}>
                      Stufe entfernen
                    </Button>
                  </div>
                </div>
              </div>
            </li>
          ))}
        </ul>
        <Button
          variant="secondary"
          size="sm"
          icon={<Plus />}
          disabled={boost.tiers.length >= discordLimits.boostTiers}
          onClick={() => setBoost({ tiers: [...boost.tiers, { boosts: (boost.tiers[boost.tiers.length - 1]?.boosts ?? 0) + 1, slots: [{ kind: 'minecraft', planId: 'largest' }] }] })}
        >
          Stufe hinzufügen
        </Button>
        <p className="text-[13px] leading-relaxed text-subtle">
          Discord nennt Bots nicht, wie oft ein Mitglied boostet. Der Bot zählt deshalb die Boost-Meldungen im Systemkanal – dafür müssen dort in den Servereinstellungen die
          „Boost-Nachrichten“ eingeschaltet sein. Boosts von vor dem Einschalten zählen als ein Boost. Nimmt jemand nur einen von mehreren Boosts zurück, merkt der Bot das
          nicht; die Anzahl lässt sich unten von Hand setzen.
        </p>
        <BoostManual />
      </Section>

      <Section
        title="Belohnungssystem ankündigen"
        description="Der Bot postet eine Ankündigung mit allen eingeschalteten Stufen (Deutsch und Englisch) in einen Kanal und erwähnt dabei eine Rolle – z. B. eure Mitglieder-Rolle."
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Labeled label="Kanal für die Ankündigung">
            <IdInput value={inv.announceChannelId} onChange={(announceChannelId) => setInv({ announceChannelId })} placeholder="Kanal-ID" />
          </Labeled>
          <Labeled label="Rolle erwähnen (optional)" hint="Rollen-ID. Leer = niemand wird erwähnt.">
            <IdInput value={inv.announceRoleId} onChange={(announceRoleId) => setInv({ announceRoleId })} placeholder="Rollen-ID" />
          </Labeled>
        </div>
        <SendButton
          label="Ankündigung senden"
          confirm="Wirklich jetzt in den Kanal senden?"
          disabled={!status.botReady || inv.announceChannelId.length < 15 || dirty || (!inv.enabled && !boost.enabled)}
          hint={dirty ? 'Bitte zuerst speichern – die Ankündigung nennt die gespeicherten Stufen.' : !inv.enabled && !boost.enabled ? 'Schalte zuerst Einladungen oder Boosts ein.' : undefined}
          run={() => api('/admin/discord/rewards/announce', { body: { channelId: inv.announceChannelId, roleId: inv.announceRoleId } })}
          done="Ankündigung gesendet."
        />
        <Leaderboard />
      </Section>

      <Section
        title="Honeypot-Kanal (Bot-Erkennung)"
        description="Spam-Bots schreiben in jeden Kanal, den sie sehen. In diesem Kanal steht ein roter Warnhinweis (Deutsch und Englisch), dass hier niemand schreiben soll – wer es trotzdem tut, wird automatisch gebannt und seine Nachrichten der letzten Stunde werden gelöscht. Ausgenommen sind Bots, der Besitzer des Servers und Mitglieder mit dem Recht „Administrator“."
      >
        <Toggle checked={d.honeypot.enabled} onChange={(enabled) => set({ honeypot: { ...d.honeypot, enabled } })} label="Honeypot einschalten" hint="Der Bot braucht das Recht „Mitglieder bannen“ und seine Rolle muss über den Rollen der Mitglieder stehen." />
        <Labeled label="Honeypot-Kanal" hint="Kanal-ID eines eigenen, sonst leeren Textkanals. Legt ihn weit oben an, damit Bots ihn finden." className="max-w-sm">
          <IdInput value={d.honeypot.channelId} onChange={(channelId) => set({ honeypot: { ...d.honeypot, channelId } })} placeholder="Kanal-ID" />
        </Labeled>
        <SendButton
          label="Kanal einrichten & Warnhinweis posten"
          confirm="Kanal für alle sichtbar machen und Hinweis posten?"
          disabled={!status.botReady || d.honeypot.channelId.length < 15}
          run={() => api('/admin/discord/honeypot/setup', { body: { channelId: d.honeypot.channelId } })}
          done="Kanal ist für alle sichtbar, der Warnhinweis steht drin. Vergiss nicht zu speichern."
        />
        {status.honeypotError && d.honeypot.enabled && (
          <p className="text-sm text-red-300">Der letzte automatische Bann ist fehlgeschlagen: {status.honeypotError.message} – bitte die Rechte und die Position der Bot-Rolle prüfen.</p>
        )}
      </Section>
    </>
  );
}

/** Knopf mit Sicherheitsabfrage und Rückmeldung */
function SendButton({ label, confirm, disabled, hint, run, done }: { label: string; confirm: string; disabled?: boolean; hint?: string; run: () => Promise<unknown>; done: string }) {
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<Message>(null);
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button
        variant="secondary"
        size="sm"
        icon={<Send />}
        loading={pending}
        disabled={disabled}
        onClick={async () => {
          if (!window.confirm(confirm)) return;
          setPending(true);
          setMessage(null);
          try {
            await run();
            setMessage({ ok: true, text: done });
          } catch (err) {
            setMessage({ ok: false, text: errorText(err) });
          } finally {
            setPending(false);
          }
        }}
      >
        {label}
      </Button>
      {message ? <Note message={message} /> : hint && <span className="text-[13px] text-amber-300">{hint}</span>}
    </div>
  );
}

/** Boosts eines Kontos von Hand setzen */
function BoostManual() {
  const [discordId, setDiscordId] = useState('');
  const [boosts, setBoosts] = useState(1);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<Message>(null);
  const send = async (value: number | null) => {
    setPending(true);
    setMessage(null);
    try {
      const res = await api<{ boosts: number }>('/admin/discord/rewards/boosts', { body: { discordId, boosts: value } });
      setMessage({ ok: true, text: value === null ? `Zählt wieder automatisch (aktuell ${res.boosts}).` : `Gesetzt: ${res.boosts} Boosts. Das Mitglied wird benachrichtigt.` });
    } catch (err) {
      setMessage({ ok: false, text: errorText(err) });
    } finally {
      setPending(false);
    }
  };
  return (
    <div className="rounded-lg border border-line bg-black/20 p-4">
      <p className="text-sm font-medium text-gray-200">Boosts von Hand setzen</p>
      <div className="mt-3 flex flex-wrap items-end gap-3">
        <Labeled label="Discord-ID des Mitglieds" className="w-60">
          <IdInput value={discordId} onChange={setDiscordId} placeholder="Discord-ID" />
        </Labeled>
        <Labeled label="Boosts" className="w-28">
          <NumberInput value={boosts} min={0} max={50} onChange={setBoosts} className="max-w-none" />
        </Labeled>
        <Button variant="secondary" size="sm" loading={pending} disabled={discordId.length < 15} onClick={() => void send(boosts)}>
          Setzen
        </Button>
        <Button variant="ghost" size="sm" disabled={pending || discordId.length < 15} onClick={() => void send(null)}>
          Wieder automatisch zählen
        </Button>
      </div>
      {message && (
        <p className="mt-2">
          <Note message={message} />
        </p>
      )}
    </div>
  );
}

/** Rangliste der Einladenden und Liste der Booster (wird auf Knopfdruck geladen) */
function Leaderboard() {
  const [data, setData] = useState<AdminRewardsDTO | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const load = async () => {
    setPending(true);
    setError(null);
    try {
      setData(await api<AdminRewardsDTO>('/admin/discord/rewards'));
    } catch (err) {
      setError(errorText(err));
    } finally {
      setPending(false);
    }
  };
  const who = (r: { discordId: string; username: string | null; email: string | null }) => (
    <>
      <span className="text-gray-100">{r.username ?? 'nicht verknüpft'}</span>
      <span className="block font-mono text-[11px] text-subtle">
        {r.discordId}
        {r.email ? ` · ${r.email}` : ''}
      </span>
    </>
  );
  return (
    <div className="border-t border-line pt-5">
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="secondary" size="sm" icon={<RefreshCw />} loading={pending} onClick={() => void load()}>
          {data ? 'Aktualisieren' : 'Rangliste und Booster anzeigen'}
        </Button>
        {error && <span className="text-sm text-red-300">{error}</span>}
      </div>
      {data && (
        <div className="mt-4 grid gap-5 lg:grid-cols-2">
          <div>
            <p className="mb-2 text-sm font-medium text-gray-200">Meiste Einladungen</p>
            {data.inviters.length === 0 ? (
              <p className="text-sm text-subtle">Noch keine Einladungen erfasst.</p>
            ) : (
              <ul className="divide-y divide-line rounded-lg border border-line text-sm">
                {data.inviters.map((r) => (
                  <li key={r.discordId} className="flex items-center justify-between gap-3 px-3 py-2">
                    <span className="min-w-0">{who(r)}</span>
                    <span className="shrink-0 text-right text-[13px] text-muted">
                      <span className="font-semibold text-white">{r.qualified}</span> aktiv · {r.total} gesamt
                      <span className="block text-[11px] text-subtle">
                        {r.rewards} Belohnungen, {r.redeemed} eingelöst
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div>
            <p className="mb-2 text-sm font-medium text-gray-200">Booster</p>
            {data.boosters.length === 0 ? (
              <p className="text-sm text-subtle">Noch keine Boosts erfasst.</p>
            ) : (
              <ul className="divide-y divide-line rounded-lg border border-line text-sm">
                {data.boosters.map((r) => (
                  <li key={r.discordId} className="flex items-center justify-between gap-3 px-3 py-2">
                    <span className="min-w-0">{who(r)}</span>
                    <span className="shrink-0 text-[13px] text-muted">
                      <span className="font-semibold text-white">{r.boosts}</span> {r.boosts === 1 ? 'Boost' : 'Boosts'}
                      {r.manual && <span className="ml-1 rounded bg-amber-400/15 px-1.5 py-0.5 text-[11px] text-amber-200">von Hand</span>}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
