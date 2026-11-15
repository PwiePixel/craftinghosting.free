import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import Fastify from 'fastify';
import { allowedOrigins, env, isProd } from './env';
import { registerErrorHandler } from './lib/errors';
import { authPlugin } from './plugins/auth';
import { betaPlugin } from './plugins/beta';
import { securityPlugin } from './plugins/security';
import { adminRoutes } from './routes/admin.routes';
import { authRoutes } from './routes/auth.routes';
import { chatAdminRoutes, chatRoutes } from './routes/chat.routes';
import { discordAdminRoutes, discordRoutes } from './routes/discord.routes';
import { domainAdminRoutes } from './routes/domains.routes';
import { metaRoutes } from './routes/meta.routes';
import { newsletterAdminRoutes, newsletterRoutes } from './routes/newsletter.routes';
import { serverRoutes } from './routes/servers.routes';

export async function buildApp() {
  const app = Fastify({
    trustProxy: env.TRUST_PROXY,
    bodyLimit: 64 * 1024,
    // Keine Zugriffsprotokolle (Datenschutz) – Fehler werden weiterhin geloggt
    disableRequestLogging: true,
    logger: {
      level: env.LOG_LEVEL,
      redact: ['req.headers.cookie', 'req.headers.authorization', 'res.headers["set-cookie"]'],
      ...(isProd ? {} : { transport: { target: 'pino-pretty', options: { translateTime: 'HH:MM:ss', ignore: 'pid,hostname' } } }),
    },
  });

  registerErrorHandler(app);

  await app.register(helmet, { contentSecurityPolicy: false });
  await app.register(cors, {
    origin: (origin, cb) => cb(null, !origin || allowedOrigins.has(origin)),
    credentials: true,
  });
  await app.register(cookie);
  await app.register(rateLimit, {
    global: true,
    max: 300,
    timeWindow: '1 minute',
    keyGenerator: (request) => request.ip,
  });

  await app.register(securityPlugin);
  await app.register(authPlugin);
  await app.register(betaPlugin);

  await app.register(
    async (api) => {
      await api.register(metaRoutes);
      await api.register(authRoutes);
      await api.register(serverRoutes);
      await api.register(adminRoutes);
      await api.register(newsletterRoutes);
      await api.register(newsletterAdminRoutes);
      await api.register(domainAdminRoutes);
      await api.register(discordRoutes);
      await api.register(discordAdminRoutes);
      await api.register(chatRoutes);
      await api.register(chatAdminRoutes);
    },
    { prefix: '/api/v1' },
  );

  return app;
}
