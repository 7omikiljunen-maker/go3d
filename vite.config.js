import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  // '/' because custom domain go3dgame.com is connected.
  base: '/',
  // Emit source maps so production stack traces show real function names
  // and line numbers (not xS/ES/Uy). Adds ~one .map file per JS chunk;
  // browsers only download them when DevTools is open, so zero impact for users.
  build: { sourcemap: true },
  plugins: [
    VitePWA({
      registerType: 'autoUpdate',
      // Use our existing public/manifest.json — don't generate a new one
      manifest: false,
      workbox: {
        // Precache all JS, CSS, HTML, images + manifest.json (json was missing,
        // so an offline manifest re-fetch used to miss the cache)
        globPatterns: ['**/*.{js,css,html,png,svg,ico,json,woff,woff2}'],
        // The 887 KB original icon.png is only fetched by social-card crawlers
        // (og:image) — the app itself uses /icons/*. Keep it out of the precache.
        globIgnores: ['icon.png'],
        // Activate new SWs immediately — no waiting for old tabs to close
        skipWaiting: true,
        clientsClaim: true,
        // NOTE: no runtimeCaching here, deliberately. The SW is precache-only:
        // Firebase RTDB/auth/analytics and Stripe are cross-origin (and RTDB is
        // a WebSocket), so the SW never touches them — multiplayer, payment and
        // the paid-entitlement read can never be served stale from cache.
        navigateFallback: 'index.html',
        navigateFallbackDenylist: [
          /[?&]join=/,           // challenge links — bypass cache so ?join= param is preserved
          /^\/api\//,            // any future same-origin API must never get the app shell
        ],
      },
    }),
  ],
})
