import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Config } from '../config.ts';
import { FLOW_TTL_MS, FlowStore, MAX_OTP_ATTEMPTS, type Flow } from '../flows.ts';
import { isYubicoOtp, otpPublicId, parsePublicIds, YubicoVerifier } from '../yubico.ts';
import { ZitadelClient, ZitadelError, type CreatedSession, type SessionUser } from '../zitadel.ts';

const FLOW_COOKIE = 'lca_flow';

const loginBody = z.object({
  authRequest: z.string().min(1).optional(),
  username: z.string().trim().min(1),
  password: z.string().min(1),
});

const otpBody = z.object({
  otp: z.string().trim().toLowerCase(),
});

/** Error with a message that is safe to show in the UI. */
class HttpError extends Error {
  status: number;
  /** tells the UI the login flow is gone and it should go back to the first step */
  restart: boolean;
  constructor(status: number, message: string, restart = false) {
    super(message);
    this.status = status;
    this.restart = restart;
  }
}

export const authRoutes: FastifyPluginAsync<{ config: Config }> = async (app, { config }) => {
  const zitadel = new ZitadelClient(config.zitadel.url, config.zitadel.serviceToken);
  const yubico = new YubicoVerifier(config.yubico);
  const appNames = new Map(Object.entries(config.appNames));

  const discardSession = (sessionId: string) =>
    zitadel.deleteSession(sessionId).catch((err) => {
      app.log.warn({ err, sessionId }, 'failed to delete Zitadel session');
    });

  const flows = new FlowStore((flow) => void discardSession(flow.sessionId));
  app.addHook('onClose', async () => flows.close());

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof HttpError) {
      return reply.code(err.status).send({ error: err.message, restart: err.restart });
    }
    if (err instanceof z.ZodError) return reply.code(400).send({ error: 'invalid request' });
    if ((err as { statusCode?: number }).statusCode === 429) {
      return reply.code(429).send({ error: 'too many attempts, try again later' });
    }
    req.log.error({ err }, 'request failed');
    return reply.code(500).send({ error: 'internal error' });
  });

  const setFlowCookie = (req: FastifyRequest, reply: FastifyReply, value: string) =>
    reply.setCookie(FLOW_COOKIE, value, {
      path: '/api',
      httpOnly: true,
      sameSite: 'strict',
      secure: req.protocol === 'https',
      maxAge: FLOW_TTL_MS / 1000,
    });

  const clearFlow = (reply: FastifyReply, flow: Flow) => {
    flows.delete(flow.id);
    reply.clearCookie(FLOW_COOKIE, { path: '/api' });
  };

  /** Hands the authenticated session to Zitadel and returns where the browser goes next. */
  const finish = async (authRequestId: string | undefined, session: CreatedSession) => {
    if (!authRequestId) {
      if (config.defaultRedirectUrl) return config.defaultRedirectUrl;
      void discardSession(session.sessionId);
      throw new HttpError(400, 'no login request, open this page from an app');
    }
    try {
      return await zitadel.createCallback(authRequestId, session);
    } catch (err) {
      void discardSession(session.sessionId);
      if (err instanceof ZitadelError && err.status >= 400 && err.status < 500) {
        app.log.info({ err, authRequestId }, 'auth request rejected');
        throw new HttpError(400, 'login request expired, go back to the app and try again');
      }
      throw err;
    }
  };

  // Info for the "Signing in to <app>" line and username prefill
  app.get<{ Params: { id: string } }>('/auth-requests/:id', async (req) => {
    let authRequest;
    try {
      authRequest = await zitadel.getAuthRequest(req.params.id);
    } catch (err) {
      if (err instanceof ZitadelError && err.status >= 400 && err.status < 500) {
        throw new HttpError(404, 'login request expired, go back to the app and try again');
      }
      throw err;
    }

    let appName = appNames.get(authRequest.clientId);
    if (appName === undefined) {
      appName = await zitadel.getAppName(authRequest.clientId).catch((err) => {
        req.log.warn({ err }, 'failed to look up app name');
        return undefined;
      });
      if (appName) appNames.set(authRequest.clientId, appName);
    }
    return { appName, loginHint: authRequest.loginHint };
  });

  const rateLimit = { rateLimit: { max: 20, timeWindow: '1 minute' } };

  /**
   * Username + password, or username + Yubico OTP typed into the password field.
   * - password: if the user has YubiKeys registered, a Yubico OTP step follows
   * - OTP: if it comes from one of the user's registered YubiKeys, the user is logged in
   *   right away; the key alone is the credential
   * Passwords are assumed never to look like a Yubico OTP (32-48 modhex characters).
   */
  app.post('/login', { config: rateLimit }, async (req, reply) => {
    const body = loginBody.parse(req.body);
    const otp = body.password.trim().toLowerCase();
    const otpLogin = isYubicoOtp(otp);

    let session: CreatedSession;
    try {
      // OTP login: only look the user up; Zitadel never sees the OTP
      session = await zitadel.createSession(body.username, otpLogin ? undefined : body.password, {
        ip: req.ip,
        description: req.headers['user-agent'],
      });
    } catch (err) {
      // 4xx covers unknown user, wrong password, locked user, ...; don't tell them apart
      if (err instanceof ZitadelError && err.status >= 400 && err.status < 500) {
        if (err.status === 401 || err.status === 403) throw err; // our service token is broken
        req.log.info({ err, username: body.username, otpLogin }, 'user or password check failed');
        throw new HttpError(401, 'invalid username or password');
      }
      throw err;
    }

    let user: SessionUser;
    let yubikeyIds: string[];
    try {
      user = await zitadel.getSessionUser(session.sessionId);
      const metadata = await zitadel.getUserMetadata(user.id, config.yubico.metadataKey);
      yubikeyIds = metadata ? parsePublicIds(metadata) : [];
    } catch (err) {
      void discardSession(session.sessionId);
      throw err;
    }

    if (otpLogin) {
      // the session has only been checked for the user so far; drop it unless the key checks out
      const reject = (reason: string, message = 'invalid username or password'): never => {
        req.log.info({ userId: user.id, reason }, 'yubico otp login rejected');
        void discardSession(session.sessionId);
        throw new HttpError(401, message);
      };
      if (!yubikeyIds.includes(otpPublicId(otp))) reject('UNKNOWN_YUBIKEY');

      let result;
      try {
        result = await yubico.verify(otp);
      } catch (err) {
        void discardSession(session.sessionId);
        req.log.error({ err }, 'yubico validation failed');
        throw new HttpError(502, 'cannot reach the Yubico validation server');
      }
      if (!result.ok) {
        reject(result.status, result.status === 'REPLAYED_OTP' ? 'OTP already used' : undefined);
      }
      return { redirect: await finish(body.authRequest, session) };
    }

    if (yubikeyIds.length === 0) {
      return { redirect: await finish(body.authRequest, session) };
    }

    const flow = flows.create({
      authRequestId: body.authRequest,
      sessionId: session.sessionId,
      sessionToken: session.sessionToken,
      userId: user.id,
      yubikeyIds,
    });
    setFlowCookie(req, reply, flow.id);
    return { next: 'otp' };
  });

  app.post('/otp', { config: rateLimit }, async (req, reply) => {
    const { otp } = otpBody.parse(req.body);
    const flow = flows.get(req.cookies[FLOW_COOKIE]);
    if (!flow) throw new HttpError(401, 'login expired, please sign in again', true);

    if (!isYubicoOtp(otp)) throw new HttpError(400, 'not a valid Yubico OTP');

    const fail = (status: string) => {
      req.log.info({ userId: flow.userId, status }, 'yubico otp rejected');
      flow.otpAttempts++;
      if (flow.otpAttempts >= MAX_OTP_ATTEMPTS) {
        clearFlow(reply, flow);
        void discardSession(flow.sessionId);
        throw new HttpError(401, 'too many failed attempts, please sign in again', true);
      }
      throw new HttpError(
        401,
        status === 'REPLAYED_OTP' ? 'OTP already used' : 'invalid Yubico OTP',
      );
    };

    if (!flow.yubikeyIds.includes(otpPublicId(otp))) fail('UNKNOWN_YUBIKEY');

    let result;
    try {
      result = await yubico.verify(otp);
    } catch (err) {
      req.log.error({ err }, 'yubico validation failed');
      throw new HttpError(502, 'cannot reach the Yubico validation server');
    }
    if (!result.ok) fail(result.status);

    clearFlow(reply, flow);
    return { redirect: await finish(flow.authRequestId, flow) };
  });
};
