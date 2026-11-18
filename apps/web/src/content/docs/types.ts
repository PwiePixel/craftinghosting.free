/** Bausteine der Dokumentation (/docs). Texte liegen in beiden Sprachen vor. */
export type L = { de: string; en: string };

export type Block =
  | { p: L }
  | { ul: L[] }
  | { ol: L[] }
  | { note: L }
  | { code: string }
  | { table: { head: L[]; rows: (string | L)[][] } };

export interface DocSection {
  heading: L;
  blocks: Block[];
}

export interface DocPage {
  slug: string;
  title: L;
  summary: L;
  sections: DocSection[];
}

/** Platzhalter in Texten: {panel}, {days}, {discord}, {api} */
export type DocVars = Record<string, string>;
export const fill = (text: string, vars: DocVars) => text.replace(/\{(\w+)\}/g, (all, key: string) => vars[key] ?? all);
