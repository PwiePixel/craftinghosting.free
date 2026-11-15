/**
 * Laufzeit-Hilfen: lädt Sessions und berechnet Fair-Use-/Zyklus-Zustände
 * über die gemeinsamen Regeln aus @chfree/shared.
 */
import { and, asc, eq, gt, isNull, lt, or } from 'drizzle-orm';
import {
  computeCycle,
  computeFairUse,
  endOfWeekInZone,
  freeHostingConfig,
  getReactivationGate,
  getStartGate,
  startOfWeekInZone,
  type CycleState,
  type FairUseState,
  type PowerState,
  type ReactivationGate,
  type StartGate,
} from '@chfree/shared';
import { db } from '../db/client';
import { serverSessions, type Server, type ServerSession, type User } from '../db/schema';

const { fairUse: fairUseRules, cycle: cycleRules } = freeHostingConfig;

export const ONLINE_STATES: PowerState[] = ['starting', 'running', 'stopping'];

export function isOnline(state: PowerState | string): boolean {
  return ONLINE_STATES.includes(state as PowerState);
}

export async function loadWeekSessions(serverId: string, now: Date): Promise<ServerSession[]> {
  const weekStart = startOfWeekInZone(now, fairUseRules.timezone, fairUseRules.weekStartsOn);
  const weekEnd = endOfWeekInZone(now, fairUseRules.timezone, fairUseRules.weekStartsOn);
  return db
    .select()
    .from(serverSessions)
    .where(
      and(
        eq(serverSessions.serverId, serverId),
        lt(serverSessions.startedAt, weekEnd),
        or(isNull(serverSessions.endedAt), gt(serverSessions.endedAt, weekStart)),
      ),
    )
    .orderBy(asc(serverSessions.startedAt));
}

export interface ServerRuntimeState {
  fairUse: FairUseState;
  cycle: CycleState;
  startGate: StartGate;
  reactivation: ReactivationGate;
  openSession: ServerSession | null;
}

/**
 * `fairUseEnabled = false`: Für dieses Produkt gilt kein Fair-Use-System (z. B. Discord-Bots im Dauerbetrieb) –
 * es gibt dann weder Laufzeitlimit noch Wochen-Offline-Zeit, nur der 30-Tage-Zyklus zählt.
 */
export function computeRuntimeState(server: Server, user: User, sessions: ServerSession[], now: Date, fairUseEnabled = true): ServerRuntimeState {
  const computed = computeFairUse({
    now,
    sessions: sessions.map((s) => ({ startedAt: s.startedAt, endedAt: s.endedAt })),
    online: isOnline(server.powerState),
    pausedUntil: server.pausedUntil,
    pauseReason: server.pauseReason,
    rules: fairUseRules,
  });
  const fairUse: FairUseState = fairUseEnabled
    ? computed
    : {
        ...computed,
        sessionRemainingSeconds: null,
        sessionLimitReached: false,
        weeklyOfflineRemainingSeconds: 0,
        weeklyOfflineFulfilled: true,
        weeklyOfflineDeadline: null,
        mustGoOfflineForWeek: false,
        autoStopAt: null,
        autoStopReason: null,
      };
  const cycle = computeCycle({
    number: server.cycleNumber,
    startedAt: server.cycleStartedAt,
    endsAt: server.cycleEndsAt,
    now,
  });
  const startGate = getStartGate({ status: server.status, powerState: server.powerState, cycleEndsAt: server.cycleEndsAt, fairUse, now, rules: fairUseRules });
  const reactivation = getReactivationGate({
    status: server.status,
    suspensionReason: server.suspensionReason,
    suspendedAt: server.suspendedAt,
    reactivationCount: server.reactivationCount,
    userVerified: !!user.emailVerifiedAt,
    userActive: user.status === 'active',
    now,
    rules: cycleRules,
  });
  const openSession = sessions.find((s) => !s.endedAt) ?? null;
  return { fairUse, cycle, startGate, reactivation, openSession };
}
