import { freeHostingConfig } from '@chfree/shared';
import { site } from '@/lib/site';
import type { DocVars } from './types';

/** Platzhalter der Doku-Texte (für Seiten und Navigation gleich) */
export const docVars = (): DocVars => ({ panel: site.panelUrl.replace(/^https?:\/\//, ''), days: String(freeHostingConfig.cycle.days), api: `${site.url}/api/v1/partner` });
