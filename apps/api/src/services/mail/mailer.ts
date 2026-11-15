import nodemailer, { type Transporter } from 'nodemailer';
import { env, mailFrom, smtpSecure } from '../../env';
import type { MailContent } from './templates';

let transporter: Transporter | null = null;

/** Adresse aus „Name <adresse>“ */
export function addressOf(from: string): string {
  return (/<([^>]+)>/.exec(from)?.[1] ?? from).trim().toLowerCase();
}

export function createSmtpTransport(opts: { host: string; port: number; secure: boolean; user?: string; pass?: string }): Transporter {
  return nodemailer.createTransport({
    host: opts.host,
    port: opts.port,
    secure: opts.secure,
    auth: opts.user ? { user: opts.user, pass: opts.pass } : undefined,
    // Kurze Timeouts: Ein blockierter Port soll nicht minutenlang hängen
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 30_000,
  });
}

function getTransporter(): Transporter | null {
  if (!env.SMTP_HOST) return null;
  if (!transporter) {
    transporter = createSmtpTransport({ host: env.SMTP_HOST, port: env.SMTP_PORT, secure: smtpSecure, user: env.SMTP_USER, pass: env.SMTP_PASS });
  }
  return transporter;
}

/** Verständliche Erklärung zu typischen SMTP-Fehlern (für Logs und das CLI) */
export function explainSmtpError(err: unknown): string {
  const e = err as { code?: string; responseCode?: number; response?: string; message?: string };
  const msg = `${e.response ?? ''} ${e.message ?? ''}`.toLowerCase();
  if (e.code === 'EAUTH' || e.responseCode === 535) return 'Anmeldung abgelehnt – SMTP_USER/SMTP_PASS prüfen (Postfachname exakt wie im Mailserver).';
  if (msg.includes('not owned by user') || msg.includes('sender address rejected'))
    return `Absender ${addressOf(mailFrom)} gehört nicht zum Postfach ${env.SMTP_USER ?? ''} – MAIL_FROM leer lassen oder auf das Postfach setzen (bzw. Alias im Mailserver freigeben).`;
  if (e.code === 'ETIMEDOUT' || e.code === 'ECONNREFUSED' || e.code === 'ESOCKET' || e.code === 'ECONNECTION')
    return 'Keine Verbindung – Port falsch oder ausgehend gesperrt (Hoster/Firewall). Üblich: 587 (STARTTLS) oder 465 (SSL).';
  if (msg.includes('wrong version number') || msg.includes('ssl routines'))
    return 'SSL/STARTTLS passt nicht zum Port – bei 587 SMTP_SECURE=false, bei 465 SMTP_SECURE=true (oder SMTP_SECURE=auto).';
  if (e.code === 'EDNS' || msg.includes('getaddrinfo')) return 'SMTP_HOST ist nicht auflösbar – Schreibweise prüfen.';
  return e.message ?? String(err);
}

/** Prüft beim Start einmal die SMTP-Verbindung und schreibt das Ergebnis ins Log. */
export async function verifySmtpOnStartup(log: { info: (m: string) => void; warn: (m: string) => void; error: (m: string) => void }) {
  const t = getTransporter();
  if (!t) {
    log.warn('[mail] SMTP_HOST ist leer – E-Mails werden nur ins Log geschrieben, nicht versendet.');
    return;
  }
  const target = `${env.SMTP_HOST}:${env.SMTP_PORT} (${smtpSecure ? 'SSL' : 'STARTTLS'}), Benutzer ${env.SMTP_USER ?? '–'}, Absender ${mailFrom}`;
  if (env.SMTP_USER?.includes('@') && addressOf(mailFrom) !== env.SMTP_USER.trim().toLowerCase()) {
    log.warn(`[mail] Absender ${addressOf(mailFrom)} ≠ SMTP-Benutzer ${env.SMTP_USER} – viele Mailserver (z. B. mailcow) lehnen das ab.`);
  }
  try {
    await t.verify();
    log.info(`[mail] SMTP-Verbindung ok: ${target}`);
  } catch (err) {
    log.error(`[mail] SMTP-Verbindung fehlgeschlagen: ${target} – ${explainSmtpError(err)}`);
  }
}

/**
 * Versendet eine E-Mail. Ohne SMTP_HOST (Entwicklung) wird die Mail
 * stattdessen in die Konsole geschrieben.
 */
export async function sendMail(to: string, content: MailContent, headers?: Record<string, string>): Promise<void> {
  const t = getTransporter();
  if (!t) {
    console.info(`\n[mail:dev] An: ${to}\n[mail:dev] Betreff: ${content.subject}\n${content.text}\n`);
    return;
  }
  try {
    await t.sendMail({ from: mailFrom, to, subject: content.subject, html: content.html, text: content.text, headers });
  } catch (err) {
    console.error(`[mail] Versand an ${to} fehlgeschlagen: ${explainSmtpError(err)}`);
    throw err;
  }
}
