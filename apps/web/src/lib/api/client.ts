/**
 * API-Client für den Browser. Alle Aufrufe gehen an /api/v1 (gleiche Origin),
 * das Session-Cookie wird automatisch mitgeschickt. Keine Secrets im Frontend.
 */
export class ApiClientError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public fields?: Record<string, string>,
  ) {
    super(message);
  }
}

/** Sprache der Seite (html lang) – die API antwortet mit Fehlermeldungen in dieser Sprache. */
function pageLang(): 'de' | 'en' {
  return typeof document !== 'undefined' && document.documentElement.lang === 'de' ? 'de' : 'en';
}

export async function api<T>(path: string, init: { method?: 'GET' | 'POST'; body?: unknown; signal?: AbortSignal } = {}): Promise<T> {
  const method = init.method ?? (init.body !== undefined ? 'POST' : 'GET');
  let res: Response;
  try {
    res = await fetch(`/api/v1${path}`, {
      method,
      credentials: 'same-origin',
      cache: 'no-store',
      signal: init.signal,
      headers: {
        Accept: 'application/json',
        'X-CHF-Lang': pageLang(),
        ...(method !== 'GET' ? { 'Content-Type': 'application/json', 'X-CHF-Client': 'web' } : {}),
      },
      body: method !== 'GET' ? JSON.stringify(init.body ?? {}) : undefined,
    });
  } catch (err) {
    if ((err as Error).name === 'AbortError') throw err;
    throw new ApiClientError(
      0,
      'network_error',
      pageLang() === 'en'
        ? 'No connection to the server. Please check your internet connection.'
        : 'Keine Verbindung zum Server. Bitte prüfe deine Internetverbindung.',
    );
  }
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    throw new ApiClientError(
      res.status,
      data?.error?.code ?? 'error',
      data?.error?.message ?? (pageLang() === 'en' ? 'Something went wrong. Please try again.' : 'Es ist ein Fehler aufgetreten. Bitte versuche es erneut.'),
      data?.error?.fields,
    );
  }
  return data as T;
}
