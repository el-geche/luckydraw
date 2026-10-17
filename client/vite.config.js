import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

const NAVY = '#0b1324';
// Deploy base path: '/' for the Express-served app, '/<repo>/' for GitHub Pages (VITE_BASE=/luckydraw/).
const BASE = (process.env.VITE_BASE || '/').replace(/\/?$/, '/');
const u = (p) => `${BASE}${p.replace(/^\//, '')}`;

// API responses that may be served from cache when offline: public lists only.
// Everything else under /api (auth, /me, admin, receipts, audit/seed/verification bundles, exports,
// anchors, reports) is NOT matched and therefore goes straight to the network, never cached.
// (regex is inlined below because Workbox serialises these functions into sw.js without their closure)

export default defineConfig({
  base: BASE,
  plugins: [
    react(),
    VitePWA({
      registerType: 'prompt', // show "New version available" instead of silently swapping
      injectRegister: false,  // registered from src/components/Pwa.jsx
      includeAssets: ['favicon.svg', 'offline.html', 'icons/*.png', 'icons/*.svg'],
      manifest: {
        id: BASE,
        name: 'LuckyDraw',
        short_name: 'LuckyDraw',
        description: 'Provably fair, independently verifiable draws. Demo platform — no real money.',
        start_url: BASE,
        scope: BASE,
        display: 'standalone',
        orientation: 'any',
        theme_color: NAVY,
        background_color: NAVY,
        categories: ['utilities', 'finance'],
        icons: [
          ...[64, 128, 192, 256, 512].map((s) => ({ src: u(`icons/icon-${s}.png`), sizes: `${s}x${s}`, type: 'image/png', purpose: 'any' })),
          { src: u('icons/maskable-192.png'), sizes: '192x192', type: 'image/png', purpose: 'maskable' },
          { src: u('icons/maskable-512.png'), sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
        shortcuts: [
          { name: 'Upcoming draws', url: u('upcoming'), icons: [{ src: u('icons/icon-192.png'), sizes: '192x192' }] },
          { name: 'Verify a receipt', url: u('verify-receipt'), icons: [{ src: u('icons/icon-192.png'), sizes: '192x192' }] },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2,webmanifest}'],
        maximumFileSizeToCacheInBytes: 3 * 1024 * 1024,
        cleanupOutdatedCaches: true,
        // Deep links and home-screen launches resolve to the precached app shell, online or offline.
        navigateFallback: u('index.html'),
        navigateFallbackDenylist: [/^\/api\//, /^\/share\//],
        runtimeCaching: [
          {
            urlPattern: ({ url, request, sameOrigin }) => sameOrigin && request.method === 'GET' && /^\/api\/(draws(\?.*)?|upcoming(\?.*)?)$/.test(url.pathname + url.search),
            handler: 'NetworkFirst',
            method: 'GET',
            options: { cacheName: 'ld-public-api', networkTimeoutSeconds: 4, expiration: { maxEntries: 40, maxAgeSeconds: 24 * 3600 }, cacheableResponse: { statuses: [200] } },
          },
          {
            urlPattern: ({ request, url }) => request.destination === 'font' || /\.(woff2?|ttf|otf)$/.test(url.pathname),
            handler: 'CacheFirst',
            options: { cacheName: 'ld-fonts', expiration: { maxEntries: 30, maxAgeSeconds: 365 * 24 * 3600 }, cacheableResponse: { statuses: [0, 200] } },
          },
          {
            urlPattern: ({ request, url }) => request.destination === 'image' && !url.pathname.startsWith('/api/'),
            handler: 'StaleWhileRevalidate',
            options: { cacheName: 'ld-images', expiration: { maxEntries: 60, maxAgeSeconds: 30 * 24 * 3600 } },
          },
          {
            // Server-rendered share pages: network only, serious offline page if unreachable.
            urlPattern: ({ url, request }) => request.mode === 'navigate' && url.pathname.startsWith('/share/'),
            handler: 'NetworkOnly',
            options: { plugins: [{ handlerDidError: async () => (await caches.match(new URL('offline.html', self.registration.scope).href, { ignoreSearch: true })) || Response.error() }] },
          },
        ],
      },
      devOptions: { enabled: false },
    }),
  ],
  server: {
    port: 5173,
    host: true,
    proxy: { '/api': { target: process.env.API_URL || 'http://localhost:4000', changeOrigin: true }, '/share': { target: process.env.API_URL || 'http://localhost:4000', changeOrigin: true } },
  },
  preview: { port: 4173, proxy: { '/api': { target: process.env.API_URL || 'http://localhost:4000', changeOrigin: true }, '/share': { target: process.env.API_URL || 'http://localhost:4000', changeOrigin: true } } },
  optimizeDeps: { include: ['seedrandom'] },
  build: { commonjsOptions: { include: [/seedrandom/, /node_modules/] }, chunkSizeWarningLimit: 900 },
});
