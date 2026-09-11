// MediaPipe 0.10.32's WASM loader uses importScripts, which needs a classic
// Worker. Keep application code in ES modules and queue messages while loading.
const pending = [];
self.onmessage = event => pending.push(event);
import('./measurement-worker.mjs').then(() => {
  for (const event of pending) self.onmessage(event);
  pending.length = 0;
}).catch(error => self.postMessage({type:'error',message:error.message}));
