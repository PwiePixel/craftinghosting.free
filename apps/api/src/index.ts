import { startDiscordGateway } from './discord/gateway';
import { buildApp } from './app';
import { closeDb } from './db/client';
import { env } from './env';
import { startScheduler } from './jobs/scheduler';
import { startPanelUsageReporter } from './pterodactyl/governor';
import { verifySmtpOnStartup } from './services/mail/mailer';
import { ensureBanFingerprints } from './services/warnings.service';

async function main() {
  const app = await buildApp();
  await app.listen({ host: env.API_HOST, port: env.API_PORT });
  app.log.info(`Pterodactyl-Modus: ${env.PTERODACTYL_MODE}`);
  // Sperrliste: fehlende Einträge gebannter Konten nachtragen (einmalig nach dem Update, danach ohne Wirkung)
  void ensureBanFingerprints()
    .then((n) => n > 0 && app.log.info(`Sperrliste: ${n} Einträge für gebannte Konten nachgetragen`))
    .catch((err) => app.log.warn({ err }, 'Sperrliste konnte nicht ergänzt werden'));
  void verifySmtpOnStartup({ info: (m) => app.log.info(m), warn: (m) => app.log.warn(m), error: (m) => app.log.error(m) });

  const scheduler = env.RUN_JOBS_IN_API ? startScheduler(app.log) : null;
  startPanelUsageReporter('api');
  // Der Discord-Bot läuft dort, wo die Jobs laufen (genau eine Verbindung)
  const discord = env.RUN_JOBS_IN_API ? startDiscordGateway(app.log) : null;
  if (scheduler) app.log.info('Jobs laufen im API-Prozess (RUN_JOBS_IN_API=true)');

  const shutdown = async (signal: string) => {
    app.log.info(`${signal} empfangen – fahre herunter …`);
    await scheduler?.stop();
    await discord?.stop();
    await app.close();
    await closeDb();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
