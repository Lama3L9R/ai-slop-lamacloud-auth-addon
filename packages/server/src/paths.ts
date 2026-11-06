/**
 * Public path of the login UI on the Zitadel domain. This is Zitadel's default Login V2 location
 * (DefaultLoginURLV2 = /ui/v2/login/login?authRequest=..., logout at /ui/v2/login/logout), so no
 * base URI needs to be configured in Zitadel. Must match `base` in packages/web/vite.config.ts.
 */
export const BASE_PATH = '/ui/v2/login';
export const API_PATH = `${BASE_PATH}/api`;
