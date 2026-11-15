'use client';

/**
 * Aktionen für alle Server auf einmal (Tab „Server“): sperren, Sperren aufheben, löschen.
 * Ablauf: Vorschau (dryRun) → Bestätigungswort eintippen → Runden, bis nichts mehr übrig ist (mit Fortschritt).
 * Admin-Konten sind immer ausgenommen, weitere Konten per E-Mail-Liste.
 */
import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';
import { Ban, ChevronDown, Trash2, TriangleAlert, Unlock } from 'lucide-react';
import type { BulkServerAction, BulkServerInput, BulkServerResult, ProductKind } from '@chfree/shared';
import { Labeled } from '@/components/admin/admin-settings';
import { Button } from '@/components/ui/button';
import { api, ApiClientError } from '@/lib/api/client';
import { cn } from '@/lib/utils';

type Kind = ProductKind | 'all';

const ACTIONS: Record<BulkServerAction, { button: string; word: string; verb: string; running: string; done: string; hint: string }> = {
  suspend: {
    button: 'Alle sperren',
    word: 'SPERREN',
    verb: 'sperren',
    running: 'Sperre',
    done: 'gesperrt',
    hint: 'Aktive Server werden gestoppt und im Panel gesperrt (Grund „vom Team“). Daten bleiben erhalten.',
  },
  unsuspend: {
    button: 'Sperren aufheben',
    word: 'ENTSPERREN',
    verb: 'entsperren',
    running: 'Entsperre',
    done: 'entsperrt',
    hint: 'Hebt nur Sperren auf, die das Team gesetzt hat – abgelaufene Server (30 Tage) bleiben gesperrt.',
  },
  delete: {
    button: 'Alle löschen',
    word: 'LÖSCHEN',
    verb: 'endgültig löschen',
    running: 'Lösche',
    done: 'gelöscht',
    hint: 'Löscht die Server auf dieser Website und im Panel.',
  },
};

const KIND_LABEL: Record<Kind, string> = { all: 'Alle Produkte', minecraft: 'Minecraft', discord: 'Discord-Bots' };
const ROUND_SIZE = 25;
const nf = (n: number) => n.toLocaleString('de-DE');
const servers = (n: number) => `${nf(n)} Server`;

type Stage =
  | { phase: 'preview'; action: BulkServerAction }
  | { phase: 'confirm'; action: BulkServerAction; total: number; exempt: number; unknownEmails: string[]; confirm: string }
  | { phase: 'running'; action: BulkServerAction; total: number; done: number; failed: number; errors: string[]; cancelling: boolean };

function parseEmails(text: string): string[] {
  return [
    ...new Set(
      text
        .split(/[\s,;]+/)
        .map((e) => e.trim().toLowerCase())
        .filter((e) => e.includes('@') && e.length <= 254),
    ),
  ].slice(0, 1000);
}

export function ServerBulkActions() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<Kind>('all');
  const [exemptText, setExemptText] = useState('');
  const [stage, setStage] = useState<Stage | null>(null);
  const [result, setResult] = useState<{ ok: boolean; text: string; errors: string[] } | null>(null);
  const cancel = useRef(false);
  const exemptEmails = parseEmails(exemptText);
  const busy = stage?.phase === 'preview' || stage?.phase === 'running';

  const input = (action: BulkServerAction, extra: Partial<BulkServerInput> = {}): BulkServerInput => ({ action, kind, exemptEmails, ...extra });
  const errorText = (err: unknown) => (err instanceof ApiClientError ? (Object.values(err.fields ?? {})[0] ?? err.message) : 'Fehler');

  /** Schritt 1: nur zählen, nichts ändern */
  async function preview(action: BulkServerAction) {
    setResult(null);
    setStage({ phase: 'preview', action });
    try {
      const res = await api<BulkServerResult>('/admin/servers/bulk', { body: input(action, { dryRun: true }) });
      setStage({ phase: 'confirm', action, total: res.remaining, exempt: res.exempt, unknownEmails: res.unknownEmails, confirm: '' });
    } catch (err) {
      setStage(null);
      setResult({ ok: false, text: `Vorschau fehlgeschlagen: ${errorText(err)}`, errors: [] });
    }
  }

  /** Schritt 2: in Runden, bis nichts mehr übrig ist – fehlgeschlagene Server werden übersprungen */
  async function run() {
    if (stage?.phase !== 'confirm') return;
    const { action, total } = stage;
    const a = ACTIONS[action];
    cancel.current = false;
    setResult(null);
    setStage({ phase: 'running', action, total, done: 0, failed: 0, errors: [], cancelling: false });
    let done = 0;
    let failed = 0;
    let errors: string[] = [];
    let aborted: string | null = null;
    try {
      for (let round = 0; round < 100_000; round++) {
        if (cancel.current) {
          aborted = 'abgebrochen';
          break;
        }
        const res = await api<BulkServerResult>('/admin/servers/bulk', { body: input(action, { limit: ROUND_SIZE, skip: failed }) });
        done += res.processed;
        failed += res.failed;
        errors = [...res.errors, ...errors].slice(0, 10);
        setStage((s) => (s?.phase === 'running' ? { ...s, done, failed, errors } : s));
        // fertig – oder in dieser Runde gab es nichts mehr zu tun (nur noch fehlgeschlagene Server übrig)
        if (res.remaining === 0 || (res.processed === 0 && res.failed === 0)) break;
      }
    } catch (err) {
      aborted = `abgebrochen: ${errorText(err)}`;
    }
    setResult({
      ok: !aborted && failed === 0,
      text: `${servers(done)} ${a.done}${failed ? ` · ${nf(failed)} fehlgeschlagen` : ''}${aborted ? ` – ${aborted}` : ''}.`,
      errors,
    });
    setStage(null);
    router.refresh();
  }

  /** Auswahl geändert → eine offene Vorschau gilt nicht mehr */
  const resetPreview = () => setStage((s) => (s?.phase === 'confirm' ? null : s));

  return (
    <div className="mb-4">
      <Button variant="danger" size="sm" icon={<ChevronDown className={cn('transition-transform', open && 'rotate-180')} />} aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        Alle Server …
      </Button>

      {open && (
        <div className="mt-3 space-y-4 rounded-xl border border-red-500/40 bg-red-500/[0.06] p-4">
          <p className="text-sm leading-relaxed text-gray-100">
            Aktionen für <span className="font-semibold text-white">alle Server</span> auf einmal – z. B. vor einem Umzug oder bei Missbrauch. Unabhängig von Suche und Filter
            der Liste unten. Vor jeder Aktion siehst du, wie viele Server betroffen sind.
          </p>
          <div className="grid gap-4 md:grid-cols-[220px_1fr]">
            <Labeled label="Produkt">
              <select
                className="input"
                value={kind}
                disabled={busy}
                onChange={(e) => {
                  setKind(e.target.value as Kind);
                  resetPreview();
                }}
              >
                <option value="all">Alle</option>
                <option value="minecraft">Minecraft</option>
                <option value="discord">Discord-Bots</option>
              </select>
            </Labeled>
            <Labeled
              label="Ausgenommene Konten (eine E-Mail-Adresse pro Zeile)"
              hint={`Admin-Konten sind immer ausgenommen.${exemptEmails.length ? ` ${nf(exemptEmails.length)} ${exemptEmails.length === 1 ? 'Adresse' : 'Adressen'} erkannt.` : ''}`}
            >
              <textarea
                className="input h-24 py-2.5 font-mono text-[13px]"
                value={exemptText}
                disabled={busy}
                placeholder={'freund@example.com\npartner@example.com'}
                onChange={(e) => {
                  setExemptText(e.target.value);
                  resetPreview();
                }}
              />
            </Labeled>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button variant="danger" size="sm" icon={<Ban />} disabled={busy} loading={stage?.phase === 'preview' && stage.action === 'suspend'} onClick={() => preview('suspend')}>
              {ACTIONS.suspend.button}
            </Button>
            <Button
              variant="secondary"
              size="sm"
              icon={<Unlock />}
              disabled={busy}
              loading={stage?.phase === 'preview' && stage.action === 'unsuspend'}
              onClick={() => preview('unsuspend')}
            >
              {ACTIONS.unsuspend.button}
            </Button>
            <Button variant="danger" size="sm" icon={<Trash2 />} disabled={busy} loading={stage?.phase === 'preview' && stage.action === 'delete'} onClick={() => preview('delete')}>
              {ACTIONS.delete.button}
            </Button>
          </div>

          {stage?.phase === 'confirm' && (
            <div className="space-y-3 rounded-lg border border-red-500/40 bg-black/20 p-4">
              <p className="text-sm text-gray-100">
                <span className="font-semibold text-white">{ACTIONS[stage.action].button}</span> ({KIND_LABEL[kind]}): Betrifft{' '}
                <span className="font-semibold text-white">{servers(stage.total)}</span> · {nf(stage.exempt)} ausgenommen
              </p>
              <p className="text-[13px] text-muted">{ACTIONS[stage.action].hint}</p>
              {stage.unknownEmails.length > 0 && (
                <p className="text-[13px] break-words text-amber-300">
                  Zu {stage.unknownEmails.length === 1 ? 'dieser Adresse' : 'diesen Adressen'} gibt es kein Konto (Tippfehler?): {stage.unknownEmails.slice(0, 20).join(', ')}
                  {stage.unknownEmails.length > 20 ? ` … und ${stage.unknownEmails.length - 20} weitere` : ''}
                </p>
              )}
              {stage.action === 'delete' && stage.total > 0 && (
                <div className="flex gap-2.5 rounded-lg border border-red-400/40 bg-red-500/10 p-3 text-[13px] leading-relaxed text-red-100">
                  <TriangleAlert className="mt-0.5 size-4 shrink-0 text-red-300" aria-hidden />
                  <p>
                    <span className="font-semibold">Achtung:</span> Die Server werden auch im Pterodactyl-Panel gelöscht – inklusive aller Welten, Dateien und Backups. Das
                    lässt sich <span className="font-semibold">nicht rückgängig machen</span>.
                  </p>
                </div>
              )}
              {stage.total === 0 ? (
                <div className="flex flex-wrap items-center gap-3">
                  <p className="text-sm text-muted">Es gibt keine betroffenen Server.</p>
                  <Button variant="ghost" size="sm" onClick={() => setStage(null)}>
                    Schließen
                  </Button>
                </div>
              ) : (
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                  <input
                    className="input sm:max-w-[220px]"
                    placeholder={`${ACTIONS[stage.action].word} eingeben`}
                    aria-label={`Zur Bestätigung ${ACTIONS[stage.action].word} eingeben`}
                    value={stage.confirm}
                    onChange={(e) => setStage({ ...stage, confirm: e.target.value })}
                    autoFocus
                  />
                  <Button
                    variant="danger"
                    icon={stage.action === 'delete' ? <Trash2 /> : stage.action === 'suspend' ? <Ban /> : <Unlock />}
                    disabled={stage.confirm.trim().toUpperCase() !== ACTIONS[stage.action].word}
                    onClick={run}
                  >
                    {servers(stage.total)} {ACTIONS[stage.action].verb}
                  </Button>
                  <Button variant="ghost" onClick={() => setStage(null)}>
                    Abbrechen
                  </Button>
                </div>
              )}
            </div>
          )}

          {stage?.phase === 'running' && (
            <div className="space-y-2 rounded-lg border border-red-500/40 bg-black/20 p-4">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-sm text-gray-100">
                  {ACTIONS[stage.action].running} … {nf(stage.done)} von {servers(stage.total)}
                  {stage.failed > 0 && <span className="text-amber-300"> · {nf(stage.failed)} fehlgeschlagen</span>} – bitte die Seite offen lassen.
                </p>
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={stage.cancelling}
                  onClick={() => {
                    cancel.current = true;
                    setStage({ ...stage, cancelling: true });
                  }}
                >
                  {stage.cancelling ? 'Wird nach dieser Runde abgebrochen …' : 'Abbrechen'}
                </Button>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-white/10">
                <div
                  className="h-2 rounded-full bg-red-400 transition-all"
                  style={{ width: `${Math.min(100, ((stage.done + stage.failed) / Math.max(1, stage.total)) * 100)}%` }}
                />
              </div>
              {stage.errors.length > 0 && (
                <ul className="space-y-0.5 text-[12px] break-words text-amber-300">
                  {stage.errors.slice(0, 5).map((e, i) => (
                    <li key={i}>{e}</li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {result && (
            <div className="space-y-0.5 text-sm">
              <p className={result.ok ? 'text-emerald-300' : 'text-red-300'}>{result.text}</p>
              {result.errors.length > 0 && <p className="text-[13px] text-muted">Letzte Fehler:</p>}
              {result.errors.map((e, i) => (
                <p key={i} className="text-[13px] break-words text-amber-300">
                  {e}
                </p>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
