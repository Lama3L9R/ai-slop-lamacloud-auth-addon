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

  // ---------- sessions ----------

  /**
   * Creates a session for `loginName`. With `password` set, the password is checked too
   * (failures count towards Zitadel's lockout policy).
   */
  async createSession(
    loginName: string,
    password: string | undefined,
    userAgent?: UserAgent,
  ): Promise<CreatedSession> {
    return this.request<CreatedSession>('POST', '/v2/sessions', {
      checks: {
        user: { loginName },
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

  /** Returns the decoded metadata value for `key`, or undefined if the user has none. */
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

  // ---------- applications ----------

  /** Display name of the OIDC application with this client ID (connect endpoint, no REST mapping). */
  async getAppName(clientId: string): Promise<string | undefined> {
    const res = await this.request<{ applications?: { name?: string }[] }>(
      'POST',
      '/zitadel.application.v2.ApplicationService/ListApplications',
      { filters: [{ clientIdFilter: { clientId } }] },
    );
    return res.applications?.[0]?.name || undefined;
  }
}
