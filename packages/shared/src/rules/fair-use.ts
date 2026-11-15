/**
 * Fair-Use- und Zyklus-Regeln als reine Funktionen.
 *
 * Alle Werte werden deterministisch aus Fakten berechnet
 * (Laufzeit-Sessions, Zeitstempel, Konfiguration). Dadurch sind die
 * Worker-Jobs idempotent: Ein erneuter Lauf mit denselben Fakten führt
 * immer zur selben Entscheidung.
 */
import type { CycleRules, FairUseRules } from '../config/freehosting.config';
import { DAY, HOUR, MINUTE, endOfWeekInZone, overlapMs, startOfWeekInZone } from './time';
import type { Localized } from '../i18n';

export interface RuntimeSession {
  startedAt: Date;
  endedAt: Date | null;
}

export type PauseReason = 'max_session' | 'weekly_offline' | 'manual';

export interface FairUseInput {
  now: Date;
  /** Sessions, die sich mit der aktuellen Woche überschneiden (inkl. offener Session). */
  sessions: RuntimeSession[];
  /** Server gilt als online (starting/running/stopping). */
  online: boolean;
  pausedUntil: Date | null;
  pauseReason: PauseReason | null;
  rules: FairUseRules;
}

export interface FairUseState {
  weekStart: string;
  weekEnd: string;
  online: boolean;
  currentSessionStartedAt: string | null;
  currentSessionSeconds: number;
  maxSessionSeconds: number;
  /** Verbleibende Sekunden bis zum Laufzeitlimit der aktuellen Session (nur online). */
  sessionRemainingSeconds: number | null;
  sessionLimitReached: boolean;
  weekRuntimeSeconds: number;
  weekOfflineSeconds: number;
  weeklyOfflineRequiredSeconds: number;
  /** Noch zu erbringende Offline-Zeit in dieser Woche. */
  weeklyOfflineRemainingSeconds: number;
  weeklyOfflineFulfilled: boolean;
  /**
   * Spätester Zeitpunkt, ab dem der Server bis Wochenende offline sein muss,
   * damit die wöchentliche Offline-Zeit erfüllt wird. null = bereits erfüllt.
   */
  weeklyOfflineDeadline: string | null;
  /** Server muss JETZT wegen der Wochenregel offline gehen. */
  mustGoOfflineForWeek: boolean;
  /** Voraussichtlicher automatischer Stopp (nur online). */
  autoStopAt: string | null;
  autoStopReason: PauseReason | null;
  isPaused: boolean;
  pausedUntil: string | null;
  pauseReason: PauseReason | null;
}

export function computeFairUse(input: FairUseInput): FairUseState {
  const { now, rules } = input;
  const nowMs = now.getTime();
  const weekStart = startOfWeekInZone(now, rules.timezone, rules.weekStartsOn);
  const weekEnd = endOfWeekInZone(now, rules.timezone, rules.weekStartsOn);
  const ws = weekStart.getTime();
  const we = weekEnd.getTime();

  let weekRuntimeMs = 0;
  let open: RuntimeSession | null = null;
  for (const s of input.sessions) {
    const start = s.startedAt.getTime();
    const end = s.endedAt ? s.endedAt.getTime() : nowMs;
    weekRuntimeMs += overlapMs(start, end, ws, nowMs);
    if (!s.endedAt && (!open || s.startedAt > open.startedAt)) open = s;
  }

  const elapsedMs = Math.max(0, nowMs - ws);
  const weekOfflineMs = Math.max(0, elapsedMs - weekRuntimeMs);
  const requiredMs = rules.weeklyOfflineHours * HOUR;
  const remainingRequiredMs = Math.max(0, requiredMs - weekOfflineMs);
  const fulfilled = remainingRequiredMs === 0;
  const deadlineMs = fulfilled ? null : we - remainingRequiredMs;

  const online = input.online;
  const maxSessionMs = rules.maxSessionHours * HOUR;
  const sessionStartMs = online && open ? open.startedAt.getTime() : null;
  const currentSessionMs = sessionStartMs !== null ? Math.max(0, nowMs - sessionStartMs) : 0;
  const sessionRemainingMs = sessionStartMs !== null ? Math.max(0, maxSessionMs - currentSessionMs) : null;

  const mustGoOfflineForWeek = online && deadlineMs !== null && nowMs >= deadlineMs;

  let autoStopAt: number | null = null;
  let autoStopReason: PauseReason | null = null;
  if (online) {
    if (sessionStartMs !== null) {
      autoStopAt = sessionStartMs + maxSessionMs;
      autoStopReason = 'max_session';
    }
    if (deadlineMs !== null && (autoStopAt === null || deadlineMs < autoStopAt)) {
      autoStopAt = Math.max(deadlineMs, nowMs);
      autoStopReason = 'weekly_offline';
    }
  }

  const isPaused = !!input.pausedUntil && input.pausedUntil.getTime() > nowMs;

  return {
    weekStart: weekStart.toISOString(),
    weekEnd: weekEnd.toISOString(),
    online,
    currentSessionStartedAt: sessionStartMs !== null ? new Date(sessionStartMs).toISOString() : null,
    currentSessionSeconds: Math.floor(currentSessionMs / 1000),
    maxSessionSeconds: Math.floor(maxSessionMs / 1000),
    sessionRemainingSeconds: sessionRemainingMs !== null ? Math.floor(sessionRemainingMs / 1000) : null,
    sessionLimitReached: sessionRemainingMs !== null && sessionRemainingMs <= 0,
    weekRuntimeSeconds: Math.floor(weekRuntimeMs / 1000),
    weekOfflineSeconds: Math.floor(weekOfflineMs / 1000),
    weeklyOfflineRequiredSeconds: Math.floor(requiredMs / 1000),
    weeklyOfflineRemainingSeconds: Math.floor(remainingRequiredMs / 1000),
    weeklyOfflineFulfilled: fulfilled,
    weeklyOfflineDeadline: deadlineMs !== null ? new Date(deadlineMs).toISOString() : null,
    mustGoOfflineForWeek,
    autoStopAt: autoStopAt !== null ? new Date(autoStopAt).toISOString() : null,
    autoStopReason,
    isPaused,
    pausedUntil: isPaused && input.pausedUntil ? input.pausedUntil.toISOString() : null,
    pauseReason: isPaused ? input.pauseReason : null,
  };
}

/* -------------------------------------------------------------------------- */
/*  30-Tage-Zyklus                                                             */
/* -------------------------------------------------------------------------- */

export interface CycleState {
  number: number;
  startedAt: string;
  endsAt: string;
  totalDays: number;
  /** Aufgerundete verbleibende Tage (für "Noch 18 Tage aktiv"). */
  daysRemaining: number;
  secondsRemaining: number;
  /** Anteil der bereits verstrichenen Zeit (0–1). */
  progress: number;
  /** Anteil der verbleibenden Zeit (0–1) – für den Fortschrittsbalken. */
  remainingRatio: number;
  expired: boolean;
}

export function computeCycle(input: { number: number; startedAt: Date; endsAt: Date; now: Date }): CycleState {
  const total = Math.max(1, input.endsAt.getTime() - input.startedAt.getTime());
  const remaining = Math.max(0, input.endsAt.getTime() - input.now.getTime());
  const progress = Math.min(1, Math.max(0, 1 - remaining / total));
  return {
    number: input.number,
    startedAt: input.startedAt.toISOString(),
    endsAt: input.endsAt.toISOString(),
    totalDays: Math.round(total / DAY),
    daysRemaining: Math.ceil(remaining / DAY),
    secondsRemaining: Math.floor(remaining / 1000),
    progress,
    remainingRatio: 1 - progress,
    expired: remaining === 0,
  };
}

export function cycleEndFrom(start: Date, rules: CycleRules): Date {
  return new Date(start.getTime() + rules.days * DAY);
}

/* -------------------------------------------------------------------------- */
/*  Start-Freigabe                                                             */
/* -------------------------------------------------------------------------- */

export type ServerStatus = 'waitlist' | 'pending' | 'provisioning' | 'provisioning_failed' | 'active' | 'expiring' | 'suspended' | 'deleted';

export type StartBlockReason =
  | 'not_active'
  | 'installing'
  | 'cycle_expired'
  | 'paused_max_session'
  | 'paused_weekly_offline'
  | 'paused_manual'
  | 'weekly_offline_required'
  | 'already_online';

export interface StartGate {
  allowed: boolean;
  reason: StartBlockReason | null;
  /** Ab wann ein Start wieder möglich ist (falls bekannt). */
  until: string | null;
}

export function getStartGate(input: {
  status: ServerStatus;
  powerState?: string;
  cycleEndsAt: Date;
  fairUse: FairUseState;
  now: Date;
  rules: FairUseRules;
}): StartGate {
  const { status, fairUse, now, rules } = input;
  if (status !== 'active') return { allowed: false, reason: 'not_active', until: null };
  if (input.cycleEndsAt.getTime() <= now.getTime()) return { allowed: false, reason: 'cycle_expired', until: null };
  if (input.powerState === 'installing') return { allowed: false, reason: 'installing', until: null };
  if (fairUse.online) return { allowed: false, reason: 'already_online', until: null };
  if (fairUse.isPaused && fairUse.pausedUntil) {
    const reason: StartBlockReason =
      fairUse.pauseReason === 'weekly_offline'
        ? 'paused_weekly_offline'
        : fairUse.pauseReason === 'manual'
          ? 'paused_manual'
          : 'paused_max_session';
    return { allowed: false, reason, until: fairUse.pausedUntil };
  }
  if (fairUse.weeklyOfflineDeadline) {
    const deadline = new Date(fairUse.weeklyOfflineDeadline).getTime();
    if (now.getTime() >= deadline - rules.minStartWindowMinutes * MINUTE) {
      return { allowed: false, reason: 'weekly_offline_required', until: fairUse.weekEnd };
    }
  }
  return { allowed: true, reason: null, until: null };
}

/* -------------------------------------------------------------------------- */
/*  Reaktivierung                                                              */
/* -------------------------------------------------------------------------- */

export type SuspensionReason = 'cycle_expired' | 'admin' | 'abuse';

export type ReactivationBlockReason =
  | 'not_suspended'
  | 'not_cycle_suspension'
  | 'email_not_verified'
  | 'account_locked'
  | 'max_reactivations'
  | 'cooldown';

export interface ReactivationGate {
  allowed: boolean;
  reason: ReactivationBlockReason | null;
  until: string | null;
}

export function getReactivationGate(input: {
  status: ServerStatus;
  suspensionReason: SuspensionReason | null;
  suspendedAt: Date | null;
  reactivationCount: number;
  userVerified: boolean;
  userActive: boolean;
  now: Date;
  rules: CycleRules;
}): ReactivationGate {
  if (input.status !== 'suspended') return { allowed: false, reason: 'not_suspended', until: null };
  if (input.suspensionReason !== 'cycle_expired') return { allowed: false, reason: 'not_cycle_suspension', until: null };
  if (!input.userActive) return { allowed: false, reason: 'account_locked', until: null };
  if (!input.userVerified) return { allowed: false, reason: 'email_not_verified', until: null };
  if (input.rules.maxReactivations !== null && input.reactivationCount >= input.rules.maxReactivations) {
    return { allowed: false, reason: 'max_reactivations', until: null };
  }
  if (input.rules.reactivationCooldownMinutes > 0 && input.suspendedAt) {
    const until = input.suspendedAt.getTime() + input.rules.reactivationCooldownMinutes * MINUTE;
    if (input.now.getTime() < until) return { allowed: false, reason: 'cooldown', until: new Date(until).toISOString() };
  }
  return { allowed: true, reason: null, until: null };
}

/* -------------------------------------------------------------------------- */
/*  Texte (Deutsch / Englisch)                                                 */
/* -------------------------------------------------------------------------- */

export const startBlockMessages: Record<StartBlockReason, Localized> = {
  not_active: { de: 'Der Server ist aktuell nicht aktiv.', en: 'The server is currently not active.' },
  installing: { de: 'Der Server wird gerade installiert.', en: 'The server is being installed.' },
  cycle_expired: {
    de: 'Der 30-Tage-Zyklus ist abgelaufen. Reaktiviere den Server, um einen neuen Zyklus zu starten.',
    en: 'The 30-day cycle has ended. Reactivate the server to start a new cycle.',
  },
  paused_max_session: { de: 'Pause nach Erreichen der maximalen Laufzeit.', en: 'Paused after reaching the maximum runtime.' },
  paused_weekly_offline: { de: 'Wöchentliche Offline-Zeit läuft.', en: 'Weekly offline time in progress.' },
  paused_manual: { de: 'Der Server wurde vom Team pausiert.', en: 'The server was paused by the team.' },
  weekly_offline_required: { de: 'Die wöchentliche Offline-Zeit muss jetzt eingehalten werden.', en: 'The weekly offline time must be taken now.' },
  already_online: { de: 'Der Server läuft bereits.', en: 'The server is already running.' },
};

export const reactivationBlockMessages: Record<ReactivationBlockReason, Localized> = {
  not_suspended: { de: 'Der Server ist nicht suspendiert.', en: 'The server is not suspended.' },
  not_cycle_suspension: {
    de: 'Dieser Server wurde vom Team suspendiert. Bitte kontaktiere den Support.',
    en: 'This server was suspended by the team. Please contact support.',
  },
  email_not_verified: { de: 'Bitte bestätige zuerst deine E-Mail-Adresse.', en: 'Please confirm your email address first.' },
  account_locked: { de: 'Dein Account ist gesperrt.', en: 'Your account is locked.' },
  max_reactivations: { de: 'Die maximale Anzahl an Reaktivierungen ist erreicht.', en: 'The maximum number of reactivations has been reached.' },
  cooldown: {
    de: 'Nach Ablauf der Laufzeit gilt eine Ruhezeit – danach kannst du den Server wieder reaktivieren.',
    en: 'A rest period applies after the cycle ends – you can reactivate the server afterwards.',
  },
};
