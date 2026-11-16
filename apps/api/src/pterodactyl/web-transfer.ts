/**
 * Umzug eines Servers auf eine andere Node über den Admin-Bereich des Panels.
 *
 * Das klassische Pterodactyl bietet den Umzug nicht über seine Schnittstelle (Application API) an – nur über den
 * Admin-Bereich im Browser. Damit er trotzdem automatisch läuft, meldet sich das System hier wie ein Browser als
 * Panel-Admin an (Zugang: Admin → Pterodactyl → „Automatischer Umzug“) und schickt dasselbe Formular ab, das
 * auch der Knopf „Transfer Server“ im Panel abschickt.
 *
 * Voraussetzungen im Panel: Das Konto ist Admin, und reCAPTCHA ist für die Anmeldung ausgeschaltet
 * (Panel → Settings → Advanced). Ist am Konto die Zwei-Faktor-Anmeldung aktiv, wird der geheime Schlüssel
 * (TOTP) gebraucht.
 */
import { env } from '../env';
import { TOTP_STEP_SECONDS, totpCode } from '../lib/auth-crypto';

export interface PanelWebLogin {
  username: string;
  password: string;
  totpSecret: string | null;
}

/** Fehler mit einem Text, der dem Team direkt angezeigt werden kann */
export class PanelWebError extends Error {}

const stripTags = (html: string) =>
  html
    .replace(/<button[\s\S]*?<\/button>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();

class PanelWebSession {
  private cookies = new Map<string, string>();
  readonly base: string;

  constructor() {
    if (!env.PTERODACTYL_URL) throw new PanelWebError('Die Adresse des Panels ist nicht eingestellt (PTERODACTYL_URL).');
    this.base = env.PTERODACTYL_URL.replace(/\/$/, '');
  }

  async request(method: 'GET' | 'POST', path: string, body?: { json?: unknown; form?: URLSearchParams }): Promise<{ status: number; text: string; location: string | null }> {
    const xsrf = this.cookies.get('XSRF-TOKEN');
    let res: Response;
    try {
      res = await fetch(path.startsWith('http') ? path : `${this.base}${path}`, {
        method,
        redirect: 'manual',
        headers: {
          Accept: body?.json !== undefined ? 'application/json' : 'text/html,application/xhtml+xml',
          'X-Requested-With': body?.json !== undefined ? 'XMLHttpRequest' : '',
          ...(this.cookies.size ? { Cookie: [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; ') } : {}),
          ...(xsrf ? { 'X-XSRF-TOKEN': decodeURIComponent(xsrf) } : {}),
          ...(body?.json !== undefined ? { 'Content-Type': 'application/json' } : body?.form ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}),
        },
        body: body?.json !== undefined ? JSON.stringify(body.json) : body?.form?.toString(),
        signal: AbortSignal.timeout(Math.max(env.PTERODACTYL_TIMEOUT_MS, 20_000)),
      });
    } catch (err) {
      throw new PanelWebError(`Das Panel ist nicht erreichbar: ${(err as Error).message}`);
    }
    for (const line of res.headers.getSetCookie()) {
      const pair = line.split(';', 1)[0] ?? '';
      const i = pair.indexOf('=');
      if (i > 0) this.cookies.set(pair.slice(0, i).trim(), pair.slice(i + 1).trim());
    }
    return { status: res.status, text: await res.text(), location: res.headers.get('location') };
  }
}

function loginError(status: number, text: string): PanelWebError {
  let detail = '';
  try {
    const data = JSON.parse(text) as { errors?: { detail?: string }[] };
    detail = data.errors?.[0]?.detail ?? '';
  } catch {
    detail = stripTags(text).slice(0, 160);
  }
  if (/recaptcha/i.test(detail) || /recaptcha/i.test(text)) {
    return new PanelWebError('Das Panel verlangt bei der Anmeldung ein reCAPTCHA. Bitte schalte es im Panel aus (Settings → Advanced → reCAPTCHA: Disabled), sonst kann sich das System nicht anmelden.');
  }
  if (status === 429) return new PanelWebError('Zu viele Anmeldeversuche am Panel – bitte ein paar Minuten warten.');
  if (status === 419) return new PanelWebError('Das Panel hat die Anmeldung abgelehnt (Sitzung abgelaufen). Bitte noch einmal versuchen.');
  return new PanelWebError(`Die Anmeldung am Panel ist fehlgeschlagen${detail ? `: ${detail}` : ` (Fehler ${status})`}. Bitte Benutzername und Passwort prüfen.`);
}

/** Meldet sich am Panel an (wie im Browser) und gibt die Sitzung zurück */
async function login(creds: PanelWebLogin): Promise<PanelWebSession> {
  const session = new PanelWebSession();
  await session.request('GET', '/sanctum/csrf-cookie');
  const res = await session.request('POST', '/auth/login', { json: { user: creds.username, password: creds.password } });
  if (res.status !== 200) throw loginError(res.status, res.text);
  let data: { complete?: boolean; confirmation_token?: string } = {};
  try {
    data = (JSON.parse(res.text) as { data?: typeof data }).data ?? {};
  } catch {
    throw new PanelWebError('Das Panel hat auf die Anmeldung unerwartet geantwortet. Stimmt die Adresse des Panels?');
  }
  if (data.complete) return session;
  if (!data.confirmation_token) throw new PanelWebError('Das Panel hat auf die Anmeldung unerwartet geantwortet.');
  // Zwei-Faktor-Anmeldung
  if (!creds.totpSecret) {
    throw new PanelWebError('Für dieses Panel-Konto ist die Zwei-Faktor-Anmeldung aktiv. Bitte hinterlege den geheimen Schlüssel (TOTP) – oder nimm ein eigenes Admin-Konto ohne Zwei-Faktor-Anmeldung.');
  }
  let code: string;
  try {
    code = totpCode(creds.totpSecret.replace(/\s+/g, '').toUpperCase(), Math.floor(Date.now() / 1000 / TOTP_STEP_SECONDS));
  } catch {
    throw new PanelWebError('Der geheime Schlüssel für die Zwei-Faktor-Anmeldung ist ungültig.');
  }
  const check = await session.request('POST', '/auth/login/checkpoint', { json: { confirmation_token: data.confirmation_token, authentication_code: code } });
  if (check.status !== 200) throw loginError(check.status, check.text);
  return session;
}

/** Prüft den Zugang: Anmeldung möglich und Konto ist Admin? */
export async function testPanelWebLogin(creds: PanelWebLogin): Promise<void> {
  const session = await login(creds);
  const res = await session.request('GET', '/admin');
  if (res.status !== 200) throw new PanelWebError('Die Anmeldung klappt, aber das Konto ist im Panel kein Admin. Für den Umzug wird ein Admin-Konto gebraucht.');
}

/** Hinweise, die der Admin-Bereich des Panels nach einer Aktion einblendet */
function alerts(html: string): { type: string; text: string }[] {
  const found: { type: string; text: string }[] = [];
  for (const m of html.matchAll(/<div class="alert alert-(\w+)[^"]*"[^>]*>([\s\S]*?)<\/div>/g)) {
    const text = stripTags(m[2] ?? '');
    if (text) found.push({ type: m[1] ?? '', text });
  }
  return found;
}

/**
 * Startet den Umzug im Panel. Wirft einen PanelWebError mit verständlichem Text, wenn das Panel ablehnt
 * (z. B. Ziel-Node hat nicht genug Arbeitsspeicher oder Speicherplatz).
 */
export async function panelWebTransfer(creds: PanelWebLogin, serverId: number, nodeId: number, allocationId: number, additional: number[]): Promise<void> {
  const session = await login(creds);
  const form = new URLSearchParams();
  form.set('node_id', String(nodeId));
  form.set('allocation_id', String(allocationId));
  for (const id of additional) form.append('allocation_additional[]', String(id));
  const res = await session.request('POST', `/admin/servers/view/${serverId}/manage/transfer`, { form });
  if (res.status === 409) throw new PanelWebError('Das Panel lässt den Umzug gerade nicht zu: Der Server wird noch installiert, ein Backup wird eingespielt oder es läuft schon ein Umzug.');
  if (res.status === 403 || res.status === 404) throw new PanelWebError('Das Panel-Konto darf diesen Server nicht umziehen (kein Admin?) oder der Server existiert im Panel nicht.');
  if (res.status !== 302 && res.status !== 303) throw new PanelWebError(`Das Panel hat den Umzug nicht angenommen (Fehler ${res.status}): ${stripTags(res.text).slice(0, 160)}`);
  if (res.location && /\/auth\/login/.test(res.location)) throw new PanelWebError('Das Panel hat die Sitzung nicht akzeptiert. Bitte den Zugang unter Admin → Pterodactyl testen.');
  // Das Panel leitet auf die Verwaltungsseite des Servers zurück und blendet dort das Ergebnis ein
  const page = await session.request('GET', res.location ?? `/admin/servers/view/${serverId}/manage`);
  const notes = alerts(page.text);
  if (notes.some((n) => n.type === 'success')) return;
  const problem = notes.find((n) => n.type === 'danger' || n.type === 'warning');
  if (problem) {
    throw new PanelWebError(
      /disk space or memory/i.test(problem.text)
        ? 'Die Ziel-Node hat laut Panel nicht genug freien Arbeitsspeicher oder Speicherplatz für diesen Server.'
        : `Das Panel hat den Umzug abgelehnt: ${problem.text.slice(0, 220)}`,
    );
  }
  throw new PanelWebError('Das Panel hat den Umzug nicht bestätigt. Bitte im Panel nachsehen, ob er läuft.');
}
