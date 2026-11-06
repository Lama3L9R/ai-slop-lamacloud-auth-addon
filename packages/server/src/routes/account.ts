import { randomBytes } from 'node:crypto';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import type { Config } from '../config.ts';
import { HttpError, isClientError, passwordRulesError } from '../http.ts';
import { API_PATH, BASE_PATH } from '../paths.ts';
import type { ZitadelClient } from '../zitadel.ts';

const RESET_COOKIE = 'lca_reset';
/** Zitadel's password reset codes are valid for 1 hour by default */
const RESET_TTL_MS = 60 * 60_000;

const resetBody = z.object({ username: z.string().trim().min(1) });
const setBody = z.object({
  code: z.string().trim().min(1),
  password: z.string().min(1),
  /** from the emailed link; a code typed by hand relies on the reset cookie instead */
  userId: z.string().min(1).optional(),
});
const verifyBody = z.object({ userId: z.string().min(1), code: z.string().trim().min(1) });

/** Password reset (by emailed code only) and email verification. */
export const accountRoutes: FastifyPluginAsync<{ config: Config; zitadel: ZitadelClient }> = async (
  app,
  { config, zitadel },
) => {
  const uiUrl = config.zitadel.url + BASE_PATH;
  const rateLimit = { rateLimit: { max: 20, timeWindow: '1 minute' } };

  /**
   * Pending resets of this browser: cookie token -> user ID, so the user can type the code
   * from the email without us ever telling them whether the username exists.
   */
  const resets = new Map<string, { userId: string | undefined; expiresAt: number }>();
  const sweep = setInterval(() => {
    const now = Date.now();
    for (const [token, reset] of resets) if (reset.expiresAt <= now) resets.delete(token);
  }, 60_000);
  sweep.unref();
  app.addHook('onClose', async () => clearInterval(sweep));

  /** Same answer whether or not the user exists. */
  app.post('/password/reset', { config: rateLimit }, async (req, reply) => {
    const { username } = resetBody.parse(req.body);

    const user = await zitadel.findUser(username);
    let userId: string | undefined;
    if (!user) {
      req.log.info({ username }, 'password reset for unknown user not sent');
    } else if (await zitadel.getUserMetadata(user, config.yubico.lockdownKey)) {
      // locked accounts get no reset email; the answer stays the same
      req.log.info({ userId: user.id }, 'password reset for locked account not sent');
    } else {
      try {
        await zitadel.requestPasswordReset(
          user.id,
          `${uiUrl}/password/set?userId={{.UserID}}&code={{.Code}}`,
        );
        userId = user.id;
        req.log.info({ userId }, 'password reset requested');
      } catch (err) {
        if (!isClientError(err) || err.status === 401 || err.status === 403) throw err;
        req.log.info({ err, userId: user.id }, 'password reset not sent');
      }
    }

    const token = randomBytes(32).toString('base64url');
    resets.set(token, { userId, expiresAt: Date.now() + RESET_TTL_MS });
    reply.setCookie(RESET_COOKIE, token, {
      path: API_PATH,
      httpOnly: true,
      sameSite: 'strict',
      secure: req.protocol === 'https',
      maxAge: RESET_TTL_MS / 1000,
    });
    return { sent: true };
  });

  app.post('/password/set', { config: rateLimit }, async (req, reply) => {
    const body = setBody.parse(req.body);
    const token = req.cookies[RESET_COOKIE];
    const pending = token ? resets.get(token) : undefined;
    const userId = body.userId ?? pending?.userId;
    if (!userId) throw new HttpError(400, 'invalid or expired code');

    try {
      await zitadel.setPasswordWithCode(userId, body.code, body.password);
    } catch (err) {
      const weak = await passwordRulesError(err, zitadel);
      if (weak) throw weak;
      if (!isClientError(err) || err.status === 401 || err.status === 403) throw err;
      req.log.info({ err, userId }, 'password reset rejected');
      throw new HttpError(400, 'invalid or expired code');
    }
    if (token) {
      resets.delete(token);
      reply.clearCookie(RESET_COOKIE, { path: API_PATH });
    }
    req.log.info({ userId }, 'password reset');
    return { done: true };
  });

  app.post('/email/verify', { config: rateLimit }, async (req) => {
    const { userId, code } = verifyBody.parse(req.body);
    try {
      await zitadel.verifyEmail(userId, code);
    } catch (err) {
      if (!isClientError(err) || err.status === 401 || err.status === 403) throw err;
      req.log.info({ err, userId }, 'email verification rejected');
      throw new HttpError(400, 'invalid or expired code');
    }
    req.log.info({ userId }, 'email verified');
    return { done: true };
  });
};
