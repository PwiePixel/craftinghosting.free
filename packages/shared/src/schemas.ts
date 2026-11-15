/**
 * Eingabe-Schemas – werden von der API zur Validierung und vom
 * Frontend für die Formular-Validierung verwendet.
 */
import { z } from 'zod';
import { freeHostingConfig, getServerType } from './config/freehosting.config';

// Meldungen sind Schlüssel („v.…“) – übersetzt wird mit issueMessage() aus i18n.ts (API & Frontend).
z.config({
  customError: (issue) => (issue.input === undefined || issue.input === '' ? 'v.required' : undefined),
});

const { limits } = freeHostingConfig;

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .max(254, 'v.email_too_long')
  .email('v.email_invalid');

/** Passwort für das Pterodactyl-Panel (wird nur an Pterodactyl übergeben, nie gespeichert). */
export const panelPasswordSchema = z
  .string()
  .min(10, 'v.password_min')
  .max(72, 'v.password_max')
  .refine((v) => /[A-Za-z]/.test(v) && /[0-9]/.test(v), 'v.password_mix');

/** Benutzername im Pterodactyl-Panel (Regeln von Pterodactyl: klein, a–z 0–9 . _ -). */
export const panelUsernameSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(3, 'v.username_min')
  .max(24, 'v.username_max')
  .regex(/^[a-z0-9]([a-z0-9._-]*[a-z0-9])?$/, 'v.username_chars');

export const serverNameSchema = z
  .string()
  .trim()
  .min(limits.serverNameMinLength, 'v.server_name_min')
  .max(limits.serverNameMaxLength, 'v.server_name_max')
  .regex(/^[\p{L}\p{N} _\-.!']+$/u, 'v.server_name_chars');

const serverConfigShape = {
  planId: z.string().min(1),
  serverType: z.string().min(1),
  version: z.string().min(1).max(32),
  name: serverNameSchema,
};

function refineServerConfig(val: { planId: string; serverType: string; version: string }, ctx: z.RefinementCtx) {
  // Pakete sind im Admin-Bereich frei definierbar – ob es das Paket gibt (und ob es zum Servertyp passt), prüft die API
  const type = getServerType(val.serverType);
  if (!type) {
    ctx.addIssue({ code: 'custom', path: ['serverType'], message: 'v.type_unknown' });
  } else if (!type.versions.includes(val.version)) {
    ctx.addIssue({ code: 'custom', path: ['version'], message: 'v.version_unavailable' });
  }
}

/** Server anfordern (ohne Konto): Konfiguration + E-Mail. Der Server wird nach der E-Mail-Bestätigung erstellt. */
export const startSchema = z
  .object({
    ...serverConfigShape,
    email: emailSchema,
    acceptTerms: z.literal(true, { message: 'v.accept_terms' }),
  })
  .superRefine(refineServerConfig);
export type StartInput = z.infer<typeof startSchema>;

/** Server erstellen (bereits angemeldet). */
export const createServerSchema = z
  .object({
    ...serverConfigShape,
    acceptTerms: z.literal(true, { message: 'v.accept_terms' }),
  })
  .superRefine(refineServerConfig);
export type CreateServerInput = z.infer<typeof createServerSchema>;

export const tokenSchema = z.object({ token: z.string().min(20).max(200) });

export const loginLinkSchema = z.object({ email: emailSchema });

export const panelSetupSchema = z.object({
  username: panelUsernameSchema,
  password: panelPasswordSchema,
});
export type PanelSetupInput = z.infer<typeof panelSetupSchema>;

export const deleteServerSchema = z.object({ confirmName: z.string().min(1).max(64) });

export const deleteAccountSchema = z.object({ confirmEmail: emailSchema });
