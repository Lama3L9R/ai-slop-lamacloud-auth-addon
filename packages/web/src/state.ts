import { createSignal } from 'solid-js';
import { api } from './api.ts';

const query = new URLSearchParams(location.search);

/**
 * OIDC auth request ID; Zitadel redirects to /login?authRequest=V2_...
 * Module-level so it survives navigation between login steps.
 */
export const [authRequestId] = createSignal(rememberAuthRequest(query.get('authRequest')));

/** Keeps the auth request ID in sessionStorage so reloading a later step doesn't lose it. */
function rememberAuthRequest(fromQuery: string | null): string | undefined {
  const KEY = 'authRequest';
  try {
    if (fromQuery) sessionStorage.setItem(KEY, fromQuery);
    return fromQuery ?? sessionStorage.getItem(KEY) ?? undefined;
  } catch {
    return fromQuery ?? undefined; // storage blocked
  }
}

/** Name of the application the user is signing in to. */
export const [serviceName, setServiceName] = createSignal<string>();

/** Username suggested by the app (OIDC login_hint). */
export const [loginHint, setLoginHint] = createSignal<string>();

const id = authRequestId();
if (id) {
  api<{ appName?: string; loginHint?: string }>(`/auth-requests/${encodeURIComponent(id)}`)
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
