import type { FastifyRequest } from 'fastify';
import { isAdmin } from '../plugins/auth';
import { getSettings } from '../services/settings.service';
import { Errors, L } from './errors';

/** Sperrt Nutzer-Aktionen während einer Wartung (Admins sind ausgenommen). */
export async function assertNotMaintenance(request: FastifyRequest): Promise<void> {
  const s = await getSettings();
  if (!s.maintenance.enabled || isAdmin(request.user)) return;
  throw Errors.unavailable(
    L(
      'CraftingHosting.free wird gerade gewartet. Bitte versuche es später erneut.',
      'CraftingHosting.free is currently under maintenance. Please try again later.',
    ),
  );
}
