/**
 * Kommandozeile für Betrieb & Tests.
 *   npm run cli -w @chfree/api -- jobs                 → verfügbare Jobs
 *   npm run cli -w @chfree/api -- run <job|all>        → Job(s) einmalig ausführen
 *   npm run cli -w @chfree/api -- mail-test <adresse>  → SMTP prüfen (inkl. Port-Suche) und Testmail senden
 *   npm run cli -w @chfree/api -- make-admin <email>   → Konto zum Admin machen (Zugriff auf /admin)
 *   Docker:  docker compose run --rm api node dist/cli.js mail-test du@example.com
 */
import pino from 'pino';
import { closeDb } from './db/client';
import { allJobs } from './jobs/registry';
import { runJobOnce } from './jobs/scheduler';
import { env, mailFrom, smtpSecure } from './env';
import { addressOf, createSmtpTransport, explainSmtpError } from './services/mail/mailer';
import { notificationMail } from './services/mail/templates';

async function mailTest(to: string | undefined) {
  console.log('SMTP-Einstellungen aus der .env:');
  console.log(`  SMTP_HOST   ${env.SMTP_HOST || '(leer – Mails werden nur ins Log geschrieben)'}`);
  console.log(`  SMTP_PORT   ${env.SMTP_PORT}  (${smtpSecure ? 'SSL' : 'STARTTLS'})`);
  console.log(`  SMTP_USER   ${env.SMTP_USER || '(leer)'}`);
  console.log(`  SMTP_PASS   ${env.SMTP_PASS ? `gesetzt (${env.SMTP_PASS.length} Zeichen)` : '(leer)'}`);
  console.log(`  Absender    ${mailFrom}`);
  if (!env.SMTP_HOST) return;
  if (env.SMTP_USER?.includes('@') && addressOf(mailFrom) !== env.SMTP_USER.trim().toLowerCase()) {
    console.log(`\n⚠ Absender ${addressOf(mailFrom)} ≠ Postfach ${env.SMTP_USER} – mailcow & Co. lehnen das meist ab. MAIL_FROM leer lassen.`);
  }

  const auth = { user: env.SMTP_USER, pass: env.SMTP_PASS };
  console.log('\n1) Verbindung mit diesen Einstellungen …');
  let ok = false;
  try {
    await createSmtpTransport({ host: env.SMTP_HOST, port: env.SMTP_PORT, secure: smtpSecure, ...auth }).verify();
    ok = true;
    console.log('   ✔ Verbindung und Anmeldung ok');
  } catch (err) {
    console.log(`   ✘ ${explainSmtpError(err)}`);
    console.log('\n2) Andere übliche Ports werden ausprobiert …');
    for (const [port, secure] of [
      [587, false],
      [465, true],
      [25, false],
      [2525, false],
    ] as const) {
      if (port === env.SMTP_PORT && secure === smtpSecure) continue;
      try {
        await createSmtpTransport({ host: env.SMTP_HOST, port, secure, ...auth }).verify();
        console.log(`   ✔ Port ${port} (${secure ? 'SSL' : 'STARTTLS'}) funktioniert → in der .env: SMTP_PORT=${port} und SMTP_SECURE=${secure}`);
      } catch (e) {
        console.log(`   ✘ Port ${port} (${secure ? 'SSL' : 'STARTTLS'}): ${explainSmtpError(e)}`);
      }
    }
  }
  if (!ok || !to) {
    if (ok) console.log('\nFür eine Testmail: mail-test du@example.com');
    return;
  }
  console.log(`\n3) Testmail an ${to} …`);
  try {
    const mail = notificationMail('Testmail von CraftingHosting.free', 'Wenn du diese E-Mail liest, funktioniert der Versand.', { label: 'craftinghosting.free', url: env.APP_URL }, 'de');
    const info = await createSmtpTransport({ host: env.SMTP_HOST, port: env.SMTP_PORT, secure: smtpSecure, ...auth }).sendMail({
      from: mailFrom,
      to,
      subject: mail.subject,
      html: mail.html,
      text: mail.text,
    });
    console.log(`   ✔ Angenommen vom Mailserver: ${info.response}`);
    console.log('   Kommt nichts an? Spam-Ordner prüfen und im Mailserver-Log nachsehen (SPF/DKIM/DMARC).');
  } catch (err) {
    console.log(`   ✘ ${explainSmtpError(err)}`);
    process.exitCode = 1;
  }
}

const logger = pino({ level: 'info' });

async function main() {
  const [cmd, arg] = process.argv.slice(2);
  if (cmd === 'jobs' || !cmd) {
    for (const j of allJobs) console.log(`${j.name.padEnd(22)} alle ${Math.round(j.intervalMs / 1000)} s`);
    return;
  }
  if (cmd === 'run') {
    const jobs = arg === 'all' ? allJobs : allJobs.filter((j) => j.name === arg);
    if (jobs.length === 0) throw new Error(`Unbekannter Job: ${arg}`);
    for (const job of jobs) {
      const result = await runJobOnce(job, logger);
      console.log(`${job.name}: ${result}`);
    }
    return;
  }
  if (cmd === 'make-admin') {
    if (!arg) throw new Error('Bitte E-Mail-Adresse angeben: make-admin du@example.com');
    const { affectedRows, db } = await import('./db/client');
    const { users } = await import('./db/schema');
    const { eq } = await import('drizzle-orm');
    const changed = affectedRows(await db.update(users).set({ role: 'admin' }).where(eq(users.email, arg.trim().toLowerCase())));
    console.log(
      changed
        ? `✔ ${arg} ist jetzt Admin – Admin-Bereich: ${env.APP_URL}/admin`
        : `✘ Kein Konto mit ${arg} gefunden. Erst einmal auf der Website einen Server anfordern bzw. anmelden, dann erneut ausführen (oder ADMIN_EMAILS in der .env setzen).`,
    );
    return;
  }
  if (cmd === 'mail-test') {
    await mailTest(arg);
    return;
  }
  throw new Error(`Unbekannter Befehl: ${cmd}`);
}

main()
  .catch((err) => {
    console.error(err.message ?? err);
    process.exitCode = 1;
  })
  .finally(() => closeDb());
