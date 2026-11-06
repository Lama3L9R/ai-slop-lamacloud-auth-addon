import type { FastifyPluginAsync } from 'fastify';
import type { JwksVerifier } from '../jws.ts';
import { BASE_PATH } from '../paths.ts';
import { readSessions, writeSessions } from '../sessions.ts';
import type { ZitadelClient } from '../zitadel.ts';

interface LogoutQuery {
  post_logout_redirect?: string;
  logout_hint?: string;
  logout_token?: string;
}

/** Signed by Zitadel; the query params next to it are just copies and are not trusted. */
interface LogoutToken {
  post_logout_redirect_uri?: string;
  logout_hint?: string;
}

const DONE_PATH = `${BASE_PATH}/logout/done`;

/**
 * Zitadel sends the browser here on end_session without id_token_hint:
 *   /ui/v2/login/logout?post_logout_redirect=...&logout_hint=...&logout_token=<JWS>
 * Terminates this browser's sessions (only those of logout_hint's user, if given), then
 * redirects to the signed post-logout URI, or to the "signed out" page.
 */
export const logoutRoutes: FastifyPluginAsync<{
  zitadel: ZitadelClient;
  jwks: JwksVerifier;
}> = async (app, { zitadel, jwks }) => {
  app.get<{ Querystring: LogoutQuery }>('/logout', async (req, reply) => {
    let token: LogoutToken = {};
    if (req.query.logout_token) {
      try {
        token = await jwks.verify<LogoutToken>(req.query.logout_token);
      } catch (err) {
        req.log.warn({ err }, 'invalid logout_token, ignoring redirect');
      }
    }

    const hint = token.logout_hint?.toLowerCase();
    const sessions = readSessions(req);
    const matches = (loginName: string) => !hint || loginName.toLowerCase() === hint;
    const drop = sessions.filter((s) => matches(s.loginName));

    await Promise.all(
      drop.map((s) =>
        zitadel.deleteSession(s.id).catch((err) => {
          // already gone (expired, terminated elsewhere) is fine
          req.log.warn({ err, sessionId: s.id }, 'failed to delete Zitadel session');
        }),
      ),
    );
    writeSessions(
      req,
      reply,
      sessions.filter((s) => !matches(s.loginName)),
    );
    req.log.info({ terminated: drop.length, hint }, 'logout');

    // Zitadel uses "/logout/done" (relative to the login UI) when the app gave no redirect URI
    let target = token.post_logout_redirect_uri || DONE_PATH;
    if (target.startsWith('/') && !target.startsWith('//')) {
      target = target.startsWith(BASE_PATH + '/') ? target : BASE_PATH + target;
    }
    return reply.redirect(target);
  });
};
