// Compiles apps/web/src/lib into a single bundle the harness can import,
// with @supabase/supabase-js pointed at the PGlite-backed stand-in.
import { build } from 'esbuild';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// fileURLToPath, not .pathname - the repo path may contain spaces,
// which .pathname would percent-encode into a path that does not exist.
const root = fileURLToPath(new URL('../', import.meta.url));

await build({
  entryPoints: [root + 'apps/web/src/lib/index.ts'],
  bundle: true,
  outfile: fileURLToPath(new URL('./lib/index.js', import.meta.url)),
  format: 'esm',
  platform: 'node',
  target: 'node22',
  external: ['@supabase/supabase-js'],
  define: {
    'import.meta.env': JSON.stringify({
      VITE_SUPABASE_URL: 'http://sandbox',
      VITE_SUPABASE_ANON_KEY: 'sandbox',
    }),
  },
});

// Resolve @supabase/supabase-js to the fake client.
const stub = fileURLToPath(new URL('./node_modules/@supabase/supabase-js/', import.meta.url));
mkdirSync(stub, { recursive: true });
writeFileSync(stub + 'package.json', JSON.stringify(
  { name: '@supabase/supabase-js', version: '0.0.0-sandbox', type: 'module', main: 'index.mjs' }));
writeFileSync(stub + 'index.mjs', `export { createClient } from '../../../fakeclient.mjs';\n`);
