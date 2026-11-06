import { parseArgs } from 'node:util';
import { buildApp } from './app.ts';
import { loadConfig } from './config.ts';

const { values } = parseArgs({
  options: {
    config: { type: 'string', short: 'c', default: 'config.json' },
    // directory of the built web app; overrides server.webRoot (used by the Nix package)
    'web-root': { type: 'string' },
  },
});

const config = loadConfig(values.config);
if (values['web-root']) config.server.webRoot = values['web-root'];
const app = await buildApp(config);

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, async () => {
    app.log.info({ signal }, 'shutting down');
    await app.close();
    process.exit(0);
  });
}

try {
  await app.listen({ host: config.server.host, port: config.server.port });
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
