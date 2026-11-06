/**
 * Minimal client for the Zitadel v2 APIs used by a custom login UI.
 * Authenticates with the PAT of a service user that has the IAM_LOGIN_CLIENT role.
 *
 * Docs: https://zitadel.com/docs/guides/integrate/login-ui
 */

export class ZitadelError extends Error {
  status: number;
  /** gRPC status code from the response body, if any */
  code: number | undefined;

  constructor(status: number, message: string, code?: number) {
    super(message);
    this.name = 'ZitadelError';
    this.status = status;
    this.code = code;
  }
}

export interface AuthRequest {
  id: string;
  clientId: string;
  scope?: string[];
  redirectUri?: string;
  loginHint?: string;
  hintUserId?: string;
}

export interface SamlRequest {
  id: string;
  /** entity ID of the service provider */
  issuer: string;
  assertionConsumerService: string;
  relayState?: string;
  binding?: string;
}

/** Where the browser goes after a SAML login: a plain redirect, or a form POST to `url`. */
export interface SamlResponse {
  url: string;
  redirect?: Record<string, never>;
  post?: { relayState?: string; samlResponse: string };
}

export interface SessionUser {
  id: string;
  loginName: string;
  displayName?: string;
  organizationId: string;
}

export interface CreatedSession {
  sessionId: string;
  sessionToken: string;
}

export interface PasswordComplexity {
  /** uint64, a string in JSON */
  minLength?: string | number;
  requiresUppercase?: boolean;
  requiresLowercase?: boolean;
  requiresNumber?: boolean;
  requiresSymbol?: boolean;
}

interface Application {
  name?: string;
  samlConfiguration?: { metadataXml?: string; metadataUrl?: string };
}

export interface UserAgent {
  ip?: string;
  description?: string;
}

export class ZitadelClient {
  private readonly baseUrl: string;
  private readonly token: string;

  constructor(baseUrl: string, token: string) {
    this.baseUrl = baseUrl;
    this.token = token;
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await fetch(this.baseUrl + path, {
      method,
      headers: {
        authorization: `Bearer ${this.token}`,
        accept: 'application/json',
        ...(body !== undefined && { 'content-type': 'application/json' }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    });
    const text = await res.text();
    const json = text ? (JSON.parse(text) as Record<string, unknown>) : {};
    if (!res.ok) {
      throw new ZitadelError(
        res.status,
        typeof json.message === 'string' ? json.message : `HTTP ${res.status}`,
        typeof json.code === 'number' ? json.code : undefined,
      );
    }
    return json as T;
  }

  // ---------- OIDC ----------

  async getAuthRequest(authRequestId: string): Promise<AuthRequest> {
    const res = await this.request<{ authRequest: AuthRequest }>(
      'GET',
      `/v2/oidc/auth_requests/${encodeURIComponent(authRequestId)}`,
    );
    return res.authRequest;
  }

  /** Links an authenticated session to the auth request; returns the URL to send the browser to. */
  async createCallback(authRequestId: string, session: CreatedSession): Promise<string> {
    const res = await this.request<{ callbackUrl: string }>(
      'POST',
      `/v2/oidc/auth_requests/${encodeURIComponent(authRequestId)}`,
      { session: { sessionId: session.sessionId, sessionToken: session.sessionToken } },
    );
    return res.callbackUrl;
  }

  // ---------- SAML ----------

  async getSamlRequest(samlRequestId: string): Promise<SamlRequest> {
    const res = await this.request<{ samlRequest: SamlRequest }>(
      'GET',
      `/v2/saml/saml_requests/${encodeURIComponent(samlRequestId)}`,
    );
    return res.samlRequest;
  }

  /** Links an authenticated session to the SAML request; returns the response for the SP. */
  async createSamlResponse(samlRequestId: string, session: CreatedSession): Promise<SamlResponse> {
    return this.request<SamlResponse>(
      'POST',
      `/v2/saml/saml_requests/${encodeURIComponent(samlRequestId)}`,
      { session: { sessionId: session.sessionId, sessionToken: session.sessionToken } },
    );
  }

  // ---------- sessions ----------

  /**
   * Creates a session for a user. With `password` set, the password is checked too
   * (failures count towards Zitadel's lockout policy).
   */
  async createSession(
    user: { loginName: string } | { userId: string },
    password: string | undefined,
    userAgent?: UserAgent,
  ): Promise<CreatedSession> {
    return this.request<CreatedSession>('POST', '/v2/sessions', {
      checks: {
        user,
        ...(password !== undefined && { password: { password } }),
      },
      ...(userAgent && { userAgent }),
    });
  }

  async getSessionUser(sessionId: string): Promise<SessionUser> {
    const res = await this.request<{ session: { factors?: { user?: SessionUser } } }>(
      'GET',
      `/v2/sessions/${encodeURIComponent(sessionId)}`,
    );
    const user = res.session.factors?.user;
    if (!user) throw new ZitadelError(500, 'session has no user factor');
    return user;
  }

  async deleteSession(sessionId: string): Promise<void> {
    await this.request('DELETE', `/v2/sessions/${encodeURIComponent(sessionId)}`, {});
  }

  // ---------- users ----------

  /**
   * Looks a user up by login name the way the login does (a session checked only for the
   * user, deleted right away). Returns the user ID, undefined if Zitadel rejects the name;
   * other errors throw.
   */
  async findUser(loginName: string): Promise<string | undefined> {
    let session: CreatedSession;
    try {
      session = await this.createSession({ loginName }, undefined);
    } catch (err) {
      const rejected =
        err instanceof ZitadelError &&
        err.status >= 400 &&
        err.status < 500 &&
        err.status !== 401 &&
        err.status !== 403;
      if (rejected) return undefined;
      throw err;
    }
    try {
      return (await this.getSessionUser(session.sessionId)).id;
    } finally {
      void this.deleteSession(session.sessionId).catch(() => {});
    }
  }

  /**
   * Creates a human user. Zitadel emails a verification link built from `emailUrlTemplate`
   * ({{.UserID}} and {{.Code}} are filled in).
   */
  async createHumanUser(user: {
    organizationId: string;
    username: string;
    email: string;
    password: string;
    emailUrlTemplate: string;
    metadata?: Record<string, string>;
  }): Promise<{ id: string }> {
    return this.request<{ id: string }>('POST', '/v2/users/new', {
      organizationId: user.organizationId,
      username: user.username,
      human: {
        profile: {
          givenName: user.username,
          familyName: user.username,
          displayName: user.username,
        },
        email: { email: user.email, sendCode: { urlTemplate: user.emailUrlTemplate } },
        password: { password: user.password, changeRequired: false },
        metadata: Object.entries(user.metadata ?? {}).map(([key, value]) => ({
          key,
          value: Buffer.from(value, 'utf8').toString('base64'),
        })),
      },
    });
  }

  async verifyEmail(userId: string, code: string): Promise<void> {
    await this.request('POST', `/v2/users/${encodeURIComponent(userId)}/email/verify`, {
      verificationCode: code,
    });
  }

  /** Emails the user a password reset link built from `urlTemplate` ({{.UserID}}, {{.Code}}). */
  async requestPasswordReset(userId: string, urlTemplate: string): Promise<void> {
    await this.request('POST', `/v2/users/${encodeURIComponent(userId)}/password_reset`, {
      sendLink: { notificationType: 'NOTIFICATION_TYPE_Email', urlTemplate },
    });
  }

  async setPasswordWithCode(userId: string, code: string, password: string): Promise<void> {
    await this.request('POST', `/v2/users/${encodeURIComponent(userId)}/password`, {
      newPassword: { password, changeRequired: false },
      verificationCode: code,
    });
  }

  /** Password rules of an organization (or the instance defaults). */
  async getPasswordComplexity(orgId?: string): Promise<PasswordComplexity> {
    const query = orgId ? `?ctx.orgId=${encodeURIComponent(orgId)}` : '?ctx.instance=true';
    const res = await this.request<{ settings: PasswordComplexity }>(
      'GET',
      `/v2/settings/password/complexity${query}`,
    );
    return res.settings;
  }

  // ---------- metadata ----------

  /**
   * Returns the decoded metadata value for `key`, or undefined if the user has none.
   * A search: a missing entry is an empty result, so errors are never read as "no metadata".
   */
  async getUserMetadata(userId: string, key: string): Promise<string | undefined> {
    const res = await this.request<{ metadata?: { key: string; value: string }[] }>(
      'POST',
      `/v2/users/${encodeURIComponent(userId)}/metadata/search`,
      { filters: [{ keyFilter: { key, method: 'TEXT_FILTER_METHOD_EQUALS' } }] },
    );
    const entry = res.metadata?.find((m) => m.key === key);
    // metadata values are bytes, base64 encoded in JSON
    return entry ? Buffer.from(entry.value, 'base64').toString('utf8') : undefined;
  }

  /** Sets (overwrites) one metadata entry of a user; an empty value deletes it. */
  async setUserMetadata(userId: string, key: string, value: string): Promise<void> {
    const path = `/v2/users/${encodeURIComponent(userId)}/metadata`;
    if (value) {
      const encoded = Buffer.from(value, 'utf8').toString('base64');
      await this.request('POST', path, { metadata: [{ key, value: encoded }] });
    } else {
      await this.request('DELETE', `${path}?keys=${encodeURIComponent(key)}`);
    }
  }

  // ---------- applications ----------
  // ListApplications is a connect endpoint without a REST mapping.

  private listApplications(filters: unknown[]) {
    return this.request<{ applications?: Application[] }>(
      'POST',
      '/zitadel.application.v2.ApplicationService/ListApplications',
      { filters, pagination: { limit: 1000 } },
    );
  }

  /** Display name of the OIDC application with this client ID. */
  async getAppName(clientId: string): Promise<string | undefined> {
    const res = await this.listApplications([{ clientIdFilter: { clientId } }]);
    return res.applications?.[0]?.name || undefined;
  }

  /**
   * Display names of all SAML applications by entity ID (the issuer of their SAML requests).
   * The API has no entity ID filter, so the IDs come from the stored SP metadata.
   */
  async getSamlAppNames(): Promise<Map<string, string>> {
    const res = await this.listApplications([{ typeFilter: 'APPLICATION_TYPE_SAML' }]);
    const names = new Map<string, string>();
    for (const app of res.applications ?? []) {
      const xml = app.samlConfiguration?.metadataXml;
      if (!xml || !app.name) continue;
      const entityId = /entityID\s*=\s*"([^"]+)"/.exec(
        Buffer.from(xml, 'base64').toString('utf8'),
      )?.[1];
      if (entityId) names.set(entityId, app.name);
    }
    return names;
  }
}
