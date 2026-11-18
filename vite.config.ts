import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig(() => {
  return {
    plugins: [
      react(),
      tailwindcss(),
      VitePWA({
        registerType: 'autoUpdate',
        includeAssets: [
          'manifest.webmanifest',
          'manifest.json',
          'offline.html',
          'favicon.ico',
          'favicon-32.png',
          'icons/icon-192.png',
          'icons/icon-512.png',
          'icons/icon-512-maskable.png',
          'icons/apple-touch-icon.png',
          'icon-192.png',
          'icon-512.png',
          'icon-512-maskable.png',
          'icon-maskable-512.png',
          'apple-touch-icon.png',
          'screenshot-mobile.png',
          'screenshot-desktop.png',
        ],
        manifest: false,
        workbox: {
          cacheId: 'temple-cinema-v4',
          cleanupOutdatedCaches: true,
          skipWaiting: true,
          clientsClaim: true,
          maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
          globPatterns: ['**/*.{js,css,html,ico,png,svg,webmanifest,woff,woff2}'],
          navigateFallback: '/index.html',
          navigateFallbackDenylist: [/^\/api\//, /^\/storage\//, /^\/ws/, /^\/socket\.io\//, /^\/downloads\//],
          runtimeCaching: [
            {
              urlPattern: /\/api\/movies(\/chunked)?/i,
              method: 'POST',
              handler: 'NetworkOnly',
            },
            {
              urlPattern: /\/downloads\/.*\.apk(\?.*)?$/i,
              handler: 'NetworkOnly',
            },
            {
              urlPattern: /\/storage\/movies\/|\.(mp4|webm|mkv|mov|m4v|m3u8|ts)(\?.*)?$/i,
              handler: 'NetworkOnly',
            },
            {
              urlPattern: /\/api\/(movies|upcoming)$/i,
              handler: 'NetworkFirst',
              options: {
                cacheName: 'cinema-api-catalog-cache',
                networkTimeoutSeconds: 3,
                expiration: {
                  maxEntries: 12,
                  maxAgeSeconds: 60 * 60 * 24,
                },
                cacheableResponse: {
                  statuses: [0, 200],
                },
              },
            },
            {
              urlPattern: /\/storage\/posters\/.*/i,
              handler: 'CacheFirst',
              options: {
                cacheName: 'cinema-posters-cache',
                expiration: {
                  maxEntries: 120,
                  maxAgeSeconds: 60 * 60 * 24 * 30,
                },
                cacheableResponse: {
                  statuses: [0, 200],
                },
              },
            },
            {
              urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/i,
              handler: 'CacheFirst',
              options: {
                cacheName: 'google-fonts-cache',
                expiration: {
                  maxEntries: 10,
                  maxAgeSeconds: 60 * 60 * 24 * 365,
                },
                cacheableResponse: {
                  statuses: [0, 200],
                },
              },
            },
            {
              urlPattern: /^https:\/\/fonts\.gstatic\.com\/.*/i,
              handler: 'CacheFirst',
              options: {
                cacheName: 'gstatic-fonts-cache',
                expiration: {
                  maxEntries: 10,
                  maxAgeSeconds: 60 * 60 * 24 * 365,
                },
                cacheableResponse: {
                  statuses: [0, 200],
                },
              },
            },
          ],
        },
        devOptions: {
          enabled: true,
          type: 'module',
        },
      }),
    ],
    build: {
      rollupOptions: {
        output: {
          manualChunks(id: string) {
            if (id.includes('node_modules/three')) return 'vendor-three';
            if (id.includes('node_modules/firebase') || id.includes('node_modules/@firebase')) {
              return 'vendor-firebase';
            }
            if (
              id.includes('node_modules/react/') ||
              id.includes('node_modules/react-dom/') ||
              id.includes('node_modules/scheduler/')
            ) {
              return 'vendor-react';
            }
            return undefined;
          },
        },
      },
    },
    resolve: {
      alias: {
        '@': path.resolve(import.meta.dirname, '.'),
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify—file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
