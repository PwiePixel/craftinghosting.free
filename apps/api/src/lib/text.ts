import { tr, type Locale, type Localized } from '@chfree/shared';

/** Text, der je nach Sprache des Empfängers aufgelöst wird (fest, zweisprachig oder berechnet). */
export type LText = string | Localized | ((locale: Locale) => string);

export function resolveText(text: LText, locale: Locale): string {
  return typeof text === 'function' ? text(locale) : tr(text, locale);
}
