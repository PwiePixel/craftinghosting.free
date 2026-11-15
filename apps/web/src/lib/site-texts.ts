/**
 * Texte, die von den Einstellungen im Admin-Bereich abhängen (Pakete, Standorte, Hardware):
 * „bis zu X GB RAM“ richtet sich nach dem größten Paket, „DE“ nach den eingestellten Standorten.
 */
import { formatMb, locationCodes, locationNames, maxPlanMemoryMb, type Locale, type PublicSiteDTO } from '@chfree/shared';
import type { FaqContext } from '@/i18n/dictionaries/de';

/** RAM-Angaben einer Paketliste: „4 GB oder 6 GB“ bzw. „256 MB bis 2 GB“ */
export function ramRange(plans: readonly { memoryMb: number }[], lang: Locale): string {
  const values = [...new Set(plans.map((p) => p.memoryMb))].sort((a, b) => a - b);
  if (values.length === 0) return '–';
  if (values.length <= 2) return values.map((v) => formatMb(v, lang)).join(lang === 'de' ? ' oder ' : ' or ');
  return `${formatMb(values[0]!, lang)} ${lang === 'de' ? 'bis' : 'to'} ${formatMb(values[values.length - 1]!, lang)}`;
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
    faq: {
      minecraftRam: ramRange(minecraftPlans, lang),
      discordRam: discord ? ramRange(discordPlans, lang) : null,
      discordFairUse: bot.fairUse,
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
  if (lang === 'de') {
    const offer = mc && x.discord ? 'kostenlose Minecraft-Server und kostenloses Discord-Bot-Hosting (Python, Node.js)' : x.discord ? 'kostenloses Discord-Bot-Hosting (Python, Node.js)' : 'kostenlose Minecraft-Server';
    return `CraftingHosting.free ist das kostenlose Hosting-Angebot von Crafting Hosting (crafting.host). Es bietet ${offer} – ohne Zahlungsdaten und ohne versteckte Kosten. Server werden auf der Website erstellt und im Pterodactyl-Panel verwaltet. Die Hardware (${x.cpus}, NVMe) steht in ${x.locationNames}. Jeder Server läuft ${days} Tage und lässt sich danach kostenlos verlängern; ein Fair-Use-System sorgt dafür, dass die geteilte Hardware für alle schnell bleibt.`;
  }
  const offer = mc && x.discord ? 'free Minecraft servers and free Discord bot hosting (Python, Node.js)' : x.discord ? 'free Discord bot hosting (Python, Node.js)' : 'free Minecraft servers';
  return `CraftingHosting.free is the free hosting offer by Crafting Hosting (crafting.host). It provides ${offer} – no payment details and no hidden costs. Servers are created on the website and managed in the Pterodactyl panel. The hardware (${x.cpus}, NVMe) is located in ${x.locationNames}. Every server runs for ${days} days and can then be renewed for free; a fair-use system keeps the shared hardware fast for everyone.`;
}
