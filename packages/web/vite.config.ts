import { defineConfig } from 'vite';
import solid from 'vite-plugin-solid';

// Zitadel's default Login V2 location on its own domain; must match BASE_PATH in
// packages/server/src/paths.ts. Dev: http://localhost:5173/ui/v2/login/
const BASE = '/ui/v2/login';
const SERVER = 'http://127.0.0.1:3000';

export default defineConfig({
  base: `${BASE}/`,
  plugins: [solid()],
  server: {
    port: 5173,
    proxy: {
      [`${BASE}/api`]: SERVER,
      // /logout is handled by the server (it redirects); /logout/done is a UI page
      [`^${BASE}/logout(\\?.*)?$`]: SERVER,
    },
  },
  build: {
    target: 'es2022',
  },
});
