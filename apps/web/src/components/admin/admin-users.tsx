'use client';

/**
 * Nutzerliste im Admin-Bereich – Konten schnell löschen (inkl. ihrer kostenlosen Server):
 *  – einzeln („Löschen“ in der Zeile)
 *  – Auswahl (Häkchen, mit Umschalt-Klick ganze Bereiche, „Alle auf dieser Seite“)
 *  – alle Treffer der aktuellen Suche/des Filters über alle Seiten (mit Fortschritt)
 *  – per eingefügter E-Mail-Liste
 * Eigene Konten und Admins werden nie gelöscht.
 */
import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';
import { ArrowUpRight, ListX, Trash2 } from 'lucide-react';
import { formatDate, formatDateTime, freeHostingConfig, type AdminUserDTO } from '@chfree/shared';
import { ActionButton, UserActions } from '@/components/admin/admin-actions';
import { Button } from '@/components/ui/button';
import { api, ApiClientError } from '@/lib/api/client';
import { cn } from '@/lib/utils';

const tz = freeHostingConfig.fairUse.timezone;
const IP_HINT = 'IP-Adressen werden verschlüsselt gespeichert und sind nur im Admin-Bereich sichtbar.';

/** IP-Adresse klein unter dem Datum – nur wenn vorhanden */
function IpLine({ label, ip }: { label: string; ip: string | null }) {
  if (!ip) return null;
  return (
    <p className="mt-0.5 text-[11px] text-subtle" title={IP_HINT}>
      {label}: <span className="font-mono">{ip}</span>
    </p>
  );
}
type DeleteResult = { deleted: number; servers: number; skipped: { email: string; reason: string }[] };

function describeFilter(filter: { q?: string; status?: string }, labels: Record<string, string>): string {
  const parts = [filter.status ? `Filter „${labels[filter.status] ?? filter.status}“` : '', filter.q ? `Suche „${filter.q}“` : ''].filter(Boolean);
  return parts.length ? parts.join(' + ') : 'ohne Filter – alle Nutzer';
}

export function UsersTable({
  list,
  meId,
  filter = {},
  deletable: deletableTotal = 0,
  filterLabels = {},
}: {
  list: AdminUserDTO[];
  meId: string;
  filter?: { q?: string; status?: string };
  /** Treffer ohne Admins über alle Seiten */
  deletable?: number;
  filterLabels?: Record<string, string>;
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const lastIndex = useRef<number | null>(null);
  const [bulk, setBulk] = useState<{ phase: 'confirm' | 'running'; done: number; target: number; confirm: string } | null>(null);
  const [showList, setShowList] = useState(false);
  const [emailText, setEmailText] = useState('');
  const [listPending, setListPending] = useState(false);
  const [armed, setArmed] = useState(false);
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string; skipped?: DeleteResult['skipped'] } | null>(null);

  const deletable = (u: AdminUserDTO) => u.id !== meId && u.role !== 'admin';
  const selectable = list.filter(deletable);
  const allSelected = selectable.length > 0 && selectable.every((u) => selected.has(u.id));
  const serverCount = list.filter((u) => selected.has(u.id)).reduce((sum, u) => sum + u.servers, 0);

  /** Häkchen setzen – mit gedrückter Umschalttaste wird der ganze Bereich seit dem letzten Klick übernommen */
  const toggle = (index: number, shift: boolean) => {
    const u = list[index]!;
    // Startpunkt jetzt merken – der Updater unten läuft erst später, dann ist lastIndex schon überschrieben
    const anchor = lastIndex.current;
    setSelected((prev) => {
      const next = new Set(prev);
      const on = !prev.has(u.id);
      if (shift && anchor !== null) {
        const [from, to] = [Math.min(anchor, index), Math.max(anchor, index)];
        for (const x of list.slice(from, to + 1)) if (deletable(x)) on ? next.add(x.id) : next.delete(x.id);
      } else if (on) next.add(u.id);
      else next.delete(u.id);
      return next;
    });
    lastIndex.current = index;
  };

  const skippedText = (skipped: DeleteResult['skipped']) => skipped.slice(0, 10).concat(skipped.length > 10 ? [{ email: `… und ${skipped.length - 10} weitere`, reason: '' }] : []);

  /** Alle Treffer löschen – in Runden à 100, bis nichts mehr übrig ist */
  async function deleteAllMatching() {
    if (!bulk) return;
    const target = deletableTotal;
    setBulk({ ...bulk, phase: 'running', done: 0, target });
    setResult(null);
    let done = 0;
    let servers = 0;
    const skipped: DeleteResult['skipped'] = [];
    try {
      for (let round = 0; round < 1000; round++) {
        const res = await api<DeleteResult & { remaining: number }>('/admin/users/delete-matching', { body: { ...filter, limit: 100 } });
        done += res.deleted;
        servers += res.servers;
        skipped.push(...res.skipped);
        setBulk((b) => (b ? { ...b, done } : b));
        // fertig – oder in dieser Runde ging nichts mehr (z. B. Panel nicht erreichbar)
        if (res.remaining === 0 || res.deleted === 0) break;
      }
      setResult({ ok: skipped.length === 0, text: `${done} ${done === 1 ? 'Konto' : 'Konten'} gelöscht${servers ? ` (inkl. ${servers} Server)` : ''}.`, skipped: skippedText(skipped) });
    } catch (err) {
      setResult({ ok: false, text: `${done} gelöscht, dann abgebrochen: ${err instanceof ApiClientError ? err.message : 'Fehler'}`, skipped: skippedText(skipped) });
    } finally {
      setBulk(null);
      setSelected(new Set());
      router.refresh();
    }
  }

  /** Konten per eingefügter E-Mail-Liste löschen */
  async function deleteByEmails() {
    const emails = [...new Set(emailText.split(/[\s,;]+/).map((e) => e.trim().toLowerCase()).filter((e) => e.includes('@')))];
    if (!emails.length) return;
    setListPending(true);
    setResult(null);
    let deleted = 0;
    let servers = 0;
    const skipped: DeleteResult['skipped'] = [];
    try {
      for (let i = 0; i < emails.length; i += 500) {
        const res = await api<DeleteResult>('/admin/users/delete', { body: { emails: emails.slice(i, i + 500) } });
        deleted += res.deleted;
        servers += res.servers;
        skipped.push(...res.skipped);
      }
      setResult({ ok: deleted > 0, text: `${deleted} von ${emails.length} Adressen gelöscht${servers ? ` (inkl. ${servers} Server)` : ''}.`, skipped: skippedText(skipped) });
      if (deleted) setEmailText('');
      router.refresh();
    } catch (err) {
      setResult({ ok: false, text: err instanceof ApiClientError ? err.message : 'Löschen fehlgeschlagen.' });
    } finally {
      setListPending(false);
    }
  }
  const listCount = new Set(emailText.split(/[\s,;]+/).filter((e) => e.includes('@'))).size;

  async function remove(ids: string[]) {
    const res = await api<DeleteResult>('/admin/users/delete', { body: { ids } });
    setResult({
      ok: res.deleted > 0 || res.skipped.length === 0,
      text: `${res.deleted} ${res.deleted === 1 ? 'Konto' : 'Konten'} gelöscht${res.servers ? ` (inkl. ${res.servers} ${res.servers === 1 ? 'Server' : 'Server'})` : ''}.`,
      skipped: res.skipped,
    });
    setSelected(new Set());
    router.refresh();
  }

  async function removeSelected() {
    if (!armed) {
      setArmed(true);
      setTimeout(() => setArmed(false), 5000);
      return;
    }
    setPending(true);
    setResult(null);
    try {
      await remove([...selected]);
    } catch (err) {
      setResult({ ok: false, text: err instanceof ApiClientError ? err.message : 'Löschen fehlgeschlagen.' });
    } finally {
      setPending(false);
      setArmed(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-3 rounded-xl border border-line bg-surface p-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-[13px] text-muted">
          {selected.size > 0
            ? `${selected.size} ${selected.size === 1 ? 'Konto' : 'Konten'} ausgewählt${serverCount ? ` · ${serverCount} Server` : ''}`
            : 'Häkchen setzen (Umschalt + Klick für ganze Bereiche) oder alle Treffer von Suche/Filter löschen – z. B. Filter „E-Mail unbestätigt“.'}
        </p>
        <div className="flex flex-wrap gap-2">
          <Button variant="danger" size="sm" icon={<Trash2 />} loading={pending} disabled={selected.size === 0 || !!bulk} onClick={removeSelected}>
            {armed ? `Wirklich ${selected.size} ${selected.size === 1 ? 'Konto' : 'Konten'} + Server löschen?` : `Ausgewählte löschen (${selected.size})`}
          </Button>
          <Button
            variant="danger"
            size="sm"
            icon={<Trash2 />}
            disabled={deletableTotal === 0 || !!bulk}
            onClick={() => setBulk({ phase: 'confirm', done: 0, target: deletableTotal, confirm: '' })}
          >
            Alle {deletableTotal.toLocaleString('de-DE')} Treffer löschen
          </Button>
          <Button variant="secondary" size="sm" icon={<ListX />} onClick={() => setShowList((v) => !v)}>
            Per E-Mail-Liste
          </Button>
        </div>
      </div>

      {bulk && (
        <div className="rounded-xl border border-red-500/40 bg-red-500/[0.06] p-4">
          {bulk.phase === 'confirm' ? (
            <div className="space-y-3">
              <p className="text-sm text-gray-100">
                <span className="font-semibold text-white">{bulk.target.toLocaleString('de-DE')} Konten</span> löschen ({describeFilter(filter, filterLabels)}) – inklusive
                aller kostenlosen Server mit Welten und Backups. Admins und dein eigenes Konto bleiben erhalten. Das lässt sich nicht rückgängig machen.
              </p>
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                <input
                  className="input sm:max-w-[220px]"
                  placeholder="LÖSCHEN eingeben"
                  aria-label="Zur Bestätigung LÖSCHEN eingeben"
                  value={bulk.confirm}
                  onChange={(e) => setBulk({ ...bulk, confirm: e.target.value })}
                  autoFocus
                />
                <Button variant="danger" icon={<Trash2 />} disabled={bulk.confirm.trim().toUpperCase() !== 'LÖSCHEN'} onClick={deleteAllMatching}>
                  {bulk.target.toLocaleString('de-DE')} Konten endgültig löschen
                </Button>
                <Button variant="ghost" onClick={() => setBulk(null)}>
                  Abbrechen
                </Button>
              </div>
            </div>
          ) : (
            <div className="space-y-2">
              <p className="text-sm text-gray-100">
                Lösche … {bulk.done.toLocaleString('de-DE')} von {bulk.target.toLocaleString('de-DE')} Konten – bitte die Seite offen lassen.
              </p>
              <div className="h-2 overflow-hidden rounded-full bg-white/10">
                <div className="h-2 rounded-full bg-red-400 transition-all" style={{ width: `${Math.min(100, (bulk.done / Math.max(1, bulk.target)) * 100)}%` }} />
              </div>
            </div>
          )}
        </div>
      )}

      {showList && (
        <div className="space-y-3 rounded-xl border border-line bg-surface p-4">
          <p className="text-sm text-muted">
            E-Mail-Adressen einfügen – eine pro Zeile oder mit Komma/Leerzeichen getrennt. Die Konten werden samt ihrer kostenlosen Server gelöscht, Admins übersprungen.
          </p>
          <textarea
            className="input h-28 py-2.5 font-mono text-[13px]"
            value={emailText}
            onChange={(e) => setEmailText(e.target.value)}
            placeholder={'spam1@example.com\nspam2@example.com'}
          />
          <ActionButton
            label={`${listCount} ${listCount === 1 ? 'Adresse' : 'Adressen'} löschen`}
            confirm={`Wirklich ${listCount} Konten + Server löschen?`}
            danger
            run={deleteByEmails}
          />
          {listPending && <p className="text-[13px] text-muted">Lösche …</p>}
        </div>
      )}
      {result && (
        <div className="space-y-0.5 text-sm">
          <p className={result.ok ? 'text-emerald-300' : 'text-red-300'}>{result.text}</p>
          {result.skipped?.map((s) => (
            <p key={s.email} className="text-amber-300">
              Übersprungen: {s.email} – {s.reason}
            </p>
          ))}
        </div>
      )}

      <div className="overflow-x-auto rounded-xl border border-line">
        <table className="w-full min-w-[960px] text-left text-[13px]">
          <thead className="bg-surface-2 text-gray-300">
            <tr>
              <th className="w-10 px-3 py-2.5">
                <input
                  type="checkbox"
                  className="size-4 accent-blue-600"
                  aria-label="Alle auf dieser Seite auswählen"
                  title="Alle auf dieser Seite auswählen"
                  checked={allSelected}
                  disabled={selectable.length === 0}
                  onChange={(e) => setSelected(e.target.checked ? new Set(selectable.map((u) => u.id)) : new Set())}
                />
              </th>
              {['E-Mail', 'Rolle', 'Status', 'Panel-Konto', 'Server', 'Letzte Anmeldung', 'Registriert', 'Aktionen'].map((h) => (
                <th key={h} className="px-3 py-2.5 font-medium whitespace-nowrap">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-line bg-surface align-top">
            {list.map((u, index) => (
              <tr key={u.id} className={cn(selected.has(u.id) && 'bg-red-500/[0.04]')}>
                <td className="px-3 py-2.5">
                  <input
                    type="checkbox"
                    className="size-4 accent-blue-600"
                    aria-label={`${u.email} auswählen`}
                    checked={selected.has(u.id)}
                    disabled={!deletable(u)}
                    title={deletable(u) ? 'Umschalt + Klick wählt einen ganzen Bereich' : u.id === meId ? 'Dein eigenes Konto' : 'Admins können nicht gelöscht werden'}
                    onClick={(e) => {
                      e.preventDefault();
                      toggle(index, e.shiftKey);
                    }}
                    onChange={() => {}}
                  />
                </td>
                <td className="px-3 py-2.5">
                  <p className="text-gray-100">{u.email}</p>
                  <p className="text-[11px] text-subtle">
                    {u.emailVerified ? 'bestätigt' : 'nicht bestätigt'} · {u.locale.toUpperCase()}
                  </p>
                </td>
                <td className="px-3 py-2.5 text-muted">{u.role === 'admin' ? <span className="text-blue-300">Admin</span> : 'Nutzer'}
                  {u.beta && <span className="ml-1.5 rounded bg-amber-400/15 px-1.5 py-0.5 text-[11px] font-medium text-amber-200">Beta</span>}
                  {u.twoFactor && (
                    <span className="ml-1.5 rounded bg-emerald-400/15 px-1.5 py-0.5 text-[11px] font-medium text-emerald-200" title="Zweite Stufe bei der Anmeldung">
                      {u.twoFactor === 'totp' ? '2FA: App' : '2FA: Passwort'}
                    </span>
                  )}
                </td>
                <td className="px-3 py-2.5">{u.status === 'locked' ? <span className="text-red-300">gesperrt</span> : <span className="text-muted">aktiv</span>}</td>
                <td className="px-3 py-2.5">
                  {u.panelAdminUrl ? (
                    <a href={u.panelAdminUrl} target="_blank" rel="noopener" className="inline-flex items-center gap-0.5 text-blue-400 hover:text-blue-300">
                      {u.panelUsername} <ArrowUpRight className="size-3" aria-hidden />
                    </a>
                  ) : (
                    <span className="text-subtle">–</span>
                  )}
                </td>
                <td className="px-3 py-2.5 text-muted">{u.servers}</td>
                <td className="px-3 py-2.5 whitespace-nowrap text-muted">
                  {u.lastLoginAt ? formatDateTime(u.lastLoginAt, tz, 'de') : '–'}
                  <IpLine label="Letzte Anmelde-IP" ip={u.lastLoginIp} />
                </td>
                <td className="px-3 py-2.5 whitespace-nowrap text-muted">
                  {formatDate(u.createdAt, tz, 'de')}
                  <IpLine label="IP bei Registrierung" ip={u.registrationIp} />
                </td>
                <td className="px-3 py-2.5">
                  <div className="flex flex-wrap gap-1.5">
                    <UserActions user={u} self={u.id === meId} />
                    {deletable(u) && (
                      <ActionButton
                        label="Löschen"
                        confirm={u.servers ? `Konto + ${u.servers} Server löschen?` : 'Konto löschen?'}
                        danger
                        run={async () => {
                          setResult(null);
                          await remove([u.id]);
                        }}
                      />
                    )}
                  </div>
                </td>
              </tr>
            ))}
            {list.length === 0 && (
              <tr>
                <td colSpan={9} className="px-3 py-8 text-center text-muted">
                  Keine Nutzer gefunden.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <p className="text-[12px] text-subtle">
        Löschen entfernt das Konto auf dieser Website und alle kostenlosen Server (im Panel inkl. Welt und Backups). Das Pterodactyl-Konto bleibt bestehen – dort können
        auch bezahlte Server liegen. Wartelisten-Plätze werden frei, alle dahinter rücken auf. {IP_HINT}
      </p>
    </div>
  );
}
