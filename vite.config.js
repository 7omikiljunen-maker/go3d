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
        // Precache all JS, CSS, HTML, images
        globPatterns: ['**/*.{js,css,html,png,svg,ico,woff,woff2}'],
        // Don't intercept Firebase / Google API calls — let them go to network
        navigateFallback: 'index.html',
        navigateFallbackDenylist: [
          /^\/api\//,
          /firebasedatabase\.app/,
          /firebaseapp\.com/,
          /googleapis\.com/,
          /stripe\.com/,
        ],
      },
    }),
  ],
})
