import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      // manifest.webmanifest and its icons already live in public/, hand-authored
      // to match index.html's iOS meta tags - generating a second manifest here
      // would just be a second source of truth to keep in sync with the first.
      manifest: false,
      workbox: {
        navigateFallback: '/index.html',
        globPatterns: ['**/*.{js,css,html,png,svg,ico,webmanifest}'],
        // Never cache a Supabase response. Odds, balances and bets change by the
        // second, and this is a betting app - a cached "you have $500" is a bug,
        // not a convenience. Only the app shell (JS/CSS/icons) is precached, so
        // the shell loads instantly offline but every real read or write still
        // needs a connection and fails loudly instead of showing stale money.
        runtimeCaching: [
          {
            urlPattern: ({ url }) => url.hostname.endsWith('.supabase.co'),
            handler: 'NetworkOnly',
          },
        ],
      },
    }),
  ],
  server: {
    port: 5173,
  },
});
