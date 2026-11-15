'use client';

/**
 * Admin → Domains: weitere Domains für die Website eintragen. HTTPS wird automatisch eingerichtet –
 * entweder direkt (DNS-Eintrag auf diesen Server, Zertifikat holt Caddy selbst) oder über einen Cloudflare Tunnel
 * (Link zum Freigeben der Domain, danach verbindet sich der Server von selbst – ohne offene Ports).
 */
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { Check, Cloud, Copy, ExternalLink, Globe, Loader2, Plus, RefreshCw, Trash2, TriangleAlert } from 'lucide-react';
import type { AdminDomainDTO, AdminDomainsDTO, AdminTunnelDTO } from '@chfree/shared';
import { Button } from '@/components/ui/button';
import { Alert, StatusDot } from '@/components/ui/primitives';
import { api, ApiClientError } from '@/lib/api/client';
import { cn } from '@/lib/utils';
import { Section, Toggle } from './admin-settings';

const errorText = (err: unknown) => (err instanceof ApiClientError ? err.message : 'Das hat nicht geklappt. Bitte erneut versuchen.');

function CopyValue({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        void navigator.clipboard?.writeText(value).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        });
      }}
      className="inline-flex items-center gap-1.5 rounded-md border border-line-strong bg-background px-2 py-1 font-mono text-[13px] text-gray-100 hover:border-white/25"
      title="Kopieren"
    >
      {value} {copied ? <Check className="size-3.5 text-emerald-400" aria-hidden /> : <Copy className="size-3.5 text-subtle" aria-hidden />}
    </button>
  );
}

function DomainRow({ d, viaTunnel, busy, onToggle, onRemove }: { d: AdminDomainDTO; viaTunnel: boolean; busy: boolean; onToggle: (redirect: boolean) => void; onRemove: () => void }) {
  return (
    <div className="rounded-lg border border-line p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="flex flex-wrap items-center gap-2 font-medium text-white">
            <StatusDot tone={d.reachable ? 'green' : 'amber'} />
            <a href={`https://${d.host}`} target="_blank" rel="noopener" className="truncate hover:underline">
              {d.host}
            </a>
            {d.primary && <span className="rounded-md bg-blue-500/15 px-2 py-0.5 text-xs font-medium text-blue-300">Hauptdomain</span>}
            {viaTunnel && <span className="rounded-md bg-white/[0.06] px-2 py-0.5 text-xs text-gray-300">über Tunnel</span>}
          </p>
          <p className="mt-1 text-[13px] text-muted">
            {d.reachable ? 'Erreichbar über HTTPS' : 'Noch nicht erreichbar'}
            {' · '}
            {d.addresses.length ? `DNS: ${d.addresses.join(', ')}` : 'kein DNS-Eintrag'}
            {d.pointsHere === true && ' (zeigt auf diesen Server)'}
            {!d.primary && ` · ${d.redirect ? 'leitet auf die Hauptdomain weiter' : 'liefert die Website aus'}`}
          </p>
          {d.hint && (
            <p className="mt-2 flex gap-2 text-[13px] leading-relaxed text-amber-300">
              <TriangleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden /> {d.hint}
            </p>
          )}
        </div>
        {!d.primary && (
          <Button type="button" variant="ghost" size="sm" icon={<Trash2 />} disabled={busy} onClick={onRemove}>
            Entfernen
          </Button>
        )}
      </div>
      {!d.primary && (
        <div className="mt-4 border-t border-line pt-4">
          <Toggle
            checked={d.redirect}
            onChange={onToggle}
            label="Auf die Hauptdomain weiterleiten"
            hint="Empfohlen: Besucher landen immer auf der Hauptdomain, Suchmaschinen sehen keine doppelten Inhalte. Aus = die Website wird unter dieser Domain ausgeliefert (kanonische Adresse bleibt die Hauptdomain)."
          />
        </div>
      )}
    </div>
  );
}

function TunnelCard({ tunnel, hosts, onChange }: { tunnel: AdminTunnelDTO; hosts: string[]; onChange: () => Promise<void> }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string[]>(tunnel.hosts.length ? tunnel.hosts.filter((h) => hosts.includes(h)) : hosts);
  const [results, setResults] = useState<{ host: string; ok: boolean; message: string }[] | null>(null);

  // Während der Freigabe bei Cloudflare regelmäßig nachsehen, ob sie erfolgt ist
  useEffect(() => {
    if (!tunnel.loginPending) return;
    const t = setInterval(() => void onChange(), 4000);
    return () => clearInterval(t);
  }, [tunnel.loginPending, onChange]);

  async function call(name: string, fn: () => Promise<unknown>) {
    setBusy(name);
    setError(null);
    try {
      await fn();
      await onChange();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(null);
    }
  }

  const step = !tunnel.loggedIn ? 1 : !tunnel.tunnelId || tunnel.hosts.length === 0 ? 2 : 3;

  return (
    <Section
      title="Cloudflare Tunnel"
      description="Für Domains, die bei Cloudflare liegen: Du gibst die Domain über einen Link frei, der Server legt den Tunnel und die DNS-Einträge selbst an. Es müssen keine Ports geöffnet werden, das HTTPS-Zertifikat stellt Cloudflare automatisch aus."
    >
      {!tunnel.installed ? (
        <Alert tone="warning" title="cloudflared ist auf dem Server nicht installiert">
          Auf dem Server einmal <code className="font-mono text-gray-100">sudo bash install.sh tunnel</code> ausführen (installiert das Tunnel-Programm und den Dienst) und diese
          Seite neu laden.
        </Alert>
      ) : (
        <>
          <dl className="grid gap-x-10 gap-y-2 text-sm sm:grid-cols-2">
            <div className="flex justify-between gap-4">
              <dt className="text-muted">Tunnel-Programm</dt>
              <dd className="text-gray-100">cloudflared {tunnel.version}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-muted">Bei Cloudflare freigegeben</dt>
              <dd className={tunnel.loggedIn ? 'text-emerald-300' : 'text-gray-100'}>{tunnel.loggedIn ? 'ja' : 'noch nicht'}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-muted">Tunnel</dt>
              <dd className="font-mono text-[13px] text-gray-100">{tunnel.tunnelId ? tunnel.tunnelId.slice(0, 8) + '…' : '–'}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-muted">Verbindung</dt>
              <dd className={tunnel.running ? 'text-emerald-300' : 'text-gray-100'}>
                {tunnel.running ? `verbunden (${tunnel.connections} Verbindungen)` : tunnel.tunnelId && tunnel.hosts.length ? 'nicht verbunden' : '–'}
              </dd>
            </div>
          </dl>

          {error && <Alert tone="error">{error}</Alert>}
          {tunnel.error && !error && <Alert tone="error">{tunnel.error}</Alert>}

          {/* Schritt 1: Domain freigeben */}
          <div className={cn('rounded-lg border p-4', step === 1 ? 'border-blue-500/50' : 'border-line')}>
            <p className="text-sm font-medium text-white">1 · Domain bei Cloudflare freigeben</p>
            {tunnel.loginUrl ? (
              <div className="mt-3 space-y-3">
                <p className="text-sm leading-relaxed text-muted">
                  Öffne den Link, melde dich bei Cloudflare an und wähle die Domain aus. Danach geht es hier automatisch weiter – diese Seite prüft alle paar Sekunden.
                </p>
                <a
                  href={tunnel.loginUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex h-11 items-center gap-2 rounded-lg bg-blue-600 px-5 text-[15px] font-medium text-white hover:bg-blue-500"
                >
                  Domain bei Cloudflare freigeben <ExternalLink className="size-4" aria-hidden />
                </a>
                <p className="flex items-center gap-2 text-[13px] text-subtle">
                  <Loader2 className="size-3.5 animate-spin" aria-hidden /> Warte auf die Freigabe … (der Link ist 15 Minuten gültig)
                </p>
              </div>
            ) : (
              <div className="mt-3 flex flex-wrap items-center gap-3">
                <Button
                  type="button"
                  variant={tunnel.loggedIn ? 'secondary' : 'primary'}
                  size="sm"
                  icon={<Cloud />}
                  loading={busy === 'login'}
                  onClick={() => call('login', () => api('/admin/tunnel/login', { body: { renew: tunnel.loggedIn } }))}
                >
                  {tunnel.loggedIn ? 'Andere Domain / anderes Konto freigeben' : 'Link zum Freigeben erzeugen'}
                </Button>
                {tunnel.loggedIn && <span className="text-[13px] text-emerald-300">Freigabe liegt vor.</span>}
              </div>
            )}
          </div>

          {/* Schritt 2: Tunnel + DNS */}
          <div className={cn('rounded-lg border p-4', step === 2 ? 'border-blue-500/50' : 'border-line', !tunnel.loggedIn && 'opacity-50')}>
            <p className="text-sm font-medium text-white">2 · Tunnel einrichten und Domains verbinden</p>
            <p className="mt-1 text-[13px] leading-relaxed text-muted">
              Wähle die Domains, die über den Tunnel laufen sollen. Der DNS-Eintrag wird bei Cloudflare automatisch gesetzt (ein vorhandener Eintrag wird überschrieben).
            </p>
            <div className="mt-3 flex flex-wrap gap-x-6 gap-y-2">
              {hosts.map((h) => (
                <label key={h} className="flex cursor-pointer items-center gap-2 text-sm text-gray-200">
                  <input
                    type="checkbox"
                    className="size-4 accent-blue-600"
                    checked={selected.includes(h)}
                    disabled={!tunnel.loggedIn}
                    onChange={(e) => setSelected((prev) => (e.target.checked ? [...prev, h] : prev.filter((x) => x !== h)))}
                  />
                  {h}
                </label>
              ))}
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              <Button
                type="button"
                size="sm"
                disabled={!tunnel.loggedIn || selected.length === 0}
                loading={busy === 'setup'}
                onClick={() =>
                  call('setup', async () => {
                    const res = await api<{ results: { host: string; ok: boolean; message: string }[] }>('/admin/tunnel/setup', { body: { hosts: selected } });
                    setResults(res.results);
                  })
                }
              >
                {tunnel.tunnelId ? 'Domains übernehmen' : 'Tunnel einrichten'}
              </Button>
              {tunnel.tunnelId && tunnel.hosts.length > 0 && (
                <>
                  <Button type="button" variant="secondary" size="sm" icon={<RefreshCw />} loading={busy === 'restart'} onClick={() => call('restart', () => api('/admin/tunnel/restart', { body: {} }))}>
                    Tunnel neu starten
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    loading={busy === 'disconnect'}
                    onClick={() => {
                      if (window.confirm('Tunnel trennen? Domains, die nur über den Tunnel laufen, sind danach nicht mehr erreichbar.')) {
                        void call('disconnect', () => api('/admin/tunnel/disconnect', { body: {} }));
                      }
                    }}
                  >
                    Tunnel trennen
                  </Button>
                </>
              )}
            </div>
            {results && (
              <ul className="mt-3 space-y-1 text-[13px]">
                {results.map((r) => (
                  <li key={r.host} className={r.ok ? 'text-emerald-300' : 'text-amber-300'}>
                    {r.host}: {r.message}
                  </li>
                ))}
              </ul>
            )}
          </div>

          {step === 3 && !tunnel.running && (
            <Alert tone="warning" title="Der Tunnel ist eingerichtet, aber nicht verbunden">
              Der Dienst startet automatisch, sobald die Konfiguration vorliegt – das dauert bis zu einer Minute. Bleibt es dabei: auf dem Server{' '}
              <code className="font-mono text-gray-100">chfree logs tunnel</code> ansehen.
            </Alert>
          )}
        </>
      )}
    </Section>
  );
}

export function DomainManager() {
  const router = useRouter();
  const [data, setData] = useState<AdminDomainsDTO | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [host, setHost] = useState('');
  const [redirect, setRedirect] = useState(true);

  const load = useCallback(async () => {
    try {
      const res = await api<{ domains: AdminDomainsDTO }>('/admin/domains');
      setData(res.domains);
      setError(null);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function act(fn: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      await load();
      router.refresh();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return (
      <p className="flex items-center gap-3 text-sm text-muted">
        <Loader2 className="size-4 animate-spin" aria-hidden /> Domains werden geprüft (DNS und HTTPS) …
      </p>
    );
  }
  if (!data) return <Alert tone="error">{error ?? 'Die Domains konnten nicht geladen werden.'}</Alert>;

  const ip4 = data.serverAddresses.find((a) => !a.includes(':'));
  const ip6 = data.serverAddresses.find((a) => a.includes(':'));

  return (
    <div className="space-y-6">
      {error && <Alert tone="error">{error}</Alert>}

      <Section
        title="Domains"
        description="Unter diesen Adressen ist die Website erreichbar. Trage eine weitere Domain ein – das HTTPS-Zertifikat wird automatisch eingerichtet, sobald die Domain hierher zeigt. Ein Neustart ist nicht nötig."
      >
        <div className="space-y-3">
          {data.domains.map((d) => (
            <DomainRow
              key={d.host}
              d={d}
              viaTunnel={data.tunnel.hosts.includes(d.host)}
              busy={busy}
              onToggle={(v) => void act(() => api('/admin/domains/update', { body: { host: d.host, redirect: v } }))}
              onRemove={() => {
                if (window.confirm(`Domain ${d.host} entfernen?`)) void act(() => api('/admin/domains/remove', { body: { host: d.host } }));
              }}
            />
          ))}
        </div>

        <form
          className="rounded-lg border border-dashed border-line-strong p-4"
          onSubmit={(e) => {
            e.preventDefault();
            void act(async () => {
              await api('/admin/domains', { body: { host, redirect } });
              setHost('');
            });
          }}
        >
          <p className="text-sm font-medium text-white">Domain hinzufügen</p>
          <div className="mt-3 flex flex-col gap-2 sm:flex-row">
            <div className="relative flex-1">
              <Globe className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-subtle" aria-hidden />
              <input className="input pl-9" value={host} placeholder="z. B. free.example.com" maxLength={253} onChange={(e) => setHost(e.target.value)} aria-label="Domain" />
            </div>
            <Button type="submit" icon={<Plus />} loading={busy} disabled={host.trim().length < 4}>
              Hinzufügen
            </Button>
          </div>
          <label className="mt-3 flex cursor-pointer items-center gap-2 text-sm text-muted">
            <input type="checkbox" className="size-4 accent-blue-600" checked={redirect} onChange={(e) => setRedirect(e.target.checked)} />
            Auf die Hauptdomain {data.primary} weiterleiten (empfohlen)
          </label>
        </form>

        <div className="flex flex-wrap items-center gap-3">
          <Button type="button" variant="secondary" size="sm" icon={<RefreshCw />} loading={busy} onClick={() => void act(async () => {})}>
            Erneut prüfen
          </Button>
          <span className="text-[13px] text-subtle">Die Hauptdomain änderst du auf dem Server mit „chfree reconfigure“ (sie steckt auch in E-Mail-Links und in der Sitemap).</span>
        </div>
      </Section>

      <Section
        title="Weg 1: Direkt (DNS-Eintrag)"
        description="Für jede Domain, egal bei welchem Anbieter: einen DNS-Eintrag auf diesen Server setzen. Beim ersten Aufruf holt der Server das HTTPS-Zertifikat von Let's Encrypt – automatisch, auch die Verlängerung."
      >
        <ol className="list-decimal space-y-2 pl-5 text-sm leading-relaxed text-muted">
          <li>Domain oben hinzufügen.</li>
          <li>
            Beim Domain-Anbieter einen <strong className="text-gray-100">A-Eintrag</strong> anlegen: {ip4 ? <CopyValue value={ip4} /> : <span className="text-amber-300">IPv4-Adresse dieses Servers</span>}
            {ip6 && (
              <>
                {' '}
                und optional einen <strong className="text-gray-100">AAAA-Eintrag</strong>: <CopyValue value={ip6} />
              </>
            )}
            . Bei Cloudflare den Proxy (orange Wolke) ausschalten – oder Weg 2 nutzen.
          </li>
          <li>Ein paar Minuten warten, dann „Erneut prüfen“. Ports 80 und 443 müssen am Server offen sein.</li>
        </ol>
        {!ip4 && !ip6 && (
          <p className="text-[13px] text-amber-300">Die IP-Adresse dieses Servers konnte nicht ermittelt werden (die Hauptdomain hat noch keinen DNS-Eintrag). Du findest sie bei deinem Server-Anbieter.</p>
        )}
      </Section>

      <TunnelCard tunnel={data.tunnel} hosts={data.domains.map((d) => d.host)} onChange={load} />
    </div>
  );
}
