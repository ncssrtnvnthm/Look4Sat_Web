// ── Wasm bridge: calls Kotlin/Wasm SGP4 functions exposed as globals ──
// domain.js is loaded via <script> in index.html — UMD bundle sets window.*
// The .wasm file is in public/wasm/ alongside domain.js for correct MIME type.

import type { WasmOrbitalPos, WasmSunPosition, WasmMoonPosition, WasmPass } from './wasmTypes';

interface WasmModule {
  look4satGetPosition(orbitalDataJson: string, lat: number, lon: number, alt: number, timeMs: number): string;
  look4satWillBeSeen(orbitalDataJson: string, lat: number, lon: number): boolean;
  look4satGetSunPosition(lat: number, lon: number, timeMs: number): string;
  look4satGetMoonPosition(lat: number, lon: number, timeMs: number): string;
  look4satCalculatePasses(orbitalDataJson: string, lat: number, lon: number, alt: number, startTimeMs: number, endTimeMs: number, minElevation: number): string;
}

function getWasmNow(): WasmModule | null {
  const w = window as unknown as Record<string, unknown>;
  const domainMod = w['domain'];
  if (!domainMod || typeof domainMod !== 'object') return null;

  let obj: unknown = domainMod;
  for (const part of ['com', 'rtbishop', 'look4sat', 'core', 'domain']) {
    if (obj && typeof obj === 'object') {
      obj = (obj as Record<string, unknown>)[part];
    } else return null;
  }

  if (obj && typeof obj === 'object') {
    const ns = obj as Record<string, unknown>;
    if (typeof ns.look4satGetPosition === 'function') return ns as unknown as WasmModule;
  }
  return null;
}

function waitForWasm(): Promise<WasmModule | null> {
  return new Promise((resolve) => {
    const existing = getWasmNow();
    if (existing) { resolve(existing); return; }
    let attempts = 0;
    const iv = setInterval(() => {
      const w = getWasmNow();
      if (w) { clearInterval(iv); resolve(w); return; }
      if (++attempts > 50) { clearInterval(iv); console.warn('[wasm] SGP4/SDP4 load timed out'); resolve(null); }
    }, 100);
  });
}

function getWasm(): Promise<WasmModule | null> {
  return waitForWasm();
}

// ── Public API — same signatures as before, direct calls (no worker) ──

export async function getPosition(
  orbitalDataJson: string, lat: number, lon: number, alt: number, timeMs: number,
): Promise<{ type: 'getPosition'; result: WasmOrbitalPos | null } | { type: 'error' }> {
  const w = await getWasm();
  if (!w) return { type: 'error' };
  try {
    const json = w.look4satGetPosition(orbitalDataJson, lat, lon, alt, timeMs);
    if (json === 'null') {
      console.warn('[wasm] getPosition returned null');
      return { type: 'getPosition', result: null };
    }
    const result: WasmOrbitalPos = JSON.parse(json);
    return { type: 'getPosition', result };
  } catch (e) {
    console.error('[wasm] getPosition error:', e);
    return { type: 'error' };
  }
}

export async function willBeSeen(orbitalDataJson: string, lat: number, lon: number) {
  const w = await getWasm();
  if (!w) return { type: 'error' as const };
  try {
    return { type: 'willBeSeen' as const, result: w.look4satWillBeSeen(orbitalDataJson, lat, lon) };
  } catch { return { type: 'error' as const }; }
}

export async function getSunPosition(lat: number, lon: number, timeMs: number) {
  const w = await getWasm();
  if (!w) return { type: 'error' as const };
  try {
    const result: WasmSunPosition = JSON.parse(w.look4satGetSunPosition(lat, lon, timeMs));
    return { type: 'getSunPosition' as const, result };
  } catch { return { type: 'error' as const }; }
}

export async function getMoonPosition(lat: number, lon: number, timeMs: number) {
  const w = await getWasm();
  if (!w) return { type: 'error' as const };
  try {
    const result: WasmMoonPosition = JSON.parse(w.look4satGetMoonPosition(lat, lon, timeMs));
    return { type: 'getMoonPosition' as const, result };
  } catch { return { type: 'error' as const }; }
}

export async function calculatePasses(
  orbitalDataJson: string, lat: number, lon: number, alt: number,
  startTimeMs: number, endTimeMs: number, minElevation: number,
) {
  const w = await getWasm();
  if (!w) return { type: 'error' as const };
  try {
    const json = w.look4satCalculatePasses(orbitalDataJson, lat, lon, alt, startTimeMs, endTimeMs, minElevation);
    const parsed = JSON.parse(json) as { passes: WasmPass[] };
    return { type: 'calculatePasses' as const, result: parsed.passes };
  } catch (e) {
    console.error('[wasm] calculatePasses error:', e);
    return { type: 'error' as const };
  }
}
