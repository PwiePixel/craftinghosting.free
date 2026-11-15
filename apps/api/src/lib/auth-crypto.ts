/**
 * Bausteine für die Anmeldung: sechsstellige Codes, Passwort-Hashes und Authenticator-App (TOTP).
 */
import { createHmac, randomBytes, randomInt, scryptSync, timingSafeEqual } from 'node:crypto';
import { sha256, signToken } from './crypto';

/* ------------------------------------------------------------ Anmeldecodes */

/** Sechsstelliger Zahlencode für die Anmeldung per E-Mail */
export function generateCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, '0');
}

/**
 * Hash eines kurzen Codes zum Speichern. Mit Schlüssel (HMAC) und an den Zweck gebunden –
 * sechs Ziffern ließen sich aus einem einfachen Hash sofort zurückrechnen.
 */
export function hashCode(code: string, purpose: string): string {
  return sha256(signToken(code, `code:${purpose}`));
}

/* ------------------------------------------------------------ Passwörter */

const SCRYPT = { N: 32_768, r: 8, p: 1, maxmem: 128 * 1024 * 1024 } as const;

/** Passwort-Hash mit scrypt: `scrypt$<N>$<salt>$<hash>` – das Passwort selbst wird nie gespeichert */
export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password.normalize('NFKC'), salt, 32, SCRYPT);
  return `scrypt$${SCRYPT.N}$${salt.toString('base64url')}$${hash.toString('base64url')}`;
}

export function verifyPassword(password: string, stored: string | null | undefined): boolean {
  const [scheme, n, salt, hash] = (stored ?? '').split('$');
  if (scheme !== 'scrypt' || !n || !salt || !hash) return false;
  try {
    const expected = Buffer.from(hash, 'base64url');
    const actual = scryptSync(password.normalize('NFKC'), Buffer.from(salt, 'base64url'), expected.length, { ...SCRYPT, N: Number(n) });
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

/* ------------------------------------------------------------ Authenticator-App (TOTP, RFC 6238) */

const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Encode(data: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of data) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(text: string): Buffer {
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const char of text.toUpperCase().replace(/[^A-Z2-7]/g, '')) {
    value = (value << 5) | BASE32.indexOf(char);
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** Neuer geheimer Schlüssel für eine Authenticator-App (160 Bit, Base32) */
export function generateTotpSecret(): string {
  return base32Encode(randomBytes(20));
}

export const TOTP_STEP_SECONDS = 30;

/** Sechsstelliger Code für einen Zeitschritt (HMAC-SHA1 – so erwarten ihn alle Authenticator-Apps) */
export function totpCode(secret: string, step: number): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const mac = createHmac('sha1', base32Decode(secret)).update(counter).digest();
  const offset = mac[mac.length - 1]! & 15;
  const number = ((mac[offset]! & 127) << 24) | (mac[offset + 1]! << 16) | (mac[offset + 2]! << 8) | mac[offset + 3]!;
  return String(number % 1_000_000).padStart(6, '0');
}

/**
 * Prüft einen Code aus der App. Erlaubt einen Zeitschritt Abweichung (Uhr des Handys) und liefert den
 * Zeitschritt zurück, damit derselbe Code nicht zweimal verwendet werden kann. null = falsch.
 */
export function verifyTotp(secret: string, code: string, lastStep: number | null, now = Date.now()): number | null {
  const clean = code.replace(/\s/g, '');
  if (!/^\d{6}$/.test(clean)) return null;
  const current = Math.floor(now / 1000 / TOTP_STEP_SECONDS);
  for (const step of [current, current - 1, current + 1]) {
    if (lastStep !== null && step <= lastStep) continue;
    if (timingSafeEqual(Buffer.from(totpCode(secret, step)), Buffer.from(clean))) return step;
  }
  return null;
}

/** Adresse, die eine Authenticator-App direkt öffnen kann (steckt auch im QR-Code) */
export function totpUri(secret: string, account: string, issuer: string): string {
  const label = encodeURIComponent(`${issuer}:${account}`);
  return `otpauth://totp/${label}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=${TOTP_STEP_SECONDS}`;
}

/** Wiederherstellungscodes: acht Stück im Format XXXX-XXXX (ohne verwechselbare Zeichen) */
export function generateRecoveryCodes(): string[] {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const part = () => Array.from({ length: 4 }, () => alphabet[randomInt(0, alphabet.length)]).join('');
  return Array.from({ length: 8 }, () => `${part()}-${part()}`);
}

export const normalizeRecoveryCode = (code: string) => code.toUpperCase().replace(/[^A-Z0-9]/g, '');
