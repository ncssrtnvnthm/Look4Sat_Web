import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { resolve } from 'path';
import { celestrakProxy } from './celestrakProxy';

export default defineConfig({
  base: '/Look4Sat_Web/',
  plugins: [
    react(),
    celestrakProxy(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg'],
      manifestFilename: 'manifest.json',
      workbox: {
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
        globPatterns: ['**/*.{js,css,html,wasm,svg,png,woff2}'],
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/celestrak\.org\/.*/,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'tle-data',
              expiration: { maxAgeSeconds: 86400 },
            },
          },
          {
            urlPattern: /^https:\/\/.*\.tile\.openstreetmap\.org\/.*/,
            handler: 'CacheFirst',
            options: {
              cacheName: 'map-tiles',
              expiration: { maxAgeSeconds: 604800 },
            },
          },
        ],
      },
    }),
  ],
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
      '@domain': resolve(__dirname, 'src/domain'),
      '@data': resolve(__dirname, 'src/data'),
      '@features': resolve(__dirname, 'src/features'),
      '@presentation': resolve(__dirname, 'src/presentation'),
    },
  },
  build: {
    target: 'esnext',
    outDir: 'dist',
    sourcemap: true,
  },
  server: {
    port: 3000,
  },
  worker: {
    format: 'es',
  },
});
