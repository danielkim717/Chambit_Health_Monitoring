// 파일 역할: 카메라 프레임 전달과 처리 속도 기록
// 연결과 사용: 처리 중 프레임 하나와 최신 대기 프레임 하나를 관리하고 수집 통계를 계산합니다.
// 파일 안내: docs/FILE_GUIDE.md
// One frame in the Worker and at most one newer, real camera frame waiting.
// Capture timestamps are never changed and no frame is duplicated.
export class FramePump {
  constructor(send) {this.send=send;this.busy=false;this.pending=null;this.closed=false;this.replaced=0;}
  push(frame) {
    if(this.closed){frame.bitmap.close();return;}
    if(this.busy){
      if(this.pending){this.pending.bitmap.close();this.replaced++;}
      this.pending=frame;
    } else {this.busy=true;this.send(frame);}
  }
  done() {
    if(this.closed)return;
    this.busy=false;
    if(this.pending){const next=this.pending;this.pending=null;this.push(next);}
  }
  clearPending() {this.pending?.bitmap.close();this.pending=null;}
  close() {this.closed=true;this.clearPending();}
}

export class CaptureStats {
  constructor(configuredFps=0) {
    this.configuredFps=configuredFps;this.frames=0;this.processed=0;this.invalid=0;
    this.bitmapDropped=0;this.transportDropped=0;this.extraction=[];
  }
  observe(t,presentedFrames) {
    this.firstT ??= t;this.lastT=t;this.frames++;
    if(Number.isFinite(presentedFrames)){
      this.firstPresented ??= presentedFrames;this.lastPresented=presentedFrames;
    }
  }
  result(t,valid,ms) {
    this.firstResultT ??= t;this.lastResultT=t;this.processed++;
    if(!valid)this.invalid++;
    if(Number.isFinite(ms) && ms>=0){this.extraction.push(ms);if(this.extraction.length>120)this.extraction.shift();}
  }
  snapshot(replaced=0) {
    const span=this.lastT-this.firstT,resultSpan=this.lastResultT-this.firstResultT;
    const durations=[...this.extraction].sort((a,b)=>a-b);
    const round=n=>Math.round(n*10)/10;
    return {configuredFps:this.configuredFps,
      cameraFps:span>0?round((this.lastPresented===undefined?this.frames-1:this.lastPresented-this.firstPresented)*1000/span):0,
      callbackFps:span>0?round((this.frames-1)*1000/span):0,
      processedFps:resultSpan>0?round((this.processed-1)*1000/resultSpan):0,
      observedFrames:this.frames,processedFrames:this.processed,invalidFrames:this.invalid,
      bitmapDropped:this.bitmapDropped,pendingReplaced:replaced,transportDropped:this.transportDropped,
      extractionMeanMs:durations.length?round(durations.reduce((a,b)=>a+b,0)/durations.length):0,
      extractionP95Ms:durations.length?round(durations[Math.ceil(durations.length*.95)-1]):0};
  }
}

export function captureNotice(capture) {
  if(!capture || capture.processedFrames<45)return '';
  if(capture.cameraFps>0 && capture.cameraFps<24)
    return '카메라의 영상 전달 속도가 느려 측정이 어려울 수 있습니다. 카메라 설정과 다른 프로그램의 카메라 사용 여부를 확인해 주세요.';
  if(capture.cameraFps>=24 && capture.processedFps<24)
    return '영상은 들어오고 있지만 앱의 처리 속도가 느립니다. 다른 무거운 작업을 닫으면 도움이 될 수 있습니다.';
  return '';
}
