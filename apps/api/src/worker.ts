/**
 * Eigenständiger Worker-Prozess für alle automatisierten Jobs.
 * Mehrere Instanzen sind möglich – Lease-Locks sorgen dafür, dass jeder
 * Job zur selben Zeit nur einmal läuft.
 */
import pino from 'pino';
import { closeDb } from './db/client';
import { startDiscordGateway } from './discord/gateway';
import { env, isProd } from './env';
import { startScheduler } from './jobs/scheduler';
import { verifySmtpOnStartup } from './services/mail/mailer';

const logger = pino({
  level: env.LOG_LEVEL,
  ...(isProd ? {} : { transport: { target: 'pino-pretty', options: { translateTime: 'HH:MM:ss', ignore: 'pid,hostname' } } }),
});

const scheduler = startScheduler(logger);
const discord = startDiscordGateway(logger);
logger.info(`Worker gestartet (Pterodactyl-Modus: ${env.PTERODACTYL_MODE})`);
void verifySmtpOnStartup({ info: (m) => logger.info(m), warn: (m) => logger.warn(m), error: (m) => logger.error(m) });

const shutdown = async (signal: string) => {
  logger.info(`${signal} empfangen – beende laufende Jobs …`);
  await scheduler.stop();
  await discord.stop();
  await closeDb();
  process.exit(0);
};
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
