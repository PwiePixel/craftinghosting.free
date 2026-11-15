import { freeHostingConfig } from '@chfree/shared';

const { brand } = freeHostingConfig;

/** Website-Konfiguration: Branding aus der zentralen Konfiguration, Links per NEXT_PUBLIC_* überschreibbar. */
export const site = {
  name: brand.productName,
  domain: brand.domain,
  parentName: brand.parentDisplayName,
  tagline: brand.tagline,
  poweredBy: brand.poweredBy,
  url: (process.env.NEXT_PUBLIC_SITE_URL ?? `https://${brand.domain}`).replace(/\/$/, ''),
  parentUrl: process.env.NEXT_PUBLIC_PARENT_URL || brand.parentUrl,
  parentPricingUrl: process.env.NEXT_PUBLIC_PARENT_PRICING_URL || brand.parentPricingUrl,
  statusUrl: process.env.NEXT_PUBLIC_STATUS_URL || brand.statusUrl,
  discordUrl: process.env.NEXT_PUBLIC_DISCORD_URL || brand.discordUrl,
  panelUrl: (process.env.NEXT_PUBLIC_PANEL_URL || brand.panelUrl).replace(/\/$/, ''),
  supportEmail: brand.supportEmail,
};

/** Panel-Adresse ohne Protokoll, z. B. für Texte: panel.craftinghosting.free */
export const panelHost = site.panelUrl.replace(/^https?:\/\//, '');

