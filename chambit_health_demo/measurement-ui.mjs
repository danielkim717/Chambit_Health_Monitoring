import { CONFIG } from './measurement-config.mjs';
import { MeasurementController } from './measurement-controller.mjs';

export function mountMeasurement({onReset,onContinue}) {
  const el=id=>document.getElementById(id), video=el('video');
  let mode='real',result=null;
  const wave=el('waveCanvas'),ctx=wave.getContext('2d'),overlay=el('roiCanvas');
  const clock=ms=>`${String(Math.floor(ms/60000)).padStart(2,'0')}:${String(Math.floor(ms/1000)%60).padStart(2,'0')}`;
  const label=()=>mode==='demo'?'가상 데이터 · 데모':'실제 웹캠 추정';
  function drawWave(values=[]) {
    ctx.clearRect(0,0,wave.width,wave.height);ctx.strokeStyle='#e7edf5';ctx.lineWidth=1;
    for(let y=25;y<wave.height;y+=40){ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(wave.width,y);ctx.stroke();}
    if(values.length<2)return;
    const max=Math.max(...values.map(Math.abs),1e-9);ctx.beginPath();ctx.strokeStyle=mode==='demo'?'#b77812':'#2878ff';ctx.lineWidth=2;
    values.forEach((v,i)=>{const x=i/(values.length-1)*wave.width,y=wave.height/2-v/max*wave.height*0.4;if(i)ctx.lineTo(x,y);else ctx.moveTo(x,y);});ctx.stroke();
  }
  function drawRegions(polygons=[]) {
    overlay.width=overlay.clientWidth;overlay.height=overlay.clientHeight;
    const c=overlay.getContext('2d');c.clearRect(0,0,overlay.width,overlay.height);
    if(!video.videoWidth)return;
    const scale=Math.max(overlay.width/video.videoWidth,overlay.height/video.videoHeight);
    const w=video.videoWidth*scale,h=video.videoHeight*scale,dx=(overlay.width-w)/2,dy=(overlay.height-h)/2;
    c.strokeStyle='#44d38b';c.fillStyle='rgba(68,211,139,.12)';c.lineWidth=2;
    for(const points of polygons){c.beginPath();points.forEach((p,i)=>{const x=overlay.width-(dx+p.x*w),y=dy+p.y*h;if(i)c.lineTo(x,y);else c.moveTo(x,y);});c.closePath();c.fill();c.stroke();}
  }
  function showValues(r,final=false) {
    const val=x=>x==null?'--':String(Math.round(x));
    el('hrValue').textContent=val(r.hr);el('rrValue').textContent=val(r.rr);
    el('hrState').textContent=r.hr===null?(final?'측정 불가':'신호 수집 중'):(mode==='demo'?'가상 데이터':final?'심박수 추정값':'중간 추정값');
    el('rrState').textContent=r.rr===null?(final?'측정 불가':'신호 수집 중'):(mode==='demo'?'가상 데이터':final?'호흡수 추정값':'중간 추정값');
    el('qualityDetails').textContent=[r.hr===null?r.hrReason:'',r.rr===null?r.rrReason:'',
      r.delayed?'결과 지연 · 처리 속도를 확인하세요.':''].filter(Boolean).join(' / ') || '신호 품질을 확인한 추정값입니다.';
    if(r.metrics){
      const metadata=Object.entries(r.metrics).map(([key,m])=>key.toUpperCase()+': '+(m.sources.join(', ')||m.status)+(m.window?' · '+((m.window.endMs-m.window.startMs)/1000).toFixed(1)+'초 구간':''));
      el('modelEvidence').textContent=metadata.join(' / ');
      el('inferenceDiagnostics').textContent=JSON.stringify({timing:r.timing,errors:r.errors,candidates:r.candidates,audit:r.audit},null,2);
    }
    if(Array.isArray(r.respWave))drawRespiration(r.respWave);
    drawWave(r.wave);
    if(!final)return;
    for(const id of ['questionHr','finalHr'])el(id).textContent=r.hr===null?'측정 불가':val(r.hr);
    for(const id of ['questionRr','finalRr'])el(id).textContent=r.rr===null?'측정 불가':val(r.rr);
    for(const id of ['questionMode','resultMode'])el(id).textContent=label();
    el('finalHrState').textContent=r.hr===null?r.hrReason:'추정값 · 정상 여부 판정 안 함';
    el('finalRrState').textContent=r.rr===null?r.rrReason:'추정값 · 정상 여부 판정 안 함';
    el('resultMeasurementMeta').textContent=`${label()} · 수집 ${clock(r.durationMs)} · ${r.fps.toFixed(1)}fps`;
  }
  function buttons(active) {
    el('measureBtn').disabled=active;el('modeSelect').disabled=active;el('settingsMode').disabled=active;
    el('cancelMeasureBtn').hidden=!active;el('cameraFrame').classList.toggle('measuring',active);
  }
  function clearValues() {
    result=null;el('continueBtn').hidden=true;
    for(const id of ['hrValue','rrValue','questionHr','questionRr','finalHr','finalRr'])el(id).textContent='--';
    for(const id of ['hrState','rrState'])el(id).textContent='측정 전';
    for(const id of ['finalHrState','finalRrState','resultMeasurementMeta','qualityDetails'])el(id).textContent='';
    el('progressBar').style.width='0%';el('progressText').textContent='0%';el('timer').textContent='00:00 / 01:00';
    el('prepareTimer').textContent='준비 00:00 / 00:05';el('captureMeta').textContent='수신 대기';
    drawWave();drawRegions();onReset();
    el('modelEvidence').textContent='';el('inferenceDiagnostics').textContent='';drawRespiration([]);
  }
  const controller=new MeasurementController(video,event=>{
    if(event.type==='camera') {
      video.style.display=event.enabled?'block':'none';el('placeholder').style.display=event.enabled?'none':'flex';
      el('cameraBtn').textContent=event.enabled?'카메라 끄기':'카메라 켜기';
      if(!event.enabled)drawRegions();
    } else if(event.type==='starting') {
      clearValues();buttons(true);el('measureStatus').textContent=mode==='demo'?'준비':'모델 준비 중';
      el('measurementGuide').textContent=mode==='demo'?'가상 데이터 체험을 준비합니다.':'로컬 서버와 얼굴 분석 모델을 준비합니다. 얼굴 영역은 이 기기의 서버 메모리에서만 처리합니다.';
    } else if(event.type==='health'){
      el('serverStatus').textContent=event.status.models.map(m=>m.id+': '+(m.ready?'준비됨':'사용 불가')).join(' · ') || 'CHROM·POS 비교 기준만 사용';
    } else if(event.type==='state') {
      const s=event.state;
      el('measureStatus').textContent=s.phase==='preparing'?'준비':s.phase==='collecting'?'수집 중':s.phase==='complete'?'분석 중':'신호 부족';
      el('prepareTimer').textContent=`준비 ${clock(s.preparedMs)} / ${clock(CONFIG.prepareMs)}`;
      el('timer').textContent=`${clock(s.collectedMs)} / ${clock(CONFIG.collectMs)}`;
      const pct=Math.min(100,s.collectedMs/CONFIG.collectMs*100);
      el('progressBar').style.width=pct+'%';el('progressText').textContent=Math.floor(pct)+'%';
      el('measurementGuide').textContent=mode==='demo'?'가상 데이터 체험 중 · 실제 생체신호가 아닙니다.':s.reason;
      el('captureMeta').textContent=`전체 ${clock(s.elapsedMs)} / 02:00 · 요청 30fps / 수신 ${s.fps.toFixed(1)}fps · 누락 ${s.droppedFrames || 0}프레임`;
    } else if(event.type==='reset') {
      showValues({hr:null,rr:null,wave:[]});
      drawRespiration([]);el('modelEvidence').textContent='';el('inferenceDiagnostics').textContent='';
    } else if(event.type==='regions')drawRegions(event.polygons);
    else if(event.type==='analysis') {
      showValues(event.result,event.final);
      if(event.final){result=event.result;buttons(false);el('measureStatus').textContent=result.hr===null && result.rr===null?'신호 부족':result.hr===null || result.rr===null?'부분 측정 완료':'측정 완료';el('continueBtn').hidden=false;el('measurementGuide').textContent=result.hr===null && result.rr===null?'측정 신호가 부족합니다. 재측정하거나 증상 문진을 진행할 수 있습니다.':'결과를 확인한 뒤 건강 문진으로 이동하세요.';}
    } else if(event.type==='error' || event.type==='cancelled') {
      buttons(false);
      if(event.type==='cancelled' && !event.reason)return;
      clearValues();el('measureStatus').textContent=event.type==='error'?'측정 불가':'취소됨';
      el('measurementGuide').textContent=event.message || event.reason;
    }
  });
  function setMode(next) {
    controller.stop();mode=next==='demo'?'demo':'real';clearValues();
    el('modeSelect').value=el('settingsMode').value=mode;
    for(const id of ['measurementMode','questionMode','resultMode'])el(id).textContent=label();
    el('measureBtn').textContent=mode==='demo'?'데모 측정 시작':'실제 측정 시작';
    el('measureStatus').textContent='준비';el('measurementGuide').textContent=mode==='demo'?'카메라 없이 가상 데이터로 65초 흐름을 체험합니다.':'고른 조명에서 얼굴을 정면으로 맞추세요. 준비 5초 후 60초 동안 자연스럽게 호흡하세요.';
  }
  el('modeSelect').onchange=e=>setMode(e.target.value);el('settingsMode').onchange=e=>setMode(e.target.value);
  el('cameraBtn').onclick=async ()=>{
    if(controller.stream){controller.closeCamera();return;}
    el('cameraBtn').disabled=true;el('measureBtn').disabled=true;
    try{await controller.openCamera();}catch(error){el('measurementGuide').textContent=error.message;el('measureStatus').textContent='카메라 연결 실패';}
    finally{el('cameraBtn').disabled=false;el('measureBtn').disabled=controller.active;}
  };
  el('measureBtn').onclick=()=>controller.start(mode);
  el('cancelMeasureBtn').onclick=()=>controller.stop();
  el('continueBtn').onclick=()=>{if(result)onContinue();};
  document.addEventListener('visibilitychange',()=>{if(document.hidden)controller.closeCamera('탭이 숨겨져 측정을 취소했습니다.');});
  window.addEventListener('pagehide',()=>controller.closeCamera('페이지를 떠나 측정을 취소했습니다.'));
  drawWave();
  function drawRespiration(values){
    const canvas=el('respWaveCanvas'),c=canvas.getContext('2d');
    c.clearRect(0,0,canvas.width,canvas.height);
    if(values.length<2)return;
    const max=Math.max(...values.map(Math.abs),1e-9);
    c.beginPath();c.strokeStyle='#21866b';c.lineWidth=2;
    values.forEach((v,i)=>{const x=i/(values.length-1)*canvas.width,y=canvas.height/2-v/max*canvas.height*.4;if(i)c.lineTo(x,y);else c.moveTo(x,y);});
    c.stroke();
  }
  return {get result(){return result;},reset:()=>{controller.stop();clearValues();el('measureStatus').textContent='준비';},leave:()=>controller.closeCamera()};
}
