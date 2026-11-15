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

/** Sechsstelliger Code aus der E-Mail bzw. aus der Authenticator-App (Leerzeichen werden ignoriert) */
export const sixDigitCodeSchema = z
  .string()
  .transform((v) => v.replace(/\s/g, ''))
  .pipe(z.string().regex(/^\d{6}$/, 'v.code_format'));

/** Code aus der E-Mail einlösen */
export const verifyCodeSchema = z.object({ email: emailSchema, code: sixDigitCodeSchema });

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
  // Auch die Versionslisten sind im Admin-Bereich pflegbar – ob die Version wählbar ist, prüft die API
  if (!getServerType(val.serverType)) {
    ctx.addIssue({ code: 'custom', path: ['serverType'], message: 'v.type_unknown' });
  }
}

/** Server anfordern (ohne Konto): Konfiguration + E-Mail. Der Server wird nach der E-Mail-Bestätigung erstellt. */
export const startSchema = z
  .object({
    ...serverConfigShape,
    email: emailSchema,
    acceptTerms: z.literal(true, { message: 'v.accept_terms' }),
    /** Newsletter abonnieren (freiwillig) – wird mit der E-Mail-Bestätigung aktiv */
    newsletter: z.boolean().optional(),
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

export const newsletterSubscribeSchema = z.object({ email: emailSchema });
export const newsletterTokenSchema = z.object({ token: z.string().min(20).max(200) });

export const deleteServerSchema = z.object({ confirmName: z.string().min(1).max(64) });

export const deleteAccountSchema = z.object({ confirmEmail: emailSchema });

/** Eigenes Passwort als zweite Stufe der Anmeldung (dieselben Regeln wie beim Panel-Passwort) */
export const accountPasswordSchema = z.object({ password: panelPasswordSchema });

/** Zweite Stufe: Passwort, Code aus der App oder ein Wiederherstellungscode */
export const secondFactorSchema = z
  .object({
    password: z.string().max(200).optional(),
    code: sixDigitCodeSchema.optional(),
    recovery: z.string().trim().max(40).optional(),
  })
  .refine((v) => !!(v.password || v.code || v.recovery), 'v.required');
