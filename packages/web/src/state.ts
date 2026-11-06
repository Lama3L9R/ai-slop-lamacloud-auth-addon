import { createSignal } from 'solid-js';
import { api } from './api.ts';

const query = new URLSearchParams(location.search);

/** The app login being completed: Zitadel sends /login?authRequest=V2_... or ?samlRequest=V2_... */
export type AppRequest = { kind: 'oidc'; id: string } | { kind: 'saml'; id: string };

const PARAMS = { oidc: 'authRequest', saml: 'samlRequest' } as const;

/** Module-level so it survives navigation between login steps. */
export const [appRequest] = createSignal(rememberAppRequest());

/**
 * Keeps the request in sessionStorage so reloading the OTP step doesn't lose it.
 * Only the OTP page restores it: anywhere else a stored request would be stale.
 */
function rememberAppRequest(): AppRequest | undefined {
  const KEY = 'appRequest';
  const oidc = query.get(PARAMS.oidc);
  const saml = query.get(PARAMS.saml);
  const fromQuery: AppRequest | undefined = oidc
    ? { kind: 'oidc', id: oidc }
    : saml
      ? { kind: 'saml', id: saml }
      : undefined;
  try {
    if (fromQuery) sessionStorage.setItem(KEY, JSON.stringify(fromQuery));
    if (fromQuery || !location.pathname.endsWith('/otp')) return fromQuery;
    const stored = sessionStorage.getItem(KEY);
    return stored ? (JSON.parse(stored) as AppRequest) : undefined;
  } catch {
    return fromQuery; // storage blocked
  }
}

/** Request fields for API bodies: { authRequest } or { samlRequest }. */
export const appRequestFields = () => {
  const request = appRequest();
  return request ? { [PARAMS[request.kind]]: request.id } : {};
};

/** `path` with the app request kept in the query, e.g. /login?samlRequest=V2_... */
export const withAppRequest = (path: string) => {
  const request = appRequest();
  return request ? `${path}?${PARAMS[request.kind]}=${encodeURIComponent(request.id)}` : path;
};

/** Name of the application the user is signing in to. */
export const [serviceName, setServiceName] = createSignal<string>();

/** Username suggested by the app (OIDC login_hint). */
export const [loginHint, setLoginHint] = createSignal<string>();

const request = appRequest();
if (request) {
  const path = request.kind === 'oidc' ? '/auth-requests/' : '/saml-requests/';
  api<{ appName?: string; loginHint?: string }>(path + encodeURIComponent(request.id))
    .then((info) => {
      if (info.appName) setServiceName(info.appName);
      if (info.loginHint) setLoginHint(info.loginHint);
    })
    .catch(() => {
      // not fatal: the login itself reports an expired request
    });
}

// dev only: preview with http://localhost:5173/?service=Grafana
if (import.meta.env.DEV) {
  const fromQuery = query.get('service');
  if (fromQuery) setServiceName(fromQuery);
}
