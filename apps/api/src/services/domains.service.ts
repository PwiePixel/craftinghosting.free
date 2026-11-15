/**
 * Domains der Website: Hauptdomain (aus der Installation) + weitere Domains aus dem Admin-Bereich.
 *
 * Für jede Domain gibt es zwei Wege zum HTTPS-Zertifikat – beide ohne Handarbeit:
 *  1. Direkt:  DNS-Eintrag (A/AAAA) auf diesen Server → Caddy holt das Zertifikat beim ersten Aufruf selbst
 *              („On-Demand TLS“). Caddy fragt vorher bei der API nach, ob die Domain eingetragen ist (/internal/tls-check).
 *  2. Tunnel:  Cloudflare Tunnel (siehe tunnel.service.ts) – kein offener Port, Zertifikat kommt von Cloudflare.
 */
import { promises as dns } from 'node:dns';
import { normalizeHost, type AdminDomainDTO, type AdminDomainsDTO, type SiteSettings } from '@chfree/shared';
import type { User } from '../db/schema';
import { env } from '../env';
import { Errors, L } from '../lib/errors';
import { audit } from './audit.service';
import { getSettings, invalidatePublicSite, saveSettings } from './settings.service';
import { tunnelStatus } from './tunnel.service';

export const primaryHost = () => new URL(env.APP_URL).hostname;

async function resolveAll(host: string): Promise<string[]> {
  const [v4, v6] = await Promise.all([dns.resolve4(host).catch(() => []), dns.resolve6(host).catch(() => [])]);
  return [...v4, ...v6];
}

/** Öffentliche Adressen dieses Servers: aus SERVER_PUBLIC_IPS (setzt der Installer) – sonst die der Hauptdomain */
async function serverAddresses(): Promise<string[]> {
  const fromEnv = (process.env.SERVER_PUBLIC_IPS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return fromEnv.length ? fromEnv : resolveAll(primaryHost());
}

/** Ist die Website unter https://host erreichbar (gültiges Zertifikat, unsere API antwortet)? */
async function reachable(host: string): Promise<boolean> {
  try {
    const res = await fetch(`https://${host}/api/v1/health`, { signal: AbortSignal.timeout(5000), redirect: 'manual' });
    if (!res.ok) return false;
    return ((await res.json()) as { ok?: boolean }).ok === true;
  } catch {
    return false;
  }
}

async function inspect(host: string, opts: { primary: boolean; redirect: boolean }, own: string[], tunnelHosts: string[]): Promise<AdminDomainDTO> {
  const [addresses, ok] = await Promise.all([resolveAll(host), reachable(host)]);
  const pointsHere = own.length ? addresses.some((a) => own.includes(a)) : null;
  const viaTunnel = tunnelHosts.includes(host);
  let hint: string | null = null;
  if (!ok) {
    if (addresses.length === 0) hint = viaTunnel ? 'Tunnel eingerichtet – der DNS-Eintrag wird gerade verteilt (kann ein paar Minuten dauern).' : 'Kein DNS-Eintrag gefunden. Lege einen A-Eintrag auf die IP dieses Servers an – oder verbinde die Domain über den Tunnel.';
    else if (pointsHere === false && !viaTunnel) hint = 'Der DNS-Eintrag zeigt auf einen anderen Server. Bitte auf die IP dieses Servers ändern (bei Cloudflare: Proxy aus oder Tunnel nutzen).';
    else hint = 'DNS stimmt, aber die Website antwortet unter dieser Domain noch nicht über HTTPS. Das Zertifikat wird beim ersten Aufruf geholt – in ein bis zwei Minuten erneut prüfen. Ports 80 und 443 müssen offen sein.';
  }
  return { host, primary: opts.primary, redirect: opts.redirect, addresses, pointsHere, reachable: ok, hint };
}

export async function domainsOverview(): Promise<AdminDomainsDTO> {
  const settings = await getSettings();
  const [own, tunnel] = await Promise.all([serverAddresses(), tunnelStatus()]);
  const primary = primaryHost();
  const domains = await Promise.all([
    inspect(primary, { primary: true, redirect: false }, own, tunnel.hosts),
    ...settings.domains.extra.map((d) => inspect(d.host, { primary: false, redirect: d.redirect }, own, tunnel.hosts)),
  ]);
  return { primary, serverAddresses: own, domains, tunnel };
}

async function saveDomains(next: SiteSettings['domains']['extra']) {
  const settings = await getSettings();
  await saveSettings({ ...settings, domains: { extra: next } });
  invalidatePublicSite();
}

export async function addDomain(admin: Pick<User, 'email'>, rawHost: string, redirect: boolean, ip?: string): Promise<void> {
  const host = normalizeHost(rawHost);
  if (!host) throw Errors.badRequest('invalid_domain', L('Das ist kein gültiger Domainname (Beispiel: free.example.com).', 'This is not a valid domain name (example: free.example.com).'));
  const primary = primaryHost();
  const settings = await getSettings();
  if (host === primary || host === `www.${primary}` || settings.domains.extra.some((d) => d.host === host)) {
    throw Errors.conflict('domain_exists', L('Diese Domain ist bereits eingetragen.', 'This domain has already been added.'));
  }
  await saveDomains([...settings.domains.extra, { host, redirect, addedAt: new Date().toISOString() }]);
  await audit({ actor: 'admin', action: 'domain.added', message: `Domain ${host} hinzugefügt (${redirect ? 'Weiterleitung auf die Hauptdomain' : 'liefert die Website aus'}) (durch ${admin.email})`, ip });
}

export async function updateDomain(admin: Pick<User, 'email'>, host: string, redirect: boolean, ip?: string): Promise<void> {
  const settings = await getSettings();
  if (!settings.domains.extra.some((d) => d.host === host)) throw Errors.notFound(L('Domain nicht gefunden.', 'Domain not found.'));
  await saveDomains(settings.domains.extra.map((d) => (d.host === host ? { ...d, redirect } : d)));
  await audit({ actor: 'admin', action: 'domain.updated', message: `Domain ${host}: ${redirect ? 'Weiterleitung auf die Hauptdomain' : 'liefert die Website aus'} (durch ${admin.email})`, ip });
}

export async function removeDomain(admin: Pick<User, 'email'>, host: string, ip?: string): Promise<void> {
  const settings = await getSettings();
  if (!settings.domains.extra.some((d) => d.host === host)) throw Errors.notFound(L('Domain nicht gefunden.', 'Domain not found.'));
  await saveDomains(settings.domains.extra.filter((d) => d.host !== host));
  await audit({ actor: 'admin', action: 'domain.removed', message: `Domain ${host} entfernt (durch ${admin.email})`, ip });
}
