import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';

const configSchema = z.object({
  server: z
    .object({
      host: z.string().default('127.0.0.1'),
      port: z.number().int().positive().default(3000),
      logLevel: z
        .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
        .default('info'),
      /** Trust X-Forwarded-* headers. Enable when running behind a reverse proxy. */
      trustProxy: z.boolean().default(false),
      /** Serve the built web app (packages/web/dist) from this directory. Optional. */
      webRoot: z.string().optional(),
    })
    .prefault({}),

  zitadel: z.object({
    /** Base URL of the Zitadel instance, e.g. https://auth.example.com */
    url: z.url().transform((u) => u.replace(/\/+$/, '')),
    /** PAT of a service user with the IAM_LOGIN_CLIENT role. */
    serviceToken: z.string().min(1),
  }),

  yubico: z.object({
    /** Client ID / secret from https://upgrade.yubico.com/getapikey/ */
    clientId: z.string().min(1),
    secretKey: z.string().min(1),
    /** Validation servers, tried in order. */
    apiUrls: z.array(z.url()).min(1).default(['https://api.yubico.com/wsapi/2.0/verify']),
    /**
     * Zitadel user metadata key holding the user's YubiKey public IDs
     * (the first 12 characters of an OTP), separated by commas or whitespace.
     * Users without this key skip the Yubico OTP step.
     */
    metadataKey: z.string().min(1).default('yubico_otp'),
  }),

  /** Where to send the user after a login that did not start from an OIDC auth request. */
  defaultRedirectUrl: z.url().optional(),

  /** Display names per OIDC client ID; overrides the app name fetched from Zitadel. */
  appNames: z.record(z.string(), z.string()).default({}),
});

export type Config = z.infer<typeof configSchema>;

export function loadConfig(path: string): Config {
  const file = resolve(path);
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(file, 'utf8'));
  } catch (err) {
    console.error(`Cannot read config file ${file}: ${(err as Error).message}`);
    process.exit(1);
  }
  const result = configSchema.safeParse(raw);
  if (!result.success) {
    console.error(`Invalid config in ${file}:\n` + z.prettifyError(result.error));
    process.exit(1);
  }
  return result.data;
}
