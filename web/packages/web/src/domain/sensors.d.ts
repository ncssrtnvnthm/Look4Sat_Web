// ── Browser Sensor API and iOS-only orientation types ──
// The absolute-orientation sensor is available in Chromium; the legacy
// iOS fields are non-standard extensions of DeviceOrientationEvent.

interface AbsoluteOrientationSensor extends EventTarget {
  readonly quaternion: [number, number, number, number] | null;
  start(): void;
  stop(): void;
}

declare var AbsoluteOrientationSensor: {
  prototype: AbsoluteOrientationSensor;
  new (options?: { frequency?: number }): AbsoluteOrientationSensor;
};

interface DeviceOrientationEvent {
  webkitCompassHeading?: number;
  webkitCompassAccuracy?: number;
}
