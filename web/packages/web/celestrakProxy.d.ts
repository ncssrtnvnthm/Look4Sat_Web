import type { Plugin } from 'vite';
/**
 * Vite plugin that proxies Celestrak requests in dev mode.
 * Uses Node's native fetch (Node 18+) with proper headers.
 */
export declare function celestrakProxy(): Plugin;
