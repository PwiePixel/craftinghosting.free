/**
 * CSV-Exporte für den Admin-Bereich (Nutzer, Server, Newsletter-Abonnenten).
 * Mit BOM und Semikolon – öffnet sich in Excel/LibreOffice ohne Import-Dialog.
 */
import { desc, eq, ne } from 'drizzle-orm';
import { hasCycleEnd } from '@chfree/shared';
import { db } from '../db/client';
import { newsletterSubscribers, servers, users } from '../db/schema';

export const EXPORTS = ['users', 'servers', 'subscribers'] as const;
export type ExportType = (typeof EXPORTS)[number];

/** Zelle maskieren; führende =, +, -, @ entschärfen (verhindert Formeln in Tabellenprogrammen) */
function cell(value: unknown): string {
  let s = value === null || value === undefined ? '' : value instanceof Date ? value.toISOString() : String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

const toCsv = (head: string[], rows: unknown[][]) => `﻿${[head, ...rows].map((r) => r.map(cell).join(';')).join('\r\n')}\r\n`;

export async function exportCsv(type: ExportType): Promise<string> {
  if (type === 'users') {
    const rows = await db.select().from(users).orderBy(desc(users.createdAt));
    return toCsv(
      ['E-Mail', 'Rolle', 'Status', 'Sprache', 'E-Mail bestätigt', 'Panel-Benutzer', 'Registriert', 'Letzte Anmeldung'],
      rows.map((u) => [u.email, u.role, u.status, u.locale, u.emailVerifiedAt, u.pteroUsername, u.createdAt, u.lastLoginAt]),
    );
  }
  if (type === 'servers') {
    const rows = await db
      .select({ s: servers, email: users.email })
      .from(servers)
      .innerJoin(users, eq(users.id, servers.userId))
      .where(ne(servers.status, 'deleted'))
      .orderBy(desc(servers.createdAt));
    return toCsv(
      ['Name', 'Produkt', 'Paket', 'Typ', 'Version', 'Status', 'Besitzer', 'RAM (MB)', 'CPU (%)', 'Speicher (MB)', 'Adresse', 'Zyklus', 'Läuft bis', 'Panel-ID', 'Erstellt'],
      rows.map(({ s, email }) => [s.name, s.kind, s.planId, s.serverType, s.version, s.status, email, s.memoryMb, s.cpuPercent, s.diskMb, s.address, s.cycleNumber, hasCycleEnd(s.cycleEndsAt) ? s.cycleEndsAt : '', s.pteroServerId, s.createdAt]),
    );
  }
  const rows = await db.select().from(newsletterSubscribers).orderBy(desc(newsletterSubscribers.createdAt));
  return toCsv(
    ['E-Mail', 'Status', 'Sprache', 'Quelle', 'Angemeldet', 'Bestätigt', 'Abgemeldet'],
    rows.map((r) => [r.email, r.status, r.locale, r.source, r.createdAt, r.confirmedAt, r.unsubscribedAt]),
  );
}
