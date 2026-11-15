'use client';

import { createContext, useContext, type ReactNode } from 'react';
import type { Locale } from '@chfree/shared';
import { de } from './dictionaries/de';
import { en } from './dictionaries/en';

const dictionaries = { de, en };
const LangContext = createContext<Locale>('en');

export function LangProvider({ lang, children }: { lang: Locale; children: ReactNode }) {
  return <LangContext.Provider value={lang}>{children}</LangContext.Provider>;
}

export function useLang(): Locale {
  return useContext(LangContext);
}

export function useDict() {
  return dictionaries[useContext(LangContext)];
}
