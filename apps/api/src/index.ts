import { buildApp } from './app';
import { closeDb } from './db/client';
import { env } from './env';
import { startScheduler } from './jobs/scheduler';
import { verifySmtpOnStartup } from './services/mail/mailer';

async function main() {
  const app = await buildApp();
  await app.listen({ host: env.API_HOST, port: env.API_PORT });
  app.log.info(`Pterodactyl-Modus: ${env.PTERODACTYL_MODE}`);
  void verifySmtpOnStartup({ info: (m) => app.log.info(m), warn: (m) => app.log.warn(m), error: (m) => app.log.error(m) });

  const scheduler = env.RUN_JOBS_IN_API ? startScheduler(app.log) : null;
  if (scheduler) app.log.info('Jobs laufen im API-Prozess (RUN_JOBS_IN_API=true)');

  const shutdown = async (signal: string) => {
    app.log.info(`${signal} empfangen – fahre herunter …`);
    await scheduler?.stop();
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
