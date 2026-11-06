import { resolve } from 'node:path';
import Fastify, { type FastifyServerOptions } from 'fastify';
import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import type { Config } from './config.ts';
import { authRoutes } from './routes/auth.ts';
import { healthRoutes } from './routes/health.ts';

export async function buildApp(config: Config) {
  const { server } = config;
  const logger: FastifyServerOptions['logger'] = process.stdout.isTTY
    ? {
        level: server.logLevel,
        transport: {
          target: 'pino-pretty',
          options: { translateTime: 'HH:MM:ss', ignore: 'pid,hostname' },
        },
      }
    : { level: server.logLevel };

  const app = Fastify({ logger, trustProxy: server.trustProxy });

  await app.register(cookie);
  await app.register(rateLimit, { global: false });

  await app.register(
    async (api) => {
      await api.register(healthRoutes);
      await api.register(authRoutes, { config });
    },
    { prefix: '/api' },
  );

  // Optionally serve the built web app, with SPA fallback to index.html
  if (server.webRoot) {
    await app.register(fastifyStatic, { root: resolve(server.webRoot) });
    app.setNotFoundHandler((req, reply) => {
      if (req.method === 'GET' && !req.url.startsWith('/api/')) {
        return reply.sendFile('index.html');
      }
      return reply.code(404).send({ error: 'not found' });
    });
  }

  return app;
}
