import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Config } from '../config.ts';
import { FLOW_TTL_MS, FlowStore, MAX_OTP_ATTEMPTS, type Flow } from '../flows.ts';
import { HttpError, isClientError, passwordRulesError } from '../http.ts';
import { API_PATH, BASE_PATH } from '../paths.ts';
import { rememberSession } from '../sessions.ts';
import { isYubicoOtp, otpPublicId, parsePublicIds, YubicoVerifier } from '../yubico.ts';
import {
  ZitadelError,
  type CreatedSession,
  type SessionUser,
  type ZitadelClient,
} from '../zitadel.ts';

const FLOW_COOKIE = 'lca_flow';

const loginBody = z.object({
  authRequest: z.string().min(1).optional(),
  username: z.string().trim().min(1),
  password: z.string().min(1),
});

const bindStartBody = z.object({
  username: z.string().trim().min(1),
  password: z.string().min(1),
});

const lostBody = z.object({
  username: z.string().trim().min(1),
  /** the lost key's public ID; a full OTP from it works too */
  publicId: z.string().trim().min(1),
});

const deactivateBody = z.object({
  publicId: z.string().min(1),
});

const registerBody = z.object({
  authRequest: z.string().min(1).optional(),
  username: z.string().trim().min(1),
  email: z.string().trim().min(1),
  password: z.string().min(1),
  otp: z.string().optional(),
});

const otpBody = z.object({
  otp: z.string().trim().toLowerCase(),
});

export const authRoutes: FastifyPluginAsync<{ config: Config; zitadel: ZitadelClient }> = async (
  app,
  { config, zitadel },
) => {
  const yubico = new YubicoVerifier(config.yubico);
  /** public URL of the login UI, for links in Zitadel's emails (same domain as Zitadel) */
  const uiUrl = config.zitadel.url + BASE_PATH;
  const appNames = new Map(Object.entries(config.appNames));

  const discardSession = (sessionId: string) =>
    zitadel.deleteSession(sessionId).catch((err) => {
      app.log.warn({ err, sessionId }, 'failed to delete Zitadel session');
    });

  const flows = new FlowStore((flow) => void discardSession(flow.sessionId));
  app.addHook('onClose', async () => flows.close());

  const setFlowCookie = (req: FastifyRequest, reply: FastifyReply, value: string) =>
    reply.setCookie(FLOW_COOKIE, value, {
      path: API_PATH,
      httpOnly: true,
      sameSite: 'strict',
      secure: req.protocol === 'https',
      maxAge: FLOW_TTL_MS / 1000,
    });

  const clearFlow = (reply: FastifyReply, flow: Flow) => {
    flows.delete(flow.id);
    reply.clearCookie(FLOW_COOKIE, { path: API_PATH });
  };

  /**
   * Hands the authenticated session to Zitadel and returns where the browser goes next.
   * The session is remembered in this browser so /logout can terminate it.
   */
  const finish = async (
    req: FastifyRequest,
    reply: FastifyReply,
    authRequestId: string | undefined,
    session: CreatedSession,
    loginName: string,
  ) => {
    if (!authRequestId) {
      if (config.defaultRedirectUrl) {
        rememberSession(req, reply, { id: session.sessionId, loginName });
        return config.defaultRedirectUrl;
      }
      void discardSession(session.sessionId);
      throw new HttpError(400, 'no login request, open this page from an app');
    }
    try {
      const callbackUrl = await zitadel.createCallback(authRequestId, session);
      rememberSession(req, reply, { id: session.sessionId, loginName });
      return callbackUrl;
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

  const readKeys = async (userId: string) => {
    const metadata = await zitadel.getUserMetadata(userId, config.yubico.metadataKey);
    return metadata ? parsePublicIds(metadata) : [];
  };

  const writeKeys = (userId: string, ids: string[]) =>
    // an empty value deletes the metadata entry
    zitadel.setUserMetadata(userId, config.yubico.metadataKey, ids.join(', '));

  /** Lost-key lockdown: set by the user, removed only by an admin. */
  const isLocked = async (userId: string) =>
    (await zitadel.getUserMetadata(userId, config.yubico.lockdownKey)) !== undefined;

  interface Authenticated {
    session: CreatedSession;
    user: SessionUser;
    /** public IDs of the user's bound YubiKeys */
    yubikeyIds: string[];
    /** password: Zitadel checked the password; otp: one of the user's YubiKeys checked out */
    method: 'password' | 'otp';
  }

  /**
   * Username + password, or username + Yubico OTP typed into the password field
   * (passwords are assumed never to look like a Yubico OTP, i.e. 32-48 modhex characters).
   * An OTP only counts if it comes from one of the user's bound YubiKeys: the key alone is the
   * credential. Returns a Zitadel session; on failure none is left behind.
   */
  const authenticate = async (
    req: FastifyRequest,
    username: string,
    password: string,
  ): Promise<Authenticated> => {
    const otp = password.trim().toLowerCase();
    const method = isYubicoOtp(otp) ? 'otp' : 'password';

    let session: CreatedSession;
    try {
      // OTP: only look the user up; Zitadel never sees the OTP
      session = await zitadel.createSession(
        { loginName: username },
        method === 'otp' ? undefined : password,
        {
          ip: req.ip,
          description: req.headers['user-agent'],
        },
      );
    } catch (err) {
      // 4xx covers unknown user, wrong password, locked user, ...; don't tell them apart
      if (err instanceof ZitadelError && err.status >= 400 && err.status < 500) {
        if (err.status === 401 || err.status === 403) throw err; // our service token is broken
        req.log.info({ err, username, method }, 'user or password check failed');
        throw new HttpError(401, 'invalid username or password');
      }
      throw err;
    }

    let user: SessionUser;
    let yubikeyIds: string[];
    let locked: boolean;
    try {
      user = await zitadel.getSessionUser(session.sessionId);
      [yubikeyIds, locked] = await Promise.all([readKeys(user.id), isLocked(user.id)]);
    } catch (err) {
      void discardSession(session.sessionId);
      throw err;
    }
    if (locked) {
      // lockdown: no hint that the account exists, let alone that it is locked
      req.log.info({ userId: user.id, method }, 'sign-in to locked account rejected');
      void discardSession(session.sessionId);
      throw new HttpError(401, 'invalid username or password');
    }

    if (method === 'otp') {
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
    }

    return { session, user, yubikeyIds, method };
  };

  const startFlow = (
    req: FastifyRequest,
    reply: FastifyReply,
    purpose: Flow['purpose'],
    auth: Authenticated,
    authRequestId?: string,
  ) => {
    const flow = flows.create({
      purpose,
      authRequestId,
      sessionId: auth.session.sessionId,
      sessionToken: auth.session.sessionToken,
      userId: auth.user.id,
      loginName: auth.user.loginName,
      yubikeyIds: auth.yubikeyIds,
    });
    setFlowCookie(req, reply, flow.id);
  };

  /** The pending flow of this browser, if it is for `purpose`. */
  const currentFlow = (req: FastifyRequest, purpose: Flow['purpose']) => {
    const flow = flows.get(req.cookies[FLOW_COOKIE]);
    if (!flow || flow.purpose !== purpose) {
      throw new HttpError(401, 'login expired, please sign in again', true);
    }
    return flow;
  };

  /**
   * currentFlow, plus a lockdown check: a key reported lost while a flow is pending
   * ends that flow too.
   */
  const activeFlow = async (req: FastifyRequest, reply: FastifyReply, purpose: Flow['purpose']) => {
    const flow = currentFlow(req, purpose);
    if (await isLocked(flow.userId)) {
      req.log.info({ userId: flow.userId, purpose }, 'flow of locked account ended');
      clearFlow(reply, flow);
      void discardSession(flow.sessionId);
      throw new HttpError(401, 'invalid username or password', true);
    }
    return flow;
  };

  /** Counts a failed OTP; too many end the flow. Always throws. */
  const failOtp = (req: FastifyRequest, reply: FastifyReply, flow: Flow, status: string): never => {
    req.log.info({ userId: flow.userId, status, purpose: flow.purpose }, 'yubico otp rejected');
    flow.otpAttempts++;
    if (flow.otpAttempts >= MAX_OTP_ATTEMPTS) {
      clearFlow(reply, flow);
      void discardSession(flow.sessionId);
      throw new HttpError(401, 'too many failed attempts, please sign in again', true);
    }
    throw new HttpError(401, status === 'REPLAYED_OTP' ? 'OTP already used' : 'invalid Yubico OTP');
  };

  /** Verifies a Yubico OTP with the validation server; failures go through failOtp. */
  const verifyOtp = async (req: FastifyRequest, reply: FastifyReply, flow: Flow, otp: string) => {
    let result;
    try {
      result = await yubico.verify(otp);
    } catch (err) {
      req.log.error({ err }, 'yubico validation failed');
      throw new HttpError(502, 'cannot reach the Yubico validation server');
    }
    if (!result.ok) failOtp(req, reply, flow, result.status);
  };

  // ---------- login ----------

  /**
   * - password: if the user has YubiKeys bound, the Yubico OTP step follows
   * - OTP from a bound YubiKey: logged in right away
   */
  app.post('/login', { config: rateLimit }, async (req, reply) => {
    const body = loginBody.parse(req.body);
    const auth = await authenticate(req, body.username, body.password);

    if (auth.method === 'otp' || auth.yubikeyIds.length === 0) {
      const redirect = await finish(
        req,
        reply,
        body.authRequest,
        auth.session,
        auth.user.loginName,
      );
      return { redirect };
    }
    startFlow(req, reply, 'login', auth, body.authRequest);
    return { next: 'otp' };
  });

  app.post('/otp', { config: rateLimit }, async (req, reply) => {
    const { otp } = otpBody.parse(req.body);
    const flow = await activeFlow(req, reply, 'login');
    if (!isYubicoOtp(otp)) throw new HttpError(400, 'not a valid Yubico OTP');

    if (!flow.yubikeyIds.includes(otpPublicId(otp))) failOtp(req, reply, flow, 'UNKNOWN_YUBIKEY');
    await verifyOtp(req, reply, flow, otp);

    clearFlow(reply, flow);
    return { redirect: await finish(req, reply, flow.authRequestId, flow, flow.loginName) };
  });

  // ---------- YubiKey binding ----------

  /**
   * Step 1 of binding a YubiKey, same credentials as login. Once a key is bound it outranks
   * the password: adding another key then needs an OTP from a bound key, not the password,
   * or a stolen password could bind the thief's key and skip the existing one.
   */
  app.post('/yubikey/start', { config: rateLimit }, async (req, reply) => {
    const body = bindStartBody.parse(req.body);
    const auth = await authenticate(req, body.username, body.password);

    if (auth.method === 'password' && auth.yubikeyIds.length > 0) {
      void discardSession(auth.session.sessionId);
      throw new HttpError(
        403,
        'this account already has a YubiKey, touch it in the password field instead',
      );
    }
    startFlow(req, reply, 'bind', auth);
    return { next: 'otp' };
  });

  /** Step 2 page: the keys bound right now. The flow stays open while the user manages keys. */
  app.get('/yubikey/keys', async (req, reply) => {
    const flow = await activeFlow(req, reply, 'bind');
    return { publicIds: await readKeys(flow.userId) };
  });

  /** An OTP from the new key proves possession; its public ID is added to the metadata. */
  app.post('/yubikey/bind', { config: rateLimit }, async (req, reply) => {
    const { otp } = otpBody.parse(req.body);
    const flow = await activeFlow(req, reply, 'bind');
    if (!isYubicoOtp(otp)) throw new HttpError(400, 'not a valid Yubico OTP');

    const publicId = otpPublicId(otp);
    const ids = await readKeys(flow.userId); // fresh: may have changed since step 1
    if (ids.includes(publicId)) throw new HttpError(409, 'this YubiKey is already bound');

    await verifyOtp(req, reply, flow, otp);
    const publicIds = [...ids, publicId];
    await writeKeys(flow.userId, publicIds);
    req.log.info({ userId: flow.userId, publicId }, 'yubikey bound');
    return { publicId, publicIds };
  });

  app.post('/yubikey/deactivate', { config: rateLimit }, async (req, reply) => {
    const { publicId } = deactivateBody.parse(req.body);
    const flow = await activeFlow(req, reply, 'bind');
    const ids = await readKeys(flow.userId);
    if (!ids.includes(publicId)) throw new HttpError(404, 'this YubiKey is not bound');

    const publicIds = ids.filter((id) => id !== publicId);
    await writeKeys(flow.userId, publicIds);
    req.log.info({ userId: flow.userId, publicId }, 'yubikey deactivated');
    return { publicIds };
  });

  /**
   * Lost key: username + the key's public ID puts the account into lockdown, which blocks every
   * sign-in (password or key) until an admin removes the metadata entry. Same answer whether
   * or not anything matched.
   */
  app.post('/yubikey/lost', { config: rateLimit }, async (req) => {
    const body = lostBody.parse(req.body);
    const publicId = parsePublicIds(body.publicId)[0];

    try {
      // a session checked only for the user is the same lookup as the login uses
      const session = await zitadel.createSession({ loginName: body.username }, undefined);
      let userId: string;
      try {
        userId = (await zitadel.getSessionUser(session.sessionId)).id;
      } finally {
        void discardSession(session.sessionId);
      }
      const [ids, locked] = await Promise.all([readKeys(userId), isLocked(userId)]);
      if (publicId && ids.includes(publicId) && !locked) {
        await zitadel.setUserMetadata(
          userId,
          config.yubico.lockdownKey,
          `${publicId} reported lost at ${new Date().toISOString()}`,
        );
        req.log.warn({ userId, publicId }, 'account locked: yubikey reported lost');
      } else {
        req.log.info({ userId, publicId, locked }, 'lost yubikey report did not match');
      }
    } catch (err) {
      if (!isClientError(err) || err.status === 401 || err.status === 403) throw err;
      req.log.info({ err, username: body.username }, 'lost yubikey report for unknown user');
    }
    return { done: true };
  });

  // ---------- registration ----------

  const registrationOrg = config.registration.organizationId;

  app.get('/registration', async () => ({ enabled: Boolean(registrationOrg) }));

  /**
   * Creates the account; a Yubico OTP (optional) binds that key right away, which turns on
   * YubiKey sign-in. With an auth request the user is then signed in to the app directly.
   */
  app.post('/register', { config: rateLimit }, async (req, reply) => {
    if (!registrationOrg) throw new HttpError(403, 'registration is not available yet');
    const body = registerBody.parse(req.body);
    const otp = body.otp?.trim().toLowerCase();
    if (!z.email().safeParse(body.email).success) {
      throw new HttpError(400, 'not a valid email address');
    }

    let publicId: string | undefined;
    if (otp) {
      if (!isYubicoOtp(otp)) throw new HttpError(400, 'not a valid Yubico OTP');
      let result;
      try {
        result = await yubico.verify(otp);
      } catch (err) {
        req.log.error({ err }, 'yubico validation failed');
        throw new HttpError(502, 'cannot reach the Yubico validation server');
      }
      if (!result.ok) {
        throw new HttpError(
          400,
          result.status === 'REPLAYED_OTP' ? 'OTP already used' : 'invalid Yubico OTP',
        );
      }
      publicId = otpPublicId(otp);
    }

    let userId: string;
    try {
      ({ id: userId } = await zitadel.createHumanUser({
        organizationId: registrationOrg,
        username: body.username,
        email: body.email,
        password: body.password,
        emailUrlTemplate: `${uiUrl}/verify?userId={{.UserID}}&code={{.Code}}`,
        ...(publicId && { metadata: { [config.yubico.metadataKey]: publicId } }),
      }));
    } catch (err) {
      const weak = await passwordRulesError(err, zitadel, registrationOrg);
      if (weak) throw weak;
      if (err instanceof ZitadelError && err.status === 409) {
        throw new HttpError(409, 'username or email is already taken');
      }
      if (isClientError(err) && err.status !== 401 && err.status !== 403) {
        req.log.info({ err }, 'registration rejected');
        throw new HttpError(400, 'cannot create this account, check your input');
      }
      throw err;
    }
    req.log.info({ userId, yubikey: Boolean(publicId) }, 'user registered');

    if (!body.authRequest) return { registered: true };
    // password and (optional) key were both just checked: sign in without another step
    const session = await zitadel.createSession({ userId }, body.password, {
      ip: req.ip,
      description: req.headers['user-agent'],
    });
    return { redirect: await finish(req, reply, body.authRequest, session, body.username) };
  });
};
