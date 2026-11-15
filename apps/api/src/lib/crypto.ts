import { createCipheriv, createDecipheriv, createHash, hkdfSync, randomBytes, randomUUID, createHmac, timingSafeEqual } from 'node:crypto';
import { env } from '../env';

/** Zufälliges, URL-sicheres Token (256 Bit). */
export function generateToken(): string {
  return randomBytes(32).toString('base64url');
}

export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function uuid(): string {
  return randomUUID();
}

/* ------------------------------------------------------------ Signierte Links */

/**
 * Link-Token ohne Datenbankeintrag: `<wert>.<signatur>` (HMAC-SHA256, Schlüssel aus DATABASE_ENCRYPTION_KEY abgeleitet).
 * `purpose` trennt die Einsatzzwecke – ein Bestätigungslink taugt nicht als Abmeldelink.
 */
export function signToken(value: string, purpose: string): string {
  const mac = createHmac('sha256', getFieldKey()).update(`${purpose}:${value}`).digest('base64url').slice(0, 32);
  return `${value}.${mac}`;
}

/** Prüft ein mit signToken erzeugtes Token und gibt den Wert zurück (null = ungültig). */
export function verifySignedToken(token: string, purpose: string): string | null {
  const dot = token.lastIndexOf('.');
  if (dot <= 0) return null;
  const value = token.slice(0, dot);
  const expected = Buffer.from(signToken(value, purpose));
  const given = Buffer.from(token);
  return expected.length === given.length && timingSafeEqual(expected, given) ? value : null;
}

/* ------------------------------------------------------ Feldverschlüsselung */

const FIELD_PREFIX = 'v1:';
const IV_LENGTH = 12;
const TAG_LENGTH = 16;

let fieldKey: Buffer | null = null;
/** AES-256-Schlüssel, per HKDF-SHA256 aus DATABASE_ENCRYPTION_KEY abgeleitet */
function getFieldKey(): Buffer {
  fieldKey ??= Buffer.from(hkdfSync('sha256', Buffer.from(env.DATABASE_ENCRYPTION_KEY, 'utf8'), Buffer.alloc(0), Buffer.from('chf-field-v1', 'utf8'), 32));
  return fieldKey;
}

/**
 * Verschlüsselt einen Feldwert (IP-Adresse, User-Agent …) mit AES-256-GCM.
 * Format: `v1:<base64url(iv | tag | ciphertext)>` · null/undefined/leer → null.
 */
export function encryptField(plain: string | null | undefined): string | null {
  if (plain === null || plain === undefined || plain === '') return null;
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv('aes-256-gcm', getFieldKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return FIELD_PREFIX + Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString('base64url');
}

/**
 * Entschlüsselt einen mit encryptField gespeicherten Wert.
 * Werte ohne `v1:`-Präfix (Altbestand im Klartext) kommen unverändert zurück; bei falschem Schlüssel/Manipulation null.
 */
export function decryptField(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  if (!value.startsWith(FIELD_PREFIX)) return value;
  try {
    const raw = Buffer.from(value.slice(FIELD_PREFIX.length), 'base64url');
    if (raw.length < IV_LENGTH + TAG_LENGTH) return null;
    const decipher = createDecipheriv('aes-256-gcm', getFieldKey(), raw.subarray(0, IV_LENGTH));
    decipher.setAuthTag(raw.subarray(IV_LENGTH, IV_LENGTH + TAG_LENGTH));
    return Buffer.concat([decipher.update(raw.subarray(IV_LENGTH + TAG_LENGTH)), decipher.final()]).toString('utf8');
  } catch {
    return null;
  }
}
