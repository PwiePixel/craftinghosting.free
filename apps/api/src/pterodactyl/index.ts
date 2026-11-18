import { resolve } from 'node:path';
import { env } from '../env';
import { takePanelCall } from './budget';
import { PterodactylHttpClient } from './http-client';
import { PterodactylMockClient } from './mock-client';
import type { PterodactylGateway } from './types';

export * from './types';

let instance: PterodactylGateway | null = null;

function gateway(): PterodactylGateway {
  if (!instance) {
    instance =
      env.PTERODACTYL_MODE === 'live'
        ? new PterodactylHttpClient({
            baseUrl: env.PTERODACTYL_URL!,
            appKey: env.PTERODACTYL_APP_KEY!,
            clientKey: env.PTERODACTYL_CLIENT_KEY!,
            timeoutMs: env.PTERODACTYL_TIMEOUT_MS,
          })
        : new PterodactylMockClient(resolve(process.cwd(), env.PTERODACTYL_MOCK_STATE_FILE));
  }
  return instance;
}

/**
 * Zugang zum Panel. Jeder Aufruf läuft zuerst durch das Kontingent für Partner-Anfragen (siehe budget.ts);
 * Aufrufe von Jobs und der Website zählen dort nicht.
 */
const guarded = new Proxy({} as PterodactylGateway, {
  get(_target, prop) {
    const target = gateway() as unknown as Record<string | symbol, unknown>;
    const value = target[prop];
    if (typeof value !== 'function') return value;
    return (...args: unknown[]) => {
      try {
        takePanelCall();
      } catch (err) {
        return Promise.reject(err);
      }
      return (value as (...a: unknown[]) => unknown).apply(target, args);
    };
  },
});

export function pterodactyl(): PterodactylGateway {
  return guarded;
}

/** Nur für Tests */
export function setPterodactylGateway(gateway: PterodactylGateway) {
  instance = gateway;
}
