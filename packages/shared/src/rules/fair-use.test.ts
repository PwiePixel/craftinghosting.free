import { describe, expect, it } from 'vitest';
import { freeHostingConfig, type CycleRules, type FairUseRules } from '../config/freehosting.config';
import { NO_CYCLE_END, computeCycle, computeFairUse, cycleEndFor, cycleRulesFor, getReactivationGate, getStartGate, hasCycleEnd, productHasCycle } from './fair-use';
import { restPeriodAfterText, restPeriodText } from '../format';
import { HOUR, MINUTE, endOfWeekInZone, startOfWeekInZone } from './time';

const rules: FairUseRules = {
  timezone: 'Europe/Berlin',
  weekStartsOn: 1,
  maxSessionHours: 24,
  sessionWarningMinutes: 60,
  cooldownMinutes: 60,
  weeklyOfflineHours: 12,
  weeklyOfflineWarningHours: 6,
  minStartWindowMinutes: 15,
};

const cycleRules: CycleRules = {
  days: 30,
  reminderDaysBefore: [3, 1],
  maxReactivations: null,
  reactivationCooldownMinutes: 0,
  deleteAfterRestHours: 48,
  deleteReminderHours: 24,
  stopGraceSeconds: 120,
};

describe('Wochengrenzen (Europe/Berlin)', () => {
  it('beginnt Montag 00:00 Ortszeit (Sommerzeit, UTC+2)', () => {
    // Donnerstag, 24.09.2026 14:00 UTC
    const start = startOfWeekInZone(new Date('2026-09-24T14:00:00Z'), 'Europe/Berlin', 1);
    expect(start.toISOString()).toBe('2026-09-20T22:00:00.000Z');
  });

  it('beginnt Montag 00:00 Ortszeit (Winterzeit, UTC+1)', () => {
    const start = startOfWeekInZone(new Date('2026-12-02T10:00:00Z'), 'Europe/Berlin', 1);
    expect(start.toISOString()).toBe('2026-11-29T23:00:00.000Z');
  });

  it('Sonntagabend kurz vor Mitternacht gehört noch zur alten Woche', () => {
    // Sonntag 27.09.2026 23:30 Ortszeit = 21:30 UTC
    const start = startOfWeekInZone(new Date('2026-09-27T21:30:00Z'), 'Europe/Berlin', 1);
    expect(start.toISOString()).toBe('2026-09-20T22:00:00.000Z');
  });

  it('Woche mit Zeitumstellung (Oktober) hat 169 Stunden', () => {
    const d = new Date('2026-10-22T12:00:00Z');
    const s = startOfWeekInZone(d, 'Europe/Berlin', 1);
    const e = endOfWeekInZone(d, 'Europe/Berlin', 1);
    expect((e.getTime() - s.getTime()) / HOUR).toBe(169);
  });

  it('Woche mit Zeitumstellung (März) hat 167 Stunden', () => {
    const d = new Date('2026-03-26T12:00:00Z');
    const s = startOfWeekInZone(d, 'Europe/Berlin', 1);
    const e = endOfWeekInZone(d, 'Europe/Berlin', 1);
    expect((e.getTime() - s.getTime()) / HOUR).toBe(167);
  });
});

describe('computeFairUse', () => {
  const weekStart = new Date('2026-09-20T22:00:00Z'); // Mo 21.09. 00:00 Ortszeit

  it('zählt Laufzeit und Offline-Zeit der aktuellen Woche', () => {
    const now = new Date(weekStart.getTime() + 48 * HOUR);
    const state = computeFairUse({
      now,
      sessions: [
        { startedAt: new Date(weekStart.getTime() - 5 * HOUR), endedAt: new Date(weekStart.getTime() + 10 * HOUR) },
        { startedAt: new Date(weekStart.getTime() + 20 * HOUR), endedAt: new Date(weekStart.getTime() + 30 * HOUR) },
      ],
      online: false,
      pausedUntil: null,
      pauseReason: null,
      rules,
    });
    expect(state.weekRuntimeSeconds).toBe(20 * 3600);
    expect(state.weekOfflineSeconds).toBe(28 * 3600);
    expect(state.weeklyOfflineFulfilled).toBe(true);
    expect(state.weeklyOfflineDeadline).toBeNull();
  });

  it('meldet Laufzeitlimit nach 24 Stunden', () => {
    const now = new Date(weekStart.getTime() + 30 * HOUR);
    const state = computeFairUse({
      now,
      sessions: [{ startedAt: new Date(weekStart.getTime() + 6 * HOUR), endedAt: null }],
      online: true,
      pausedUntil: null,
      pauseReason: null,
      rules,
    });
    expect(state.currentSessionSeconds).toBe(24 * 3600);
    expect(state.sessionLimitReached).toBe(true);
    expect(state.autoStopReason).toBe('max_session');
  });

  it('berechnet die Pflicht-Offline-Deadline, wenn die Woche knapp wird', () => {
    // Server läuft durchgehend seit Wochenbeginn, 6 h offline geschafft (Pausen)
    const now = new Date(weekStart.getTime() + 150 * HOUR);
    const state = computeFairUse({
      now,
      sessions: [
        { startedAt: weekStart, endedAt: new Date(weekStart.getTime() + 24 * HOUR) },
        { startedAt: new Date(weekStart.getTime() + 30 * HOUR), endedAt: new Date(weekStart.getTime() + 54 * HOUR) },
        { startedAt: new Date(weekStart.getTime() + 54 * HOUR), endedAt: new Date(weekStart.getTime() + 78 * HOUR) },
        { startedAt: new Date(weekStart.getTime() + 78 * HOUR), endedAt: new Date(weekStart.getTime() + 102 * HOUR) },
        { startedAt: new Date(weekStart.getTime() + 102 * HOUR), endedAt: new Date(weekStart.getTime() + 126 * HOUR) },
        { startedAt: new Date(weekStart.getTime() + 140 * HOUR), endedAt: null },
      ],
      online: true,
      pausedUntil: null,
      pauseReason: null,
      rules,
    });
    // Offline: 6 h (24–30) + 14 h (126–140) = 20 h ≥ 12 h → erfüllt
    expect(state.weekOfflineSeconds).toBe(20 * 3600);
    expect(state.weeklyOfflineFulfilled).toBe(true);
  });

  it('erzwingt Offline-Zeit, wenn sie sonst nicht mehr erreichbar ist', () => {
    const weekEnd = new Date(weekStart.getTime() + 168 * HOUR);
    // 4 h offline geschafft, Server läuft seit Stunde 4
    const now = new Date(weekEnd.getTime() - 8 * HOUR);
    const state = computeFairUse({
      now,
      sessions: [{ startedAt: new Date(weekStart.getTime() + 4 * HOUR), endedAt: null }],
      online: true,
      pausedUntil: null,
      pauseReason: null,
      rules: { ...rules, maxSessionHours: 1000 },
    });
    expect(state.weekOfflineSeconds).toBe(4 * 3600);
    expect(state.weeklyOfflineRemainingSeconds).toBe(8 * 3600);
    expect(state.weeklyOfflineDeadline).toBe(now.toISOString());
    expect(state.mustGoOfflineForWeek).toBe(true);
    expect(state.autoStopReason).toBe('weekly_offline');
  });
});

describe('getStartGate', () => {
  const now = new Date('2026-09-24T12:00:00Z');
  const base = computeFairUse({ now, sessions: [], online: false, pausedUntil: null, pauseReason: null, rules });

  it('erlaubt Start im Normalfall', () => {
    const gate = getStartGate({ status: 'active', cycleEndsAt: new Date(now.getTime() + 5 * HOUR), fairUse: base, now, rules });
    expect(gate.allowed).toBe(true);
  });

  it('blockiert während einer Pause', () => {
    const fu = computeFairUse({
      now,
      sessions: [],
      online: false,
      pausedUntil: new Date(now.getTime() + 30 * MINUTE),
      pauseReason: 'max_session',
      rules,
    });
    const gate = getStartGate({ status: 'active', cycleEndsAt: new Date(now.getTime() + 5 * HOUR), fairUse: fu, now, rules });
    expect(gate).toMatchObject({ allowed: false, reason: 'paused_max_session' });
  });

  it('blockiert nach Zyklusende', () => {
    const gate = getStartGate({ status: 'active', cycleEndsAt: new Date(now.getTime() - 1), fairUse: base, now, rules });
    expect(gate.reason).toBe('cycle_expired');
  });
});

describe('computeCycle', () => {
  it('zeigt verbleibende Tage aufgerundet', () => {
    const startedAt = new Date('2026-09-01T10:00:00Z');
    const endsAt = new Date('2026-10-01T10:00:00Z');
    const c = computeCycle({ number: 1, startedAt, endsAt, now: new Date('2026-09-13T12:00:00Z') });
    expect(c.daysRemaining).toBe(18);
    expect(c.totalDays).toBe(30);
    expect(c.expired).toBe(false);
  });

  it('ist abgelaufen nach dem Enddatum', () => {
    const c = computeCycle({
      number: 2,
      startedAt: new Date('2026-08-01T00:00:00Z'),
      endsAt: new Date('2026-08-31T00:00:00Z'),
      now: new Date('2026-09-01T00:00:00Z'),
    });
    expect(c.expired).toBe(true);
    expect(c.daysRemaining).toBe(0);
  });
});

describe('getReactivationGate', () => {
  const now = new Date('2026-09-24T12:00:00Z');
  const base = {
    status: 'suspended' as const,
    suspensionReason: 'cycle_expired' as const,
    suspendedAt: new Date(now.getTime() - HOUR),
    reactivationCount: 3,
    userVerified: true,
    userActive: true,
    now,
    rules: cycleRules,
  };

  it('erlaubt Reaktivierung nach Zyklusende', () => {
    expect(getReactivationGate(base).allowed).toBe(true);
  });

  it('verbietet Reaktivierung bei Admin-Suspendierung', () => {
    expect(getReactivationGate({ ...base, suspensionReason: 'admin' }).reason).toBe('not_cycle_suspension');
  });

  it('respektiert maximale Reaktivierungen', () => {
    expect(getReactivationGate({ ...base, rules: { ...cycleRules, maxReactivations: 3 } }).reason).toBe('max_reactivations');
  });

  it('Ruhetag: erst 24 h nach der Suspendierung reaktivierbar', () => {
    const rules = { ...cycleRules, reactivationCooldownMinutes: 1440 };
    const blocked = getReactivationGate({ ...base, rules, suspendedAt: new Date(now.getTime() - 23 * HOUR) });
    expect(blocked.allowed).toBe(false);
    expect(blocked.reason).toBe('cooldown');
    expect(blocked.until).toBe(new Date(now.getTime() + HOUR).toISOString());
    expect(getReactivationGate({ ...base, rules, suspendedAt: new Date(now.getTime() - 24 * HOUR) }).allowed).toBe(true);
  });
});

describe('Ruhezeit-Texte', () => {
  it('formuliert Tage und Stunden', () => {
    expect(restPeriodText(1440)).toBe('1 Ruhetag');
    expect(restPeriodText(2880)).toBe('2 Ruhetage');
    expect(restPeriodText(720)).toBe('12 h Ruhezeit');
    expect(restPeriodText(0)).toBe('');
    expect(restPeriodAfterText(1440)).toBe('nach einem Ruhetag');
    expect(restPeriodAfterText(2880)).toBe('nach 2 Ruhetagen');
  });
});

describe('Produkte ohne Zyklus (Discord-Bots)', () => {
  const rules = freeHostingConfig.cycle;
  const now = new Date('2026-06-01T12:00:00Z');

  it('nur Minecraft-Server haben den 30-Tage-Zyklus', () => {
    expect(productHasCycle('minecraft')).toBe(true);
    expect(productHasCycle('discord')).toBe(false);
    expect(cycleEndFor('minecraft', now, rules).getTime()).toBe(now.getTime() + rules.days * 86_400_000);
    expect(cycleEndFor('discord', now, rules)).toEqual(NO_CYCLE_END);
  });

  it('ein Bot läuft ohne Enddatum und läuft nie ab', () => {
    const cycle = computeCycle({ number: 1, startedAt: now, endsAt: NO_CYCLE_END, now: new Date('2031-01-01T00:00:00Z') });
    expect(cycle.unlimited).toBe(true);
    expect(cycle.expired).toBe(false);
    expect(hasCycleEnd(NO_CYCLE_END)).toBe(false);
    expect(hasCycleEnd(cycleEndFor('minecraft', now, rules))).toBe(true);
    expect(computeCycle({ number: 1, startedAt: now, endsAt: cycleEndFor('minecraft', now, rules), now }).unlimited).toBe(false);
  });

  it('Bots haben keine Ruhezeit vor dem Reaktivieren', () => {
    expect(cycleRulesFor('discord', rules).reactivationCooldownMinutes).toBe(0);
    expect(cycleRulesFor('minecraft', rules).reactivationCooldownMinutes).toBe(rules.reactivationCooldownMinutes);
    const gate = (kind: 'minecraft' | 'discord') =>
      getReactivationGate({
        status: 'suspended',
        suspensionReason: 'cycle_expired',
        suspendedAt: new Date(now.getTime() - 60_000),
        reactivationCount: 0,
        userVerified: true,
        userActive: true,
        now,
        rules: cycleRulesFor(kind, rules),
      });
    expect(gate('discord').allowed).toBe(true);
    expect(gate('minecraft').allowed).toBe(rules.reactivationCooldownMinutes === 0);
  });
});
