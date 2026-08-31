import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { resolve } from 'path';
import { celestrakProxy } from './celestrakProxy';

export default defineConfig(({ mode }) => ({
  base: mode === 'production' ? '/Look4Sat_Web/' : '/',
  plugins: [
    react(),
    celestrakProxy(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg'],
      manifestFilename: 'manifest.json',
      manifest: {
        name: 'Look4Sat Web',
        short_name: 'Look4Sat',
        description: 'Amateur radio satellite tracker and pass predictor — track 9000+ satellites with SGP4/SDP4 orbital models',
        display: 'standalone',
        orientation: 'portrait-primary',
        background_color: '#121212',
        theme_color: '#1a1a2e',
        categories: ['navigation', 'education', 'utilities'],
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
        shortcuts: [
          {
            name: 'Passes',
            short_name: 'Passes',
            url: 'passes',
            icons: [{ src: 'icons/icon-192.png', sizes: '192x192' }],
          },
          {
            name: 'Radar',
            short_name: 'Radar',
            url: 'radar',
            icons: [{ src: 'icons/icon-192.png', sizes: '192x192' }],
          },
          {
            name: 'Map',
            short_name: 'Map',
            url: 'map',
            icons: [{ src: 'icons/icon-192.png', sizes: '192x192' }],
          },
        ],
      },
      workbox: {
        maximumFileSizeToCacheInBytes: 6 * 1024 * 1024,
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
            urlPattern: /^https:\/\/tile\.openstreetmap\.org\/.*/,
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
}));
