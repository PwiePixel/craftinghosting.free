/**
 * Laufzeit-Hilfen: lädt Sessions und berechnet Fair-Use-/Zyklus-Zustände
 * über die gemeinsamen Regeln aus @chfree/shared.
 */
import { identityConfirmed } from './identity';
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
  cycleRulesFor,
  cycleEndFor,
  NO_CYCLE_END,
  type SiteSettings,
} from '@chfree/shared';
import { db } from '../db/client';
import { serverSessions, type Server, type ServerSession, type User } from '../db/schema';

const { fairUse: fairUseRules, cycle: cycleRules } = freeHostingConfig;

export const ONLINE_STATES: PowerState[] = ['starting', 'running', 'stopping'];

/**
 * Gilt für diesen Server das Fair-Use-System (Laufzeitlimit, Pausen, Wochen-Offline-Zeit)? Nicht für Produkte ohne
 * Fair-Use (Discord-Bots) und nicht, solange das Extra „24/7“ aktiv ist. EINE Stelle für alle Aufrufer.
 */
export const fairUseFor = (server: Pick<Server, 'kind' | 'alwaysOnSince'>, settings: Pick<SiteSettings, 'products'>): boolean => settings.products[server.kind].fairUse && !server.alwaysOnSince;

/** Ende des Laufzeit-Zyklus für diesen Server: mit „24/7“ gibt es keines */
export const cycleEndForServer = (server: Pick<Server, 'kind' | 'alwaysOnSince'>, start: Date, rules: Parameters<typeof cycleEndFor>[2] = cycleRules): Date => (server.alwaysOnSince ? NO_CYCLE_END : cycleEndFor(server.kind, start, rules));

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
  // Fairer Neustart (z. B. nach dem Ende des Extras „24/7“): Laufzeit vor diesem Zeitpunkt zählt nicht mit – weder
  // für die 24 Stunden am Stück noch für die Wochen-Offline-Zeit
  const reset = server.fairUseResetAt?.getTime() ?? 0;
  const counted = reset ? sessions.filter((s) => !s.endedAt || s.endedAt.getTime() > reset).map((s) => ({ startedAt: s.startedAt.getTime() < reset ? new Date(reset) : s.startedAt, endedAt: s.endedAt })) : sessions.map((s) => ({ startedAt: s.startedAt, endedAt: s.endedAt }));
  const computed = computeFairUse({
    now,
    sessions: counted,
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
    userVerified: identityConfirmed(user),
    userActive: user.status === 'active',
    now,
    rules: cycleRulesFor(server.kind, cycleRules),
  });
  const openSession = sessions.find((s) => !s.endedAt) ?? null;
  return { fairUse, cycle, startGate, reactivation, openSession };
}
