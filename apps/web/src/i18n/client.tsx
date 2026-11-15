'use client';

import { createContext, useContext, type ReactNode } from 'react';
import { applyRuntimeConfig, type BrandSettings, type Locale, type RuleSettings } from '@chfree/shared';
import { site } from '@/lib/site';
import { getDict } from './index';

const LangContext = createContext<Locale>('en');

export function LangProvider({ lang, children }: { lang: Locale; children: ReactNode }) {
  return <LangContext.Provider value={lang}>{children}</LangContext.Provider>;
}

export function useLang(): Locale {
  return useContext(LangContext);
}

export function useDict() {
  return getDict(useContext(LangContext));
}

/**
 * Übernimmt Regeln (Fair-Use, Laufzeit) und Links aus dem Admin-Bereich auch im Browser, bevor die
 * Komponenten darunter ihre Texte bauen. Der Server gibt die aktuellen Werte als Props herein.
 */
export function RuntimeConfig({ rules, brand, children }: { rules: RuleSettings; brand: BrandSettings; children: ReactNode }) {
  applyRuntimeConfig({ rules, brand });
  Object.assign(site, brand);
  return <>{children}</>;
}
