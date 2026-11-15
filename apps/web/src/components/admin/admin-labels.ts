/**
 * Bezeichnungen und Formatierungen für den Admin-Bereich – ohne 'use client',
 * damit sie auch in Server Components (admin/page.tsx) nutzbar sind.
 */
import type { ProductKind } from '@chfree/shared';

export const PRODUCT_LABEL: Record<ProductKind, string> = { minecraft: 'Minecraft-Server', discord: 'Discord-Bots' };
/** Kurzform für Listen und Badges */
export const PRODUCT_SHORT: Record<ProductKind, string> = { minecraft: 'Minecraft', discord: 'Discord-Bot' };

/** 4096 → „4 GB“, 512 → „512 MB“ */
export function formatMb(mb: number): string {
  if (!Number.isFinite(mb)) return '–';
  return mb >= 1024 ? `${(mb / 1024).toLocaleString('de-DE', { maximumFractionDigits: 2 })} GB` : `${mb.toLocaleString('de-DE')} MB`;
}

/** 150 → „1,5 Threads“ */
export function formatThreads(cpuPercent: number): string {
  const threads = cpuPercent / 100;
  return `${threads.toLocaleString('de-DE', { maximumFractionDigits: 2 })} ${threads === 1 ? 'Thread' : 'Threads'}`;
}
