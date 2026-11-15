/**
 * Logo aus dem Admin-Bereich: Upload, Auslieferung, Entfernen.
 * Die Datei liegt als Base64 in der (verschlüsselten) Datenbank – so ist sie in jedem Backup enthalten
 * und Haupt- und Beta-Instanz zeigen dasselbe Logo.
 */
import { eq } from 'drizzle-orm';
import { db } from '../db/client';
import { assets, type User } from '../db/schema';
import { Errors, L } from '../lib/errors';
import { audit } from './audit.service';
import { invalidatePublicSite } from './settings.service';

const KEY = 'logo';
export const LOGO_MAX_BYTES = 512 * 1024;
const TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml'] as const;

/** Erkennt das Format am Inhalt – der angegebene Typ allein reicht nicht */
function sniff(bytes: Buffer): (typeof TYPES)[number] | null {
  if (bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes.subarray(0, 4).toString('latin1') === 'RIFF' && bytes.subarray(8, 12).toString('latin1') === 'WEBP') return 'image/webp';
  const head = bytes.subarray(0, 2048).toString('utf8').trimStart().toLowerCase();
  if (head.startsWith('<svg') || (head.startsWith('<?xml') && head.includes('<svg')) || head.startsWith('<!doctype svg')) return 'image/svg+xml';
  return null;
}

/** SVG darf kein Skript enthalten (wird zwar nur als Bild eingebunden – sicher ist sicher) */
function unsafeSvg(bytes: Buffer): boolean {
  const text = bytes.toString('utf8').toLowerCase();
  return /<script|<foreignobject|<iframe|<embed|<object|\son[a-z]+\s*=|javascript:|<!entity/.test(text);
}

const invalid = (de: string, en: string) => Errors.badRequest('invalid_logo', L(de, en));

export async function saveLogo(admin: Pick<User, 'email'>, base64: string, ip?: string): Promise<void> {
  const clean = base64.replace(/^data:[^;,]+;base64,/, '').replace(/\s+/g, '');
  if (!/^[A-Za-z0-9+/]+=*$/.test(clean)) throw invalid('Die Datei konnte nicht gelesen werden.', 'The file could not be read.');
  const bytes = Buffer.from(clean, 'base64');
  if (bytes.length === 0) throw invalid('Die Datei ist leer.', 'The file is empty.');
  if (bytes.length > LOGO_MAX_BYTES) throw invalid('Das Logo ist zu groß (höchstens 512 KB).', 'The logo is too large (512 KB at most).');
  const mime = sniff(bytes);
  if (!mime) throw invalid('Bitte ein Bild als PNG, JPG, WebP oder SVG hochladen.', 'Please upload an image as PNG, JPG, WebP or SVG.');
  if (mime === 'image/svg+xml' && unsafeSvg(bytes)) {
    throw invalid('Dieses SVG enthält Skripte oder eingebettete Inhalte und wird nicht angenommen.', 'This SVG contains scripts or embedded content and is not accepted.');
  }
  const values = { mime, data: bytes.toString('base64'), size: bytes.length, updatedAt: new Date() };
  await db.insert(assets).values({ key: KEY, ...values }).onConflictDoUpdate({ target: assets.key, set: values });
  invalidatePublicSite();
  await audit({ actor: 'admin', action: 'branding.logo_uploaded', message: `Logo hochgeladen (${mime}, ${Math.round(bytes.length / 1024)} KB) (durch ${admin.email})`, ip });
}

export async function deleteLogo(admin: Pick<User, 'email'>, ip?: string): Promise<void> {
  await db.delete(assets).where(eq(assets.key, KEY));
  invalidatePublicSite();
  await audit({ actor: 'admin', action: 'branding.logo_removed', message: `Logo entfernt (durch ${admin.email})`, ip });
}

export async function getLogo(): Promise<{ mime: string; bytes: Buffer; updatedAt: Date } | null> {
  const [row] = await db.select().from(assets).where(eq(assets.key, KEY)).limit(1);
  return row ? { mime: row.mime, bytes: Buffer.from(row.data, 'base64'), updatedAt: row.updatedAt } : null;
}

/** Nur der Zeitstempel (für die Adresse mit Versionsangabe) */
export async function logoVersion(): Promise<number | null> {
  const [row] = await db.select({ updatedAt: assets.updatedAt }).from(assets).where(eq(assets.key, KEY)).limit(1);
  return row ? row.updatedAt.getTime() : null;
}
