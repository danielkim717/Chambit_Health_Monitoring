import { CONFIG } from './measurement-config.mjs';
import { MeasurementSession } from './measurement-session.mjs';

export class MeasurementController {
  constructor(video, onEvent) {
    this.video=video;this.onEvent=onEvent;this.stream=null;this.worker=null;
    this.active=false;this.generation=0;this.cameraGeneration=0;this.cameraPending=false;
  }
  async openCamera() {
    if(this.stream)return;
    if(this.cameraPending)throw new Error('카메라를 연결하는 중입니다.');
    if(!navigator.mediaDevices?.getUserMedia)throw new Error('카메라는 localhost 또는 HTTPS에서 지원되는 브라우저로 열어 주세요.');
    this.cameraPending=true;const ticket=++this.cameraGeneration;
    let opened,cameraTimeout;
    try {
      const request=navigator.mediaDevices.getUserMedia({video:{width:{ideal:640},height:{ideal:480},frameRate:{ideal:30},facingMode:'user'},audio:false});
      request.then(stream=>{if(ticket!==this.cameraGeneration)stream.getTracks().forEach(t=>t.stop());},()=>{});
      opened=await Promise.race([request,new Promise((_,reject)=>{
        cameraTimeout=setTimeout(()=>reject(new Error('카메라 연결 시간이 초과되었습니다. 권한과 장치 상태를 확인하세요.')),20000);
      })]);
      clearTimeout(cameraTimeout);
      if(ticket!==this.cameraGeneration){opened.getTracks().forEach(t=>t.stop());return;}
      this.stream=opened;this.video.srcObject=opened;
      await this.video.play();
      if(ticket!==this.cameraGeneration)return;
      opened.getVideoTracks()[0].addEventListener('ended',()=>this.closeCamera('카메라 장치 연결이 종료되어 측정을 취소했습니다.'));
      this.onEvent({type:'camera',enabled:true});
    } catch(error) {
      if(ticket===this.cameraGeneration)this.cameraGeneration++;
      opened?.getTracks().forEach(t=>t.stop());this.stream=null;this.video.srcObject=null;
      const reasons={NotAllowedError:'카메라 권한이 거부되었습니다. 브라우저에서 권한을 허용해 주세요.',NotFoundError:'연결된 카메라가 없습니다.',NotReadableError:'다른 앱이 카메라를 사용 중이거나 카메라를 열 수 없습니다.'};
      throw new Error(reasons[error.name] || error.message);
    } finally {clearTimeout(cameraTimeout);this.cameraPending=false;}
  }
  closeCamera(reason='카메라가 꺼져 측정을 취소했습니다.') {
    this.cameraGeneration++;this.stop(reason);
    this.stream?.getTracks().forEach(t=>t.stop());this.stream=null;this.video.srcObject=null;
    this.onEvent({type:'camera',enabled:false});
  }
  stop(reason='측정을 취소했습니다.') {
    const wasActive=this.active;this.active=false;this.generation++;
    clearInterval(this.timer);clearTimeout(this.modelTimer);
    this.worker?.terminate();this.worker=null;
    if(this.socket){this.socket.onclose=null;this.socket.onerror=null;this.socket.close();this.socket=null;}
    this.captureComplete=false;
    if(this.frameRequest!=null) {
      if(this.video.cancelVideoFrameCallback)this.video.cancelVideoFrameCallback(this.frameRequest);
      else cancelAnimationFrame(this.frameRequest);
    }
    this.frameRequest=null;this.busy=false;this.demoSession?.cancel();this.demoSession=null;
    if(wasActive)this.onEvent({type:'cancelled',reason});
  }
  async start(mode='real') {
    if(this.active)return;
    if(mode==='real' && !this.stream){this.onEvent({type:'error',message:'카메라를 먼저 켜 주세요. 카메라 없이 체험하려면 데모 모드를 직접 선택해 주세요.'});return;}
    this.stop();this.active=true;const ticket=this.generation,startedAt=performance.now();
    this.onEvent({type:'starting',mode});
    if(mode==='demo'){this.startDemo(startedAt);return;}
    const fail=message=>{if(ticket!==this.generation)return;this.stop();this.onEvent({type:'error',message});};
    try {
      const health=await fetch('/api/health',{signal:AbortSignal.timeout(5000)});
      if(!health.ok)throw new Error('로컬 추론 서버를 시작해 주세요. npm start로 웹과 추론 서버를 함께 실행할 수 있습니다.');
      const status=await health.json();
      if(ticket!==this.generation)return;
      this.onEvent({type:'health',status});
      this.sessionId=null;this.revision=0;this.sequence=0;this.skipped=0;
      this.worker=new Worker(new URL('./measurement-worker.js',import.meta.url));
      this.worker.onerror=()=>fail('얼굴 분석 파일을 불러오지 못했습니다. 로컬 모델 설치와 브라우저 지원을 확인해 주세요.');
      this.modelTimer=setTimeout(()=>fail('얼굴 모델 준비 시간이 초과되었습니다. 페이지를 새로고침해 주세요.'),20000);
      this.worker.onmessage=({data})=>{
        if(ticket!==this.generation)return;
        if(data.type==='ready'){
          clearTimeout(this.modelTimer);
          const url=new URL('/api/measurement',location.href);url.protocol=location.protocol==='https:'?'wss:':'ws:';
          this.socket=new WebSocket(url);
          this.socket.onerror=()=>fail('실시간 추론 연결에 실패했습니다. 서버 상태를 확인하세요.');
          this.socket.onclose=()=>fail('추론 서버 연결이 끊겼습니다. 다시 측정해 주세요.');
          this.modelTimer=setTimeout(()=>fail('추론 연결 준비 시간이 초과되었습니다.'),10000);
          this.socket.onmessage=event=>{
            if(ticket!==this.generation)return;
            let message;
            try{message=JSON.parse(event.data);}catch{fail('서버 응답 형식이 올바르지 않습니다.');return;}
            if(message.type==='connected'){
              this.acquisitionStarted=performance.now();
              this.socket.send(JSON.stringify({type:'start',t:this.acquisitionStarted}));
            } else if(message.type==='started'){
              clearTimeout(this.modelTimer);this.sessionId=message.sessionId;this.revision=message.revision;
              this.worker.postMessage({type:'start'});
              this.capture(ticket);
              this.timer=setInterval(()=>{
                if(performance.now()-this.acquisitionStarted>150000)fail('측정 또는 최종 분석 시간이 초과되었습니다.');
              },500);
            } else if(message.type==='state'){
              if(message.sessionId!==this.sessionId)return;
              if(message.state.revision!==this.revision){
                this.revision=message.state.revision;this.onEvent({type:'reset'});
              }
              this.captureComplete=message.state.phase==='complete';
              this.onEvent(message);
              if(message.state.phase==='timeout')fail(message.state.reason);
            } else if(message.type==='analysis'){
              if(message.sessionId!==this.sessionId || message.revision!==this.revision)return;
              if(message.final)this.stop('');
              this.onEvent(message);
            } else if(message.type==='error' || message.type==='timeout')fail(message.message || message.reason);
          };
        } else if(data.type==='sample'){
          this.onEvent({type:'regions',polygons:data.polygons});
          if(!this.sessionId || this.socket?.readyState!==WebSocket.OPEN || this.captureComplete)return;
          const seq=this.sequence++;
          if(this.socket.bufferedAmount>256*1024){this.skipped++;return;}
          const header=new TextEncoder().encode(JSON.stringify({sessionId:this.sessionId,revision:this.revision,
            seq,t:data.t,rgb:data.rgb || null,reason:data.reason,scene:data.scene || {},extractionMs:data.extractionMs}));
          const pixels=data.pixels || new Uint8Array();
          const packet=new Uint8Array(4+header.length+pixels.length);
          new DataView(packet.buffer).setUint32(0,header.length,true);packet.set(header,4);packet.set(pixels,4+header.length);
          this.socket.send(packet);
        } else if(data.type==='frameDone')this.busy=false;
        else if(data.type==='error')fail(`얼굴 분석을 실행하지 못했습니다: ${data.message}`);
      };
      this.worker.postMessage({type:'init'});
    } catch(error){fail(error.message);}
  }
  capture(ticket) {
    let lastMediaTime=-1,mediaOffset=null,lastSent=-Infinity;
    const schedule=()=>{
      if(!this.active || ticket!==this.generation)return;
      this.frameRequest=this.video.requestVideoFrameCallback ? this.video.requestVideoFrameCallback(frame) : requestAnimationFrame(frame);
    };
    const frame=async (now,metadata)=>{
      schedule();
      if(this.busy || this.captureComplete || !this.active || ticket!==this.generation || this.video.readyState<2)return;
      const mediaTime=metadata?.mediaTime ?? this.video.currentTime;
      if(mediaTime===lastMediaTime || mediaTime-lastSent<1/CONFIG.targetFps-.003)return;
      lastSent=mediaTime;
      mediaOffset ??= now-mediaTime*1000;
      lastMediaTime=mediaTime;this.busy=true;
      try {
        const bitmap=await createImageBitmap(this.video);
        if(ticket!==this.generation || !this.worker){bitmap.close();return;}
        this.worker.postMessage({type:'frame',bitmap,t:mediaOffset+mediaTime*1000},[bitmap]);
      } catch(error){if(ticket===this.generation){this.stop();this.onEvent({type:'error',message:`영상 프레임을 읽지 못했습니다: ${error.message}`});}}
    };
    schedule();
  }
  startDemo(startedAt) {
    this.demoSession=new MeasurementSession(startedAt);let lastUpdate=0,lastRevision=-1;
    this.timer=setInterval(()=>{
      const now=performance.now(),state=this.demoSession.feed({t:now,rgb:[120,100,80]});
      this.onEvent({type:'state',state});
      if(state.revision!==lastRevision){lastRevision=state.revision;this.onEvent({type:'reset'});}
      if(state.phase==='timeout'){this.stop();this.onEvent({type:'error',message:state.reason});return;}
      const final=state.phase==='complete';
      if(final || now-lastUpdate>=CONFIG.updateMs) {
        lastUpdate=now;const visible=state.collectedMs>=CONFIG.previewMs;
        const result={mode:'demo',hr:visible?72:null,rr:visible?15:null,quality:visible?'good':'collecting',
          hrReason:'가상 데이터',rrReason:'가상 데이터',durationMs:state.collectedMs,fps:state.fps,
          wave:state.phase==='preparing'?[]:Array.from({length:210},(_,i)=>Math.sin(2*Math.PI*1.2*(i/30+now/1000)))};
        if(final)this.stop('');
        this.onEvent({type:'analysis',result,final});
      }
    },1000/CONFIG.targetFps);
  }
}
