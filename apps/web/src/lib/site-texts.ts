/**
 * Texte, die von den Einstellungen im Admin-Bereich abhängen (Pakete, Standorte, Hardware):
 * „bis zu X GB RAM“ richtet sich nach dem größten Paket, „DE“ nach den eingestellten Standorten.
 */
import { formatMb, intlLocale, locationCodes, locationNames, maxPlanMemoryMb, type Locale, type PublicPlanDTO, type PublicSiteDTO, describeServerLimits } from '@chfree/shared';
import type { FaqContext } from '@/i18n/dictionaries/de';

/** RAM-Angaben einer Paketliste: „4 GB oder 6 GB“ bzw. „256 MB bis 2 GB“ */
export function ramRange(plans: readonly { memoryMb: number }[], lang: Locale): string {
  const values = [...new Set(plans.map((p) => p.memoryMb))].sort((a, b) => a - b);
  if (values.length === 0) return '–';
  if (values.length <= 2) return values.map((v) => formatMb(v, lang)).join(lang === 'de' ? ' oder ' : ' or ');
  return `${formatMb(values[0]!, lang)} ${lang === 'de' ? 'bis' : 'to'} ${formatMb(values[values.length - 1]!, lang)}`;
}

/** CPU-Limit als Threads: 200 → „2“, 350 → „3,5“ (de) bzw. „3.5“ (en) */
export function cpuThreads(cpuPercent: number, lang: Locale): string {
  return (cpuPercent / 100).toLocaleString(intlLocale(lang), { maximumFractionDigits: 2 });
}

/**
 * Alle Eckdaten eines Pakets in einer Zeile – EINE Quelle für die strukturierten Daten (schema.org) und /llms.txt.
 * Die Werte kommen aus den Paketen im Admin-Bereich, nie aus den Standardwerten im Code.
 */
export function planFacts(p: PublicPlanDTO, lang: Locale): string {
  const de = lang === 'de';
  const one = p.cpuPercent === 100;
  const parts = [
    `${formatMb(p.memoryMb, lang)} RAM`,
    de ? `bis ${cpuThreads(p.cpuPercent, lang)} ${one ? 'Thread' : 'Threads'} (geteilt)` : `up to ${cpuThreads(p.cpuPercent, lang)} CPU ${one ? 'thread' : 'threads'} (shared)`,
    de ? `${formatMb(p.diskMb, lang)} NVMe-Speicher` : `${formatMb(p.diskMb, lang)} NVMe storage`,
  ];
  if (p.backups > 0) parts.push(de ? `${p.backups} ${p.backups === 1 ? 'Backup' : 'Backups'} (täglich automatisch)` : `${p.backups} ${p.backups === 1 ? 'backup' : 'backups'} (daily, automatic)`);
  if (p.databases > 0) parts.push(de ? `${p.databases} ${p.databases === 1 ? 'Datenbank' : 'Datenbanken'}` : `${p.databases} ${p.databases === 1 ? 'database' : 'databases'}`);
  if (p.allocations > 1) parts.push(`${p.allocations} ${de ? 'Ports' : 'ports'}`);
  return parts.join(' · ');
}

export interface SiteTexts {
  /** Größtes aktives Paket über beide Produkte, z. B. „6 GB“ */
  maxRam: string;
  locationCodes: string;
  locationNames: string;
  locationCount: number;
  cpus: string;
  /** Discord-Bots werden angeboten und haben Pakete */
  discord: boolean;
  /** Es gibt zwei Hardware-Stufen auf der Warteliste (EPYC-Plätze > 0) */
  twoTiers: boolean;
  /** Wie viele kostenlose Server pro Person möglich sind – als Satz */
  limits: string;
  faq: FaqContext;
}

export function siteTexts(site: PublicSiteDTO, lang: Locale): SiteTexts {
  const mc = site.products.minecraft;
  const bot = site.products.discord;
  const minecraftPlans = mc.enabled ? mc.plans : [];
  const discordPlans = bot.enabled ? bot.plans : [];
  const discord = discordPlans.length > 0;
  const names = locationNames(site.hardware.locations, lang) || (lang === 'de' ? 'Deutschland' : 'Germany');
  const cpus = site.hardware.cpus.join(' / ');
  return {
    maxRam: formatMb(maxPlanMemoryMb([...minecraftPlans, ...discordPlans]) || 1024, lang),
    locationCodes: locationCodes(site.hardware.locations) || 'DE',
    locationNames: names,
    locationCount: Math.max(1, site.hardware.locations.length),
    cpus,
    discord,
    twoTiers: site.waitlist.epycSlots > 0,
    limits: describeServerLimits(site.registration.limits, lang, [...(minecraftPlans.length > 0 ? (['minecraft'] as const) : []), ...(discord ? (['discord'] as const) : [])]),
    faq: {
      minecraftRam: ramRange(minecraftPlans, lang),
      discordRam: discord ? ramRange(discordPlans, lang) : null,
      discordFairUse: bot.fairUse,
      discordRequired: site.discord.required,
      locations: names,
      cpus,
    },
  };
}

/**
 * Sachliche Kurzbeschreibung des Angebots – EINE Quelle für Suchmaschinen (strukturierte Daten) und
 * KI-Assistenten (/llms.txt). Alle Zahlen kommen aus den Einstellungen, damit sich Angaben nie widersprechen.
 * Ein eigener Text aus dem Admin-Bereich (Einstellungen → Suchmaschinen & KI) hat Vorrang.
 */
export function siteSummary(site: PublicSiteDTO, lang: Locale): string {
  const custom = site.seo.summary[lang] || site.seo.summary[lang === 'de' ? 'en' : 'de'];
  if (custom) return custom;
  const x = siteTexts(site, lang);
  const mc = site.products.minecraft.enabled && site.products.minecraft.plans.length > 0;
  const days = site.rules.cycle.days;
  // Nur Minecraft-Server haben den Zyklus – Discord-Bots laufen ohne Ablaufdatum
  const runtimeDe = [mc && `Minecraft-Server laufen ${days} Tage und lassen sich danach kostenlos verlängern.`, x.discord && 'Discord-Bots laufen durchgehend, ohne Ablaufdatum und ohne Ruhetag.']
    .filter(Boolean)
    .join(' ');
  const runtimeEn = [mc && `Minecraft servers run for ${days} days and can then be renewed for free.`, x.discord && 'Discord bots run continuously, with no expiry date and no rest day.']
    .filter(Boolean)
    .join(' ');
  if (lang === 'de') {
    const offer = mc && x.discord ? 'kostenlose Minecraft-Server und kostenloses Discord-Bot-Hosting (Python, Node.js)' : x.discord ? 'kostenloses Discord-Bot-Hosting (Python, Node.js)' : 'kostenlose Minecraft-Server';
    return `CraftingHosting.free ist das kostenlose Hosting-Angebot von Crafting Hosting (crafting.host). Es bietet ${offer} – ohne Zahlungsdaten und ohne versteckte Kosten. Server werden auf der Website erstellt und im Pterodactyl-Panel verwaltet. Die Hardware (${x.cpus}, NVMe) steht in ${x.locationNames}. ${runtimeDe} Ein Fair-Use-System sorgt dafür, dass die geteilte Hardware für alle schnell bleibt.`;
  }
  const offer = mc && x.discord ? 'free Minecraft servers and free Discord bot hosting (Python, Node.js)' : x.discord ? 'free Discord bot hosting (Python, Node.js)' : 'free Minecraft servers';
  return `CraftingHosting.free is the free hosting offer by Crafting Hosting (crafting.host). It provides ${offer} – no payment details and no hidden costs. Servers are created on the website and managed in the Pterodactyl panel. The hardware (${x.cpus}, NVMe) is located in ${x.locationNames}. ${runtimeEn} A fair-use system keeps the shared hardware fast for everyone.`;
}
