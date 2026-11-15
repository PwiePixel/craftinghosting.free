'use client';

/**
 * Admin → Newsletter: Ausgaben schreiben, testen und versenden; Abonnenten ansehen, entfernen, exportieren.
 * Der Versand läuft im Hintergrund (Worker) – der Fortschritt aktualisiert sich hier von selbst.
 */
import { useCallback, useEffect, useState } from 'react';
import { Download, Loader2, Mail, Pencil, Plus, Send, Trash2 } from 'lucide-react';
import type { AdminCampaignDTO, AdminNewsletterDTO, AdminSubscriberDTO, CampaignAudience, CampaignInput, PageInfo } from '@chfree/shared';
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/primitives';
import { api, ApiClientError } from '@/lib/api/client';
import { cn } from '@/lib/utils';
import { Labeled, Section } from './admin-settings';

const errorText = (err: unknown) => (err instanceof ApiClientError ? err.message : 'Das hat nicht geklappt. Bitte erneut versuchen.');
const fmt = (iso: string | null) => (iso ? new Date(iso).toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' }) : '–');

const STATUS: Record<AdminCampaignDTO['status'], { label: string; cls: string }> = {
  draft: { label: 'Entwurf', cls: 'bg-white/[0.06] text-gray-300' },
  sending: { label: 'Wird versendet', cls: 'bg-blue-500/15 text-blue-300' },
  sent: { label: 'Versendet', cls: 'bg-emerald-400/10 text-emerald-300' },
  cancelled: { label: 'Abgebrochen', cls: 'bg-amber-400/10 text-amber-300' },
};
const SUB_STATUS: Record<AdminSubscriberDTO['status'], string> = { active: 'Aktiv', pending: 'Unbestätigt', unsubscribed: 'Abgemeldet' };
const empty: CampaignInput = { subject: { de: '', en: '' }, body: { de: '', en: '' }, audience: 'subscribers', ctaLabel: { de: '', en: '' }, ctaUrl: '' };

function Editor({ initial, id, onDone, onCancel }: { initial: CampaignInput; id: string | null; onDone: () => Promise<void>; onCancel: () => void }) {
  const [c, setC] = useState<CampaignInput>(initial);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (v: Partial<CampaignInput>) => setC((p) => ({ ...p, ...v }));

  async function save() {
    setPending(true);
    setError(null);
    try {
      await api(id ? `/admin/newsletter/campaigns/${id}` : '/admin/newsletter/campaigns', { body: c });
      await onDone();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="space-y-5 rounded-lg border border-blue-500/40 p-4 sm:p-5">
      <p className="text-sm font-semibold text-white">{id ? 'Entwurf bearbeiten' : 'Neue Ausgabe'}</p>
      {error && <Alert tone="error">{error}</Alert>}
      <Labeled label="Empfänger">
        <select className="input max-w-md" value={c.audience} onChange={(e) => set({ audience: e.target.value as CampaignAudience })}>
          <option value="subscribers">Newsletter-Abonnenten (Neuigkeiten, Angebote)</option>
          <option value="all_users">Alle bestätigten Konten (nur betriebliche Hinweise)</option>
        </select>
      </Labeled>
      {c.audience === 'all_users' && (
        <Alert tone="warning" title="Nur für betriebliche Hinweise">
          Diese Mail geht an alle Konten – auch ohne Newsletter-Anmeldung und ohne Abmeldelink. Das ist nur für Mitteilungen zulässig, die den Betrieb des Servers betreffen (Wartung,
          Umzug, geänderte Bedingungen). Werbung und Angebote dürfen nur an Abonnenten gehen.
        </Alert>
      )}
      <div className="grid gap-5 lg:grid-cols-2">
        {(['de', 'en'] as const).map((l) => (
          <div key={l} className="space-y-3">
            <p className="text-[12px] font-medium tracking-wide text-subtle uppercase">{l === 'de' ? 'Deutsch' : 'Englisch'}</p>
            <input className="input" value={c.subject[l]} maxLength={160} placeholder="Betreff" aria-label={`Betreff ${l}`} onChange={(e) => set({ subject: { ...c.subject, [l]: e.target.value } })} />
            <textarea
              className="input h-auto py-2.5"
              rows={12}
              value={c.body[l]}
              maxLength={20000}
              placeholder={'Text der Ausgabe.\n\nLeerzeile = neuer Absatz.\n**fett** und Links (https://…) werden erkannt.'}
              aria-label={`Text ${l}`}
              onChange={(e) => set({ body: { ...c.body, [l]: e.target.value } })}
            />
            <input
              className="input"
              value={c.ctaLabel[l]}
              maxLength={60}
              placeholder="Beschriftung des Buttons (optional)"
              aria-label={`Button ${l}`}
              onChange={(e) => set({ ctaLabel: { ...c.ctaLabel, [l]: e.target.value } })}
            />
          </div>
        ))}
      </div>
      <Labeled label="Link des Buttons (optional)" hint="Fehlt eine Sprache, bekommen alle den Text der anderen Sprache.">
        <input className="input max-w-xl" type="url" value={c.ctaUrl} maxLength={500} placeholder="https://…" onChange={(e) => set({ ctaUrl: e.target.value })} />
      </Labeled>
      <div className="flex flex-wrap gap-2">
        <Button type="button" loading={pending} onClick={() => void save()} disabled={!(c.subject.de.trim() || c.subject.en.trim()) || !(c.body.de.trim() || c.body.en.trim())}>
          Entwurf speichern
        </Button>
        <Button type="button" variant="ghost" onClick={onCancel}>
          Abbrechen
        </Button>
      </div>
    </div>
  );
}

function CampaignRow({ c, recipients, onEdit, onChange }: { c: AdminCampaignDTO; recipients: number; onEdit: () => void; onChange: () => Promise<void> }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);

  async function call(name: string, fn: () => Promise<void>) {
    setBusy(name);
    setNote(null);
    try {
      await fn();
      await onChange();
    } catch (err) {
      setNote({ ok: false, text: errorText(err) });
    } finally {
      setBusy(null);
    }
  }
  const done = c.sent + c.failed;
  const st = STATUS[c.status];

  return (
    <div className="rounded-lg border border-line p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="flex flex-wrap items-center gap-2">
            <span className="truncate font-medium text-white">{c.subject.de || c.subject.en}</span>
            <span className={cn('rounded-md px-2 py-0.5 text-xs font-medium', st.cls)}>{st.label}</span>
          </p>
          <p className="mt-1 text-[13px] text-muted">
            {c.audience === 'subscribers' ? 'An Abonnenten' : 'An alle Konten (betrieblich)'} · angelegt {fmt(c.createdAt)}
            {c.status !== 'draft' && ` · ${c.sent} von ${c.total} versendet${c.failed ? ` · ${c.failed} fehlgeschlagen` : ''}`}
            {c.finishedAt && ` · fertig ${fmt(c.finishedAt)}`}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {c.status === 'draft' && (
            <>
              <Button type="button" variant="secondary" size="sm" icon={<Pencil />} onClick={onEdit}>
                Bearbeiten
              </Button>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                icon={<Mail />}
                loading={busy === 'test'}
                onClick={() =>
                  call('test', async () => {
                    const res = await api<{ ok: boolean; error?: string; logged?: boolean }>(`/admin/newsletter/campaigns/${c.id}/test`, { body: {} });
                    setNote(
                      res.ok
                        ? { ok: true, text: res.logged ? 'Kein Mailserver eingerichtet – die Testmail steht im Log der API.' : 'Testmail (Deutsch + Englisch) an deine Adresse gesendet.' }
                        : { ok: false, text: res.error ?? 'Testversand fehlgeschlagen.' },
                    );
                  })
                }
              >
                Testmail an mich
              </Button>
              <Button
                type="button"
                size="sm"
                icon={<Send />}
                loading={busy === 'send'}
                disabled={recipients === 0}
                onClick={() => {
                  if (window.confirm(`Diese Ausgabe jetzt an ${recipients} ${c.audience === 'subscribers' ? 'Abonnenten' : 'Konten'} senden? Das lässt sich nicht rückgängig machen.`)) {
                    void call('send', async () => void (await api(`/admin/newsletter/campaigns/${c.id}/send`, { body: {} })));
                  }
                }}
              >
                Senden ({recipients})
              </Button>
            </>
          )}
          {c.status === 'sending' && (
            <Button type="button" variant="secondary" size="sm" loading={busy === 'cancel'} onClick={() => call('cancel', async () => void (await api(`/admin/newsletter/campaigns/${c.id}/cancel`, { body: {} })))}>
              Versand abbrechen
            </Button>
          )}
          {c.status !== 'sending' && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              icon={<Trash2 />}
              loading={busy === 'delete'}
              onClick={() => {
                if (window.confirm('Diese Ausgabe löschen?')) void call('delete', async () => void (await api(`/admin/newsletter/campaigns/${c.id}/delete`, { body: {} })));
              }}
            >
              Löschen
            </Button>
          )}
        </div>
      </div>
      {c.status === 'sending' && (
        <div className="mt-3 h-1.5 rounded-full bg-white/10" aria-label="Fortschritt">
          <div className="h-1.5 rounded-full bg-blue-500 transition-all" style={{ width: `${c.total ? Math.max(3, (done / c.total) * 100) : 3}%` }} />
        </div>
      )}
      {note && <p className={cn('mt-3 text-[13px]', note.ok ? 'text-emerald-300' : 'text-red-300')}>{note.text}</p>}
    </div>
  );
}

function Subscribers() {
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('all');
  const [page, setPage] = useState(1);
  const [data, setData] = useState<({ subscribers: AdminSubscriberDTO[] } & PageInfo) | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const params = new URLSearchParams({ page: String(page), ...(q.trim() ? { q: q.trim() } : {}), ...(status !== 'all' ? { status } : {}) });
      setData(await api(`/admin/newsletter/subscribers?${params.toString()}`));
      setError(null);
    } catch (err) {
      setError(errorText(err));
    }
  }, [page, q, status]);

  useEffect(() => {
    const t = setTimeout(() => void load(), 250);
    return () => clearTimeout(t);
  }, [load]);

  return (
    <Section title="Abonnenten" description="Wer den Newsletter bekommt. „Unbestätigt“ heißt: Der Bestätigungslink wurde noch nicht angeklickt – diese Adressen bekommen nichts.">
      <div className="flex flex-col gap-2 sm:flex-row">
        <input
          className="input sm:max-w-xs"
          value={q}
          placeholder="E-Mail suchen …"
          onChange={(e) => {
            setQ(e.target.value);
            setPage(1);
          }}
          aria-label="Suche"
        />
        <select
          className="input sm:max-w-[200px]"
          value={status}
          onChange={(e) => {
            setStatus(e.target.value);
            setPage(1);
          }}
          aria-label="Status"
        >
          <option value="all">Alle</option>
          <option value="active">Aktiv</option>
          <option value="pending">Unbestätigt</option>
          <option value="unsubscribed">Abgemeldet</option>
        </select>
        <a href="/api/v1/admin/export/subscribers" className="inline-flex h-11 items-center gap-2 rounded-lg border border-line-strong px-4 text-sm text-gray-200 hover:bg-white/5 sm:ml-auto">
          <Download className="size-4" aria-hidden /> CSV-Export
        </a>
      </div>
      {error && <Alert tone="error">{error}</Alert>}
      {!data ? (
        <p className="flex items-center gap-2 text-sm text-muted">
          <Loader2 className="size-4 animate-spin" aria-hidden /> Lädt …
        </p>
      ) : data.subscribers.length === 0 ? (
        <p className="text-sm text-muted">Keine Einträge.</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-line">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead className="bg-surface-2 text-[13px] text-gray-300">
              <tr>
                {['E-Mail', 'Status', 'Sprache', 'Quelle', 'Angemeldet', ''].map((h) => (
                  <th key={h} className="px-3 py-2.5 font-medium">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {data.subscribers.map((s) => (
                <tr key={s.id}>
                  <td className="px-3 py-2.5 text-gray-100">{s.email}</td>
                  <td className={cn('px-3 py-2.5', s.status === 'active' ? 'text-emerald-300' : s.status === 'pending' ? 'text-amber-300' : 'text-subtle')}>{SUB_STATUS[s.status]}</td>
                  <td className="px-3 py-2.5 text-muted uppercase">{s.locale}</td>
                  <td className="px-3 py-2.5 text-muted">{s.source === 'signup' ? 'Server-Bestellung' : 'Formular'}</td>
                  <td className="px-3 py-2.5 text-muted">{fmt(s.createdAt)}</td>
                  <td className="px-3 py-2.5 text-right">
                    <button
                      type="button"
                      className="text-[13px] text-red-300 hover:text-red-200"
                      onClick={() => {
                        if (window.confirm(`${s.email} aus dem Newsletter entfernen?`)) void api(`/admin/newsletter/subscribers/${s.id}/delete`, { body: {} }).then(load, (err) => setError(errorText(err)));
                      }}
                    >
                      Entfernen
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {data && data.pages > 1 && (
        <div className="flex items-center gap-3 text-sm text-muted">
          <Button type="button" variant="secondary" size="sm" disabled={data.page <= 1} onClick={() => setPage((p) => p - 1)}>
            Zurück
          </Button>
          Seite {data.page} von {data.pages} · {data.total} Einträge
          <Button type="button" variant="secondary" size="sm" disabled={data.page >= data.pages} onClick={() => setPage((p) => p + 1)}>
            Weiter
          </Button>
        </div>
      )}
    </Section>
  );
}

export function NewsletterManager({ enabled }: { enabled: boolean }) {
  const [data, setData] = useState<AdminNewsletterDTO | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ id: string | null; initial: CampaignInput } | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await api<{ newsletter: AdminNewsletterDTO }>('/admin/newsletter');
      setData(res.newsletter);
      setError(null);
    } catch (err) {
      setError(errorText(err));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Läuft ein Versand, den Fortschritt regelmäßig nachladen
  const sending = !!data?.campaigns.some((c) => c.status === 'sending');
  useEffect(() => {
    if (!sending) return;
    const t = setInterval(() => void load(), 5000);
    return () => clearInterval(t);
  }, [sending, load]);

  if (!data) return error ? <Alert tone="error">{error}</Alert> : <p className="text-sm text-muted">Lädt …</p>;

  return (
    <div className="space-y-6">
      {!enabled && (
        <Alert tone="warning" title="Der Newsletter ist ausgeschaltet">
          Neue Anmeldungen sind nicht möglich (Einstellungen → Newsletter). Ausgaben an bestehende Abonnenten kannst du trotzdem versenden.
        </Alert>
      )}
      {!data.smtpConfigured && (
        <Alert tone="warning" title="Kein Mailserver eingerichtet">
          Ohne SMTP werden E-Mails nur ins Log der API geschrieben. Mailserver auf dem Server mit „chfree reconfigure“ eintragen.
        </Alert>
      )}
      <div className="grid gap-4 sm:grid-cols-4">
        {[
          ['Aktive Abonnenten', data.counts.active],
          ['Unbestätigt', data.counts.pending],
          ['Abgemeldet', data.counts.unsubscribed],
          ['Bestätigte Konten', data.verifiedUsers],
        ].map(([label, value]) => (
          <div key={label} className="surface p-5">
            <p className="text-[13px] text-subtle">{label}</p>
            <p className="mt-1 text-2xl font-semibold text-white tabular-nums">{value}</p>
          </div>
        ))}
      </div>

      <Section
        title="Ausgaben"
        description="Entwurf schreiben, per Testmail prüfen, senden. Jeder Empfänger bekommt die Ausgabe in seiner Sprache und genau einmal; in jeder Mail an Abonnenten steht ein Abmeldelink."
      >
        {editing ? (
          <Editor
            key={editing.id ?? 'new'}
            id={editing.id}
            initial={editing.initial}
            onCancel={() => setEditing(null)}
            onDone={async () => {
              setEditing(null);
              await load();
            }}
          />
        ) : (
          <Button type="button" icon={<Plus />} onClick={() => setEditing({ id: null, initial: empty })}>
            Neue Ausgabe
          </Button>
        )}
        <div className="space-y-3">
          {data.campaigns.length === 0 && <p className="text-sm text-muted">Noch keine Ausgaben.</p>}
          {data.campaigns.map((c) => (
            <CampaignRow
              key={c.id}
              c={c}
              recipients={c.audience === 'subscribers' ? data.counts.active : data.verifiedUsers}
              onChange={load}
              onEdit={() => setEditing({ id: c.id, initial: { subject: c.subject, body: c.body, audience: c.audience, ctaLabel: c.ctaLabel, ctaUrl: c.ctaUrl } })}
            />
          ))}
        </div>
      </Section>

      <Subscribers />
    </div>
  );
}
