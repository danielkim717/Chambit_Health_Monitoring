// 파일 역할: 얼굴 처리 Worker 시작과 메시지 대기
// 연결과 사용: MediaPipe 호환 classic Worker에서 ES 모듈을 불러오고 로딩 중 메시지를 보관합니다.
// 파일 안내: docs/FILE_GUIDE.md
// MediaPipe 0.10.32's WASM loader uses importScripts, which needs a classic
// Worker. Keep application code in ES modules and queue messages while loading.
const pending = [];
self.onmessage = event => pending.push(event);
import('./measurement-worker.mjs').then(() => {
  for (const event of pending) self.onmessage(event);
  pending.length = 0;
}).catch(error => self.postMessage({type:'error',message:error.message}));
