// Runs apps/web against an in-browser Postgres instead of Supabase. `pnpm demo` from the repo root.
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

// fileURLToPath, not .pathname: the repo path may contain spaces.
const here = (p) => fileURLToPath(new URL(p, import.meta.url));
const REPO = here('../../');

const pglite = here('../node_modules/@electric-sql/pglite/dist/index.js');
if (!existsSync(pglite)) {
  throw new Error('The demo needs the sandbox dependencies. Run:  cd sandbox && npm install');
}

const webRequire = createRequire(REPO + 'apps/web/package.json');
let reactPlugin;
try {
  reactPlugin = (await import(pathToFileURL(webRequire.resolve('@vitejs/plugin-react')).href)).default;
} catch {
  throw new Error('The demo needs the web app dependencies. Run:  pnpm install');
}

export default {
  root: REPO + 'apps/web',
  // No .env files live here, so apps/web/.env (the real Supabase keys) is never loaded.
  envDir: here('./'),
  plugins: [reactPlugin()],
  define: {
    'import.meta.env.VITE_SUPABASE_URL': JSON.stringify('http://demo.invalid'),
    'import.meta.env.VITE_SUPABASE_ANON_KEY': JSON.stringify('demo'),
  },
  resolve: {
    alias: {
      '@supabase/supabase-js': here('./fake-supabase.mjs'),
      '@electric-sql/pglite': pglite,
    },
  },
  optimizeDeps: { exclude: ['@electric-sql/pglite'] },
  server: { port: 5175, strictPort: true, fs: { allow: [REPO] } },
};
