/**
 * API-Zugriff aus Server Components. Leitet das Session-Cookie des Besuchers
 * an die interne API weiter. Nur serverseitig verwenden.
 */
import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { localePath, type Locale, type RouteKey, type UserDTO } from '@chfree/shared';

const API = (process.env.API_INTERNAL_URL ?? 'http://localhost:4000').replace(/\/$/, '');

export type ApiResult<T> = { ok: true; data: T } | { ok: false; status: number; message?: string };

export async function apiServer<T>(path: string, lang: Locale = 'de'): Promise<ApiResult<T>> {
  const cookieStore = await cookies();
  const h = await headers();
  try {
    const res = await fetch(`${API}/api/v1${path}`, {
      headers: {
        cookie: cookieStore.toString(),
        accept: 'application/json',
        'x-chf-lang': lang,
        ...(h.get('x-forwarded-for') ? { 'x-forwarded-for': h.get('x-forwarded-for')! } : {}),
      },
      cache: 'no-store',
      signal: AbortSignal.timeout(8000),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) return { ok: false, status: res.status, message: data?.error?.message };
    return { ok: true, data: data as T };
  } catch {
    return { ok: false, status: 503, message: 'API nicht erreichbar' };
  }
}

/** Öffentliche Daten ohne Cookie (z. B. Status) – cachebar. */
export async function apiPublic<T>(path: string, revalidate = 30): Promise<ApiResult<T>> {
  try {
    const res = await fetch(`${API}/api/v1${path}`, { next: { revalidate }, signal: AbortSignal.timeout(8000) });
    const data = await res.json().catch(() => null);
    if (!res.ok) return { ok: false, status: res.status };
    return { ok: true, data: data as T };
  } catch {
    return { ok: false, status: 503 };
  }
}

export async function getCurrentUser(): Promise<{ user: UserDTO; panelUrl: string } | null> {
  const res = await apiServer<{ user: UserDTO; panelUrl: string }>('/auth/me');
  return res.ok ? res.data : null;
}

/** Erzwingt eine gültige Session – sonst Weiterleitung zum Login (in der Sprache der Seite). */
export async function requireUser(lang: Locale, next: RouteKey, nextPath?: string): Promise<{ user: UserDTO; panelUrl: string }> {
  const res = await apiServer<{ user: UserDTO; panelUrl: string }>('/auth/me', lang);
  if (res.ok) return res.data;
  if (res.status === 401 || res.status === 403) redirect(localePath(lang, 'login', { next: nextPath ?? localePath(lang, next) }));
  throw new Error(
    lang === 'en'
      ? 'The API is currently unavailable. Please try again in a moment.'
      : 'Die API ist aktuell nicht erreichbar. Bitte versuche es in einem Moment erneut.',
  );
}
