// ── Web Worker for SGP4/SDP4 orbital computation ──
// Uses the real Kotlin/Wasm module compiled from core:domain/predict/.
// Falls back to a mock if the Wasm module fails to load.

import type { WorkerRequest, WorkerResponse, WasmOrbitalPos, WasmSunPosition, WasmMoonPosition, WasmPass } from './wasmTypes';

// ── Wasm module interface ──

interface WasmExports {
  look4satGetPosition(orbitalDataJson: string, lat: number, lon: number, alt: number, timeMs: number): string;
  look4satWillBeSeen(orbitalDataJson: string, lat: number, lon: number): boolean;
  look4satGetSunPosition(lat: number, lon: number, timeMs: number): string;
  look4satGetMoonPosition(lat: number, lon: number, timeMs: number): string;
  look4satCalculatePasses(orbitalDataJson: string, lat: number, lon: number, alt: number, startTimeMs: number, endTimeMs: number, minElevation: number): string;
}

// ── Load the real Kotlin/Wasm module ──

let wasmReady = false;
const wasmPromise: Promise<WasmExports> = (async () => {
  try {
    const mod = await import('../wasm/domain.js');
    console.log('[worker] Wasm module loaded, keys:', Object.keys(mod));

    // Kotlin/Wasm webpack bundles may export under default, or as direct properties
    let exports: Record<string, unknown> = mod as unknown as Record<string, unknown>;

    // Try default export first (common with some webpack configs)
    if (mod.default && typeof mod.default === 'object') {
      console.log('[worker] Trying mod.default, keys:', Object.keys(mod.default as object));
      exports = mod.default as Record<string, unknown>;
    }

    // Check if functions are available
    const hasFns = typeof exports.look4satGetPosition === 'function';
    console.log('[worker] look4satGetPosition found:', hasFns, 'type:', typeof exports.look4satGetPosition);

    if (hasFns) {
      wasmReady = true;
      console.log('[worker] Loaded real SGP4/SDP4 Wasm module');
      return exports as unknown as WasmExports;
    }

    // Functions might need the wasm module initialized first — check for an init function
    if (typeof (mod as Record<string, unknown>).init === 'function') {
      console.log('[worker] Calling init()...');
      await (mod as Record<string, () => Promise<void>>).init();
      console.log('[worker] After init, keys:', Object.keys(mod));
    }

    console.warn('[worker] Wasm exports not found, falling back to stub. Module keys:', Object.keys(mod).slice(0, 20));
    return createMock();
  } catch (err) {
    console.warn('[worker] Wasm load failed:', err);
    return createMock();
  }
})();

// ── Minimal fallback (only used if Wasm fails to load) ──

function createMock(): WasmExports {
  return {
    look4satGetPosition(): string { return 'null'; },
    look4satWillBeSeen(): boolean { return false; },
    look4satGetSunPosition(): string { return JSON.stringify({ azimuth: 0, elevation: 0, latitude: 0, longitude: 0 }); },
    look4satGetMoonPosition(): string { return JSON.stringify({ azimuth: 0, elevation: 0, latitude: 0, longitude: 0 }); },
    look4satCalculatePasses(): string { return JSON.stringify({ passes: [] }); },
  };
}

// ── Message handler ──

self.onmessage = async (e: MessageEvent<WorkerRequest>) => {
  const req = e.data;
  try {
    const wasm = await wasmPromise;
    let response: WorkerResponse;

    switch (req.type) {
      case 'getPosition': {
        const json = wasm.look4satGetPosition(req.orbitalDataJson, req.lat, req.lon, req.alt, req.timeMs);
        const result: WasmOrbitalPos | null = json === 'null' ? null : JSON.parse(json);
        response = { id: req.id, type: 'getPosition', result };
        break;
      }
      case 'willBeSeen': {
        response = { id: req.id, type: 'willBeSeen', result: wasm.look4satWillBeSeen(req.orbitalDataJson, req.lat, req.lon) };
        break;
      }
      case 'getSunPosition': {
        const result: WasmSunPosition = JSON.parse(wasm.look4satGetSunPosition(req.lat, req.lon, req.timeMs));
        response = { id: req.id, type: 'getSunPosition', result };
        break;
      }
      case 'getMoonPosition': {
        const result: WasmMoonPosition = JSON.parse(wasm.look4satGetMoonPosition(req.lat, req.lon, req.timeMs));
        response = { id: req.id, type: 'getMoonPosition', result };
        break;
      }
      case 'calculatePasses': {
        const json = wasm.look4satCalculatePasses(req.orbitalDataJson, req.lat, req.lon, req.alt, req.startTimeMs, req.endTimeMs, req.minElevation);
        const parsed = JSON.parse(json) as { passes: WasmPass[] };
        response = { id: req.id, type: 'calculatePasses', result: parsed.passes };
        break;
      }
      default:
        throw new Error(`Unknown request type: ${(req as WorkerRequest).type}`);
    }

    self.postMessage(response);
  } catch (err) {
    self.postMessage({ id: req.id, type: 'error', error: String(err) } as WorkerResponse);
  }
};
