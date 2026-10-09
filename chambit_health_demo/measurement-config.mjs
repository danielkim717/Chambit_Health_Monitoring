// 파일 역할: 브라우저 측정 시간과 조건 설정
// 연결과 사용: 준비·수집·프레임 간격 등 화면과 처리 코드가 공유하는 기본값을 정의합니다.
// 파일 안내: docs/FILE_GUIDE.md
// Engineering defaults, not diagnostic or normal-range thresholds.
export const CONFIG = Object.freeze({
  prepareMs: 5000, collectMs: 60000, previewMs: 20000, respirationPreviewMs: 35000, updateMs: 1000,
  maxAttemptMs: 120000, maxGapMs: 500, minFps: 15, targetFps: 30,
  heartBand: [0.7, 3], respirationBand: [0.1, 0.5],
  respirationAgreement: 3,
  modelPath: '/assets/face_landmarker.task',
  wasmPath: '/assets/mediapipe/wasm',
});
