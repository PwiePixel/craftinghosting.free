import { createHash, randomBytes, randomUUID } from 'node:crypto';

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
