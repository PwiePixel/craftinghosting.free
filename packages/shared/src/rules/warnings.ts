/**
 * Verwarnungs-System: Jede Abuse-Nachricht des Teams zählt als eine Verwarnung (abwählbar).
 * Ab der 2. aktiven Verwarnung gehen alle Dienste des Nutzers für 48 Stunden offline, bei der 4. wird das Konto
 * dauerhaft gesperrt (Ban). Verwarnungen verfallen nach 180 Tagen oder werden vom Team zurückgenommen.
 */
export const warningRules = {
  /** Ab dieser Zahl aktiver Verwarnungen: Auszeit für alle Dienste */
  timeoutFrom: 2,
  /** Ab dieser Zahl aktiver Verwarnungen: dauerhafte Sperre */
  banAt: 4,
  /** Dauer der Auszeit in Stunden */
  timeoutHours: 48,
  /** Eine Verwarnung zählt so viele Tage */
  expireDays: 180,
  /** So viele Tage nach dem Ban werden die Server samt Daten gelöscht */
  banDeleteDays: 14,
} as const;

export type WarningSanction = 'none' | 'timeout' | 'ban';

/** Folge der n-ten aktiven Verwarnung */
export function sanctionFor(activeWarnings: number): WarningSanction {
  if (activeWarnings >= warningRules.banAt) return 'ban';
  if (activeWarnings >= warningRules.timeoutFrom) return 'timeout';
  return 'none';
}
