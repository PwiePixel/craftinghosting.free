import { resolve } from 'node:path';
import { env } from '../env';
import { PterodactylHttpClient } from './http-client';
import { PterodactylMockClient } from './mock-client';
import type { PterodactylGateway } from './types';

export * from './types';

let instance: PterodactylGateway | null = null;

export function pterodactyl(): PterodactylGateway {
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

/** Nur für Tests */
export function setPterodactylGateway(gateway: PterodactylGateway) {
  instance = gateway;
}
