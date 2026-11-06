import { randomBytes } from 'node:crypto';
import { resolve } from 'node:path';
import Fastify, { type FastifyServerOptions } from 'fastify';
import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import type { Config } from './config.ts';
import { apiErrorHandler } from './http.ts';
import { JwksVerifier } from './jws.ts';
import { API_PATH, BASE_PATH } from './paths.ts';
import { accountRoutes } from './routes/account.ts';
import { authRoutes } from './routes/auth.ts';
import { healthRoutes } from './routes/health.ts';
import { logoutRoutes } from './routes/logout.ts';
import { ZitadelClient } from './zitadel.ts';

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

  if (!server.cookieSecret) {
    app.log.warn('server.cookieSecret is not set, using a random one for this process');
  }
  await app.register(cookie, { secret: server.cookieSecret ?? randomBytes(32).toString('hex') });
  await app.register(rateLimit, { global: false });

  const zitadel = new ZitadelClient(config.zitadel.url, config.zitadel.serviceToken);
  const jwks = new JwksVerifier(`${config.zitadel.url}/oauth/v2/keys`);

  await app.register(
    async (api) => {
      api.setErrorHandler(apiErrorHandler);
      await api.register(healthRoutes);
      await api.register(authRoutes, { config, zitadel });
      await api.register(accountRoutes, { config, zitadel });
    },
    { prefix: API_PATH },
  );
  await app.register(logoutRoutes, { prefix: BASE_PATH, zitadel, jwks });

  // Optionally serve the built web app, with SPA fallback to index.html
  if (server.webRoot) {
    await app.register(fastifyStatic, { root: resolve(server.webRoot), prefix: `${BASE_PATH}/` });
    app.setNotFoundHandler((req, reply) => {
      const path = req.url.split('?')[0]!;
      const inUi = path === BASE_PATH || path.startsWith(`${BASE_PATH}/`);
      if (req.method === 'GET' && inUi && !path.startsWith(`${API_PATH}/`)) {
        return reply.sendFile('index.html');
      }
      return reply.code(404).send({ error: 'not found' });
    });
  }

  return app;
}
