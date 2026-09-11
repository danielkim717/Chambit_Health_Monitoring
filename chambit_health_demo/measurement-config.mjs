// Engineering defaults, not diagnostic or normal-range thresholds.
export const CONFIG = Object.freeze({
  prepareMs: 5000, collectMs: 60000, previewMs: 30000, updateMs: 1000,
  maxAttemptMs: 120000, maxGapMs: 500, minFps: 15, targetFps: 30,
  heartBand: [0.7, 3], respirationBand: [0.1, 0.5],
  respirationAgreement: 3,
  modelPath: '/assets/face_landmarker.task',
  wasmPath: '/assets/mediapipe/wasm',
});
