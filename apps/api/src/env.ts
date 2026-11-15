/**
 * Umgebungsvariablen – werden beim Start validiert.
 * Sensible Werte (DB-Schlüssel, Pterodactyl-Keys, SMTP) kommen ausschließlich
 * aus der Umgebung und werden niemals an das Frontend ausgeliefert.
 */
import { existsSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';
import { config as loadDotenv } from 'dotenv';
import { z } from 'zod';
import { freeHostingConfig } from '@chfree/shared';

/** Ordner der gefundenen .env (Projektwurzel) – Basis für relative Pfade wie DATABASE_PATH */
let envDir = process.cwd();
for (const candidate of [resolve(process.cwd(), '.env'), resolve(process.cwd(), '../../.env')]) {
  if (existsSync(candidate)) {
    loadDotenv({ path: candidate, quiet: true });
    envDir = dirname(candidate);
    break;
  }
}

/** Nur für die Entwicklung – in Produktion ist DATABASE_ENCRYPTION_KEY Pflicht */
const DEV_DATABASE_ENCRYPTION_KEY = 'chfree-dev-only-database-encryption-key-0000';

const bool = (def: boolean) =>
  z
    .string()
    .optional()
    .transform((v) => (v === undefined || v === '' ? def : ['1', 'true', 'yes', 'on'].includes(v.toLowerCase())));

const csv = z
  .string()
  .optional()
  .transform((v) =>
    (v ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  );

const schema = z
  .object({
    NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

    API_HOST: z.string().default('0.0.0.0'),
    API_PORT: z.coerce.number().int().default(4000),
    TRUST_PROXY: bool(true),

    /** Öffentliche URL der Website (für Links in E-Mails, Origin-Prüfung) */
    APP_URL: z.string().url().default('http://localhost:3000'),
    /** Zusätzliche erlaubte Origins (kommagetrennt) */
    ALLOWED_ORIGINS: csv,
    /** Interne URL der Website für den Status-Check */
    WEB_INTERNAL_URL: z.string().url().optional(),

    /** Pfad der verschlüsselten SQLite-Datei (relativ = ab dem Ordner der .env bzw. dem Arbeitsverzeichnis) */
    DATABASE_PATH: z
      .string()
      .optional()
      .transform((v) => {
        const p = v?.trim() || './data/chfree.db';
        return isAbsolute(p) ? p : resolve(envDir, p);
      }),
    /** Schlüssel der Datenbank-Verschlüsselung (openssl rand -hex 32) – ohne ihn lässt sich die Datei nicht öffnen */
    DATABASE_ENCRYPTION_KEY: z
      .string()
      .optional()
      .transform((v) => v?.trim() ?? ''),

    SESSION_COOKIE_NAME: z.string().default('chf_session'),
    /** Abmeldung nach so vielen Minuten ohne Aktivität */
    SESSION_IDLE_MINUTES: z.coerce.number().int().min(5).max(1440).default(30),
    /** Spätestens nach so vielen Stunden muss man sich neu anmelden – egal wie aktiv */
    SESSION_MAX_HOURS: z.coerce.number().int().min(1).max(720).default(12),
    /** false = Session-Cookie endet mit dem Schließen des Browsers (Standard), true = bleibt bis zum Ablauf gespeichert */
    SESSION_PERSISTENT: bool(false),
    COOKIE_DOMAIN: z.string().optional(),
    COOKIE_SECURE: z.enum(['auto', 'true', 'false']).default('auto'),

    PTERODACTYL_MODE: z.enum(['live', 'mock']).default('mock'),
    PTERODACTYL_URL: z.string().url().optional(),
    /** Öffentliche Panel-URL für Links (Standard: PTERODACTYL_URL) */
    PTERODACTYL_PUBLIC_URL: z.string().url().optional(),
    PTERODACTYL_APP_KEY: z.string().optional(),
    PTERODACTYL_CLIENT_KEY: z.string().optional(),
    PTERODACTYL_LOCATION_IDS: csv,
    /** Optionale Locations je Hardware-Stufe (Warteliste): EPYC zuerst, danach Xeon */
    PTERODACTYL_LOCATION_IDS_EPYC: csv,
    PTERODACTYL_LOCATION_IDS_XEON: csv,
    PTERODACTYL_TIMEOUT_MS: z.coerce.number().int().default(10000),
    PTERODACTYL_MOCK_STATE_FILE: z.string().default('.pterodactyl-mock.json'),

    SMTP_HOST: z.string().optional(),
    SMTP_PORT: z.coerce.number().int().default(587),
    /** auto = SSL bei Port 465, sonst STARTTLS (587/25) */
    SMTP_SECURE: z
      .string()
      .optional()
      .transform((v) => (v ?? 'auto').trim().toLowerCase()),
    SMTP_USER: z.string().optional(),
    SMTP_PASS: z.string().optional(),
    /** Leer = SMTP_USER als Absender (mailcow & Co. lehnen fremde Absender ab) */
    MAIL_FROM: z.string().optional(),

    /** E-Mail-Adressen mit Zugriff auf den Admin-Bereich (/admin), kommagetrennt */
    ADMIN_EMAILS: csv,

    /** Jobs im API-Prozess ausführen (Entwicklung). In Produktion: eigener Worker. */
    RUN_JOBS_IN_API: bool(false),

    STATUS_PROVIDER: z.enum(['internal', 'static']).default('internal'),

    /** Adresse der Discord-API. Nur für Tests ändern – Token, Secret und IDs stehen im Admin-Bereich (Discord). */
    DISCORD_API_URL: z.string().url().default('https://discord.com/api/v10'),

    /**
     * Beta-Programm.
     *  BETA_MODE=true  → diese Installation ist die Beta-Instanz: gleiche Datenbank wie die Hauptseite, aber nur
     *                    freigeschaltete Nutzer (Admin → Nutzer → Beta-Zugang) kommen hinein; keine Anmeldung, keine Jobs.
     *  BETA_URL        → auf der HAUPTSEITE: Adresse der Beta-Instanz (z. B. https://beta.craftinghosting.free)
     *  MAIN_URL        → auf der BETA-Instanz: Adresse der Hauptseite
     */
    BETA_MODE: bool(false),
    BETA_URL: z.string().url().optional().or(z.literal('')),
    MAIN_URL: z.string().url().optional().or(z.literal('')),
  })
  .superRefine((env, ctx) => {
    if (env.NODE_ENV === 'production' && env.DATABASE_ENCRYPTION_KEY.length < 32) {
      ctx.addIssue({
        code: 'custom',
        path: ['DATABASE_ENCRYPTION_KEY'],
        message: 'DATABASE_ENCRYPTION_KEY fehlt oder ist zu kurz (mindestens 32 Zeichen, z. B. openssl rand -hex 32)',
      });
    }
    if (env.PTERODACTYL_MODE === 'live') {
      for (const key of ['PTERODACTYL_URL', 'PTERODACTYL_APP_KEY', 'PTERODACTYL_CLIENT_KEY'] as const) {
        if (!env[key]) ctx.addIssue({ code: 'custom', path: [key], message: `${key} ist im Live-Modus erforderlich` });
      }
      // PTERODACTYL_LOCATION_IDS ist optional: Nodes werden im Admin-Bereich zugewiesen (Admin → Pterodactyl),
      // ohne Zuweisung nutzt die Anlage alle Locations des Panels.
    }
  });

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  console.error('[config] Ungültige Umgebungsvariablen:');
  for (const issue of parsed.error.issues) console.error(`   ${issue.path.join('.')}: ${issue.message}`);
  process.exit(1);
}

export const env = {
  ...parsed.data,
  DATABASE_ENCRYPTION_KEY: parsed.data.DATABASE_ENCRYPTION_KEY || DEV_DATABASE_ENCRYPTION_KEY,
};
export const isProd = env.NODE_ENV === 'production';
export const cookieSecure = env.COOKIE_SECURE === 'auto' ? env.APP_URL.startsWith('https://') : env.COOKIE_SECURE === 'true';
export const allowedOrigins = new Set([new URL(env.APP_URL).origin, ...env.ALLOWED_ORIGINS.map((o) => new URL(o).origin)]);
export const panelPublicUrl = (env.PTERODACTYL_PUBLIC_URL ?? env.PTERODACTYL_URL ?? freeHostingConfig.brand.panelUrl).replace(/\/$/, '');

/** SSL direkt beim Verbinden (Port 465) oder STARTTLS (Port 587/25) */
export const smtpSecure = ['1', 'true', 'yes', 'on'].includes(env.SMTP_SECURE)
  ? true
  : ['0', 'false', 'no', 'off'].includes(env.SMTP_SECURE)
    ? false
    : env.SMTP_PORT === 465;

/** Absender: MAIL_FROM, sonst das SMTP-Postfach selbst */
export const mailFrom =
  env.MAIL_FROM?.trim() ||
  (env.SMTP_USER?.includes('@') ? `CraftingHosting.free <${env.SMTP_USER}>` : 'CraftingHosting.free <no-reply@craftinghosting.free>');

/** Admin-Adressen aus der .env (zusätzlich zu Nutzern mit role = admin) */
export const adminEmails = new Set(env.ADMIN_EMAILS.map((e) => e.toLowerCase()));
