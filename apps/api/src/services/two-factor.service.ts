/**
 * Zweite Stufe bei der Anmeldung (freiwillig, unter „Meine Server“ → Sicherheit):
 *  – Passwort: ein eigenes Passwort zusätzlich zum Code aus der E-Mail (gespeichert nur als scrypt-Hash)
 *  – Authenticator-App: sechsstelliger Code aus einer App wie Google Authenticator, Aegis oder 1Password
 * Für den Notfall gibt es Wiederherstellungscodes; das Team kann die zweite Stufe im Admin-Bereich zurücksetzen.
 */
import { eq, sql } from 'drizzle-orm';
import QRCode from 'qrcode';
import { freeHostingConfig, type SecurityDTO, type TotpSetupDTO } from '@chfree/shared';
import { db } from '../db/client';
import { users, type User } from '../db/schema';
import { generateRecoveryCodes, generateTotpSecret, hashCode, hashPassword, normalizeRecoveryCode, totpUri, verifyPassword, verifyTotp } from '../lib/auth-crypto';
import { decryptField, encryptField } from '../lib/crypto';
import { Errors, L } from '../lib/errors';
import { audit } from './audit.service';

const MAX_FAILS = 5;
const LOCK_MS = 15 * 60_000;

export interface SecondFactorInput {
  password?: string;
  code?: string;
  recovery?: string;
}

const recoveryHash = (userId: string, code: string) => hashCode(normalizeRecoveryCode(code), `recovery:${userId}`);

export function toSecurityDTO(user: User): SecurityDTO {
  return { method: user.twoFactorMethod ?? null, recoveryCodesLeft: user.twoFactorMethod ? (user.twoFactorRecovery?.length ?? 0) : 0 };
}

/**
 * Prüft die zweite Stufe. Nach fünf Fehlversuchen ist sie 15 Minuten gesperrt – so lässt sich weder das
 * Passwort noch der sechsstellige App-Code durchprobieren.
 */
export async function checkSecondFactor(user: User, input: SecondFactorInput): Promise<void> {
  const now = new Date();
  if (user.twoFactorLockedUntil && user.twoFactorLockedUntil > now) {
    throw Errors.badRequest('two_factor_locked', L('Zu viele Fehlversuche. Bitte warte 15 Minuten und versuche es dann erneut.', 'Too many failed attempts. Please wait 15 minutes and try again.'));
  }
  let ok = false;
  const patch: Partial<typeof users.$inferInsert> = {};
  if (input.recovery) {
    const hash = recoveryHash(user.id, input.recovery);
    const left = (user.twoFactorRecovery ?? []).filter((h) => h !== hash);
    // Jeder Wiederherstellungscode gilt genau einmal
    if (left.length !== (user.twoFactorRecovery ?? []).length) {
      ok = true;
      patch.twoFactorRecovery = left;
    }
  } else if (user.twoFactorMethod === 'password') {
    ok = verifyPassword(input.password ?? '', user.passwordHash);
  } else if (user.twoFactorMethod === 'totp') {
    const secret = decryptField(user.totpSecret);
    const step = secret ? verifyTotp(secret, input.code ?? '', user.totpLastStep ?? null) : null;
    if (step !== null) {
      ok = true;
      patch.totpLastStep = step;
    }
  }
  if (!ok) {
    const fails = user.twoFactorFails + 1;
    await db
      .update(users)
      .set(fails >= MAX_FAILS ? { twoFactorFails: 0, twoFactorLockedUntil: new Date(now.getTime() + LOCK_MS) } : { twoFactorFails: sql`${users.twoFactorFails} + 1` })
      .where(eq(users.id, user.id));
    const wrong =
      input.recovery !== undefined
        ? L('Dieser Wiederherstellungscode ist falsch oder wurde schon verwendet.', 'This recovery code is wrong or has already been used.')
        : user.twoFactorMethod === 'password'
          ? L('Das Passwort ist falsch.', 'The password is wrong.')
          : L('Der Code aus der App ist falsch oder abgelaufen.', 'The code from the app is wrong or has expired.');
    throw Errors.badRequest('two_factor_invalid', wrong, { [input.recovery !== undefined ? 'recovery' : user.twoFactorMethod === 'password' ? 'password' : 'code']: wrong });
  }
  await db.update(users).set({ ...patch, twoFactorFails: 0, twoFactorLockedUntil: null }).where(eq(users.id, user.id));
}

/** Neue Wiederherstellungscodes erzeugen – im Klartext nur dieses eine Mal sichtbar */
function newRecovery(userId: string): { plain: string[]; hashed: string[] } {
  const plain = generateRecoveryCodes();
  return { plain, hashed: plain.map((c) => recoveryHash(userId, c)) };
}

const alreadyOn = () => Errors.conflict('two_factor_active', L('Die zweite Stufe ist bereits eingeschaltet. Schalte sie zuerst aus, um die Methode zu wechseln.', 'The second step is already enabled. Turn it off first to change the method.'));

/** Passwort als zweite Stufe einschalten */
export async function enablePasswordFactor(user: User, password: string, ip?: string): Promise<string[]> {
  if (user.twoFactorMethod) throw alreadyOn();
  const recovery = newRecovery(user.id);
  await db
    .update(users)
    .set({ twoFactorMethod: 'password', passwordHash: hashPassword(password), totpSecret: null, totpPending: null, totpLastStep: null, twoFactorRecovery: recovery.hashed, twoFactorFails: 0, twoFactorLockedUntil: null })
    .where(eq(users.id, user.id));
  await audit({ userId: user.id, actor: 'user', action: 'auth.two_factor_enabled', message: 'Zweite Stufe eingeschaltet: Passwort', ip });
  return recovery.plain;
}

/** Authenticator-App einrichten, Schritt 1: Schlüssel erzeugen (noch nicht aktiv) */
export async function setupTotp(user: User): Promise<TotpSetupDTO> {
  if (user.twoFactorMethod) throw alreadyOn();
  const secret = generateTotpSecret();
  await db.update(users).set({ totpPending: encryptField(secret) }).where(eq(users.id, user.id));
  const uri = totpUri(secret, user.email, freeHostingConfig.brand.productName);
  const svg = await QRCode.toString(uri, { type: 'svg', margin: 1, errorCorrectionLevel: 'M', color: { dark: '#000000', light: '#ffffff' } });
  return { secret, uri, qr: `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}` };
}

/** Schritt 2: Mit einem Code aus der App bestätigen – erst dann gilt die zweite Stufe */
export async function confirmTotp(user: User, code: string, ip?: string): Promise<string[]> {
  if (user.twoFactorMethod) throw alreadyOn();
  const secret = decryptField(user.totpPending);
  const step = secret ? verifyTotp(secret, code, null) : null;
  if (!secret || step === null) {
    const msg = L('Der Code ist falsch oder abgelaufen. Bitte gib den aktuellen Code aus der App ein.', 'The code is wrong or has expired. Please enter the current code from the app.');
    throw Errors.badRequest('two_factor_invalid', msg, { code: msg });
  }
  const recovery = newRecovery(user.id);
  await db
    .update(users)
    .set({ twoFactorMethod: 'totp', totpSecret: encryptField(secret), totpPending: null, totpLastStep: step, passwordHash: null, twoFactorRecovery: recovery.hashed, twoFactorFails: 0, twoFactorLockedUntil: null })
    .where(eq(users.id, user.id));
  await audit({ userId: user.id, actor: 'user', action: 'auth.two_factor_enabled', message: 'Zweite Stufe eingeschaltet: Authenticator-App', ip });
  return recovery.plain;
}

const cleared = { twoFactorMethod: null, passwordHash: null, totpSecret: null, totpPending: null, totpLastStep: null, twoFactorRecovery: null, twoFactorFails: 0, twoFactorLockedUntil: null } as const;

/** Zweite Stufe ausschalten – nur mit dem aktuellen Passwort bzw. Code (oder einem Wiederherstellungscode) */
export async function disableSecondFactor(user: User, input: SecondFactorInput, ip?: string): Promise<void> {
  if (!user.twoFactorMethod) return;
  await checkSecondFactor(user, input);
  await db.update(users).set(cleared).where(eq(users.id, user.id));
  await audit({ userId: user.id, actor: 'user', action: 'auth.two_factor_disabled', message: 'Zweite Stufe ausgeschaltet', ip });
}

/** Admin: zweite Stufe zurücksetzen (z. B. Handy verloren, Passwort vergessen) */
export async function resetSecondFactor(userId: string, admin: Pick<User, 'email'>, ip?: string): Promise<void> {
  await db.update(users).set(cleared).where(eq(users.id, userId));
  await audit({ userId, actor: 'admin', action: 'admin.two_factor_reset', message: `Zweite Stufe der Anmeldung zurückgesetzt (durch ${admin.email})`, ip });
}
