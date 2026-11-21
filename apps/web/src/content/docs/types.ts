/** Bausteine der Dokumentation (/docs). Texte liegen in beiden Sprachen vor. */
export type L = { de: string; en: string };

export type Block =
  | { p: L }
  /** Zwischenüberschrift innerhalb eines Abschnitts */
  | { h3: L }
  | { ul: L[] }
  | { ol: L[] }
  | { note: L; tone?: 'info' | 'warning' }
  | { code: string; title?: L }
  | { table: { head: L[]; rows: (string | L)[][] } }
  /** Wert zum Kopieren, z. B. die Basis-Adresse der API */
  | { copy: { label: L; value: string } }
  /** Änderungsprotokoll: neueste zuerst */
  | { changes: { date: string; items: L[] }[] };

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
