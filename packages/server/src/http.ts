import type { FastifyError, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { ZitadelError, type ZitadelClient } from './zitadel.ts';

/** Error with a message that is safe to show in the UI. */
export class HttpError extends Error {
  status: number;
  /** tells the UI the login flow is gone and it should go back to the first step */
  restart: boolean;
  constructor(status: number, message: string, restart = false) {
    super(message);
    this.status = status;
    this.restart = restart;
  }
}

/** API errors are always `{ error, restart }` JSON; anything unexpected becomes a generic 500. */
export function apiErrorHandler(err: FastifyError, req: FastifyRequest, reply: FastifyReply) {
  if (err instanceof HttpError) {
    return reply.code(err.status).send({ error: err.message, restart: err.restart });
  }
  if (err instanceof z.ZodError) return reply.code(400).send({ error: 'invalid request' });
  if (err.statusCode === 429) {
    return reply.code(429).send({ error: 'too many attempts, try again later' });
  }
  req.log.error({ err }, 'request failed');
  return reply.code(500).send({ error: 'internal error' });
}

export const isClientError = (err: unknown): err is ZitadelError =>
  err instanceof ZitadelError && err.status >= 400 && err.status < 500;

/**
 * Zitadel rejects weak passwords with an i18n key (Errors.User.PasswordComplexityPolicy.*);
 * turn that into the actual rules. Returns undefined for other errors.
 */
export async function passwordRulesError(
  err: unknown,
  zitadel: ZitadelClient,
  orgId?: string,
): Promise<HttpError | undefined> {
  if (!(err instanceof ZitadelError) || !/Complexity/i.test(err.message)) return undefined;
  const rules = await zitadel.getPasswordComplexity(orgId).catch(() => undefined);
  if (!rules) return new HttpError(400, 'password is too weak');
  const needs = [
    rules.requiresUppercase && 'an uppercase letter',
    rules.requiresLowercase && 'a lowercase letter',
    rules.requiresNumber && 'a number',
    rules.requiresSymbol && 'a symbol',
  ].filter(Boolean);
  let text = `password needs at least ${Number(rules.minLength ?? 0)} characters`;
  if (needs.length) text += `, ${needs.join(', ')}`;
  return new HttpError(400, text);
}
