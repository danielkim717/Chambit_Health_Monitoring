// 파일 역할: 측정 결과와 실패 안내 화면 표시
// 연결과 사용: 수치·품질·분석 상세·재측정·분석 JSON 저장을 관리합니다. 실패 후보를 유효한 측정값으로 바꾸지 않습니다.
// 파일 안내: docs/FILE_GUIDE.md
import { CONFIG } from './measurement-config.mjs';
import { MeasurementController } from './measurement-controller.mjs';
import { measurementTimeline } from './measurement-timeline.mjs';
import { captureNotice } from './frame-pump.mjs';

// Deliberate local export of numerical evidence, never the capture buffer or interview.
export function measurementAnalysisFile(result) {
  if(!result || result.mode!=='real' || !result.signalDiagnostics)return null;
  const fields=['mode','hr','rr','hrReason','rrReason','metrics','durationMs','fps','quality',
    'capture','timing','errors','candidates','audit','signalDiagnostics',
    'collectionElapsedMs','respirationCapture','captureIntervals'];
  const payload={formatVersion:1,description:'Numerical measurement diagnostics; rejected peaks are not vital signs.'};
  for(const key of fields)if(result[key]!==undefined)payload[key]=result[key];
  return JSON.stringify(payload,null,2);
}

export function respirationDisplay(result, final=false, collectedMs=0, mode='real') {
  if(mode!=='demo' && result?.rr != null && result.metrics?.rr?.status==='preliminary')
    return {state:'초기 추정값 · 확인 중',reason:result.rrReason || '영상을 더 모으면서 다시 확인합니다.'};
  if(mode!=='demo' && result?.rr != null && result.metrics?.rr?.status==='tentative')
    return {state:'신호 약함 · 참고값',reason:result.rrReason || '다시 측정해 비교해 주세요.'};
  if(result?.rr != null)return {state:mode==='demo'?'가상 데이터':final?'호흡수 추정값':'중간 추정값',reason:result.metrics?.rr?.partialWindow?result.rrReason:''};
  if(final)return {state:'측정 불가',reason:result?.rrReason || '호흡 신호가 부족합니다.'};
  if(mode==='demo')return {state:'신호 수집 중',reason:'가상 데이터'};
  if(collectedMs < CONFIG.respirationPreviewMs)return {
    state:'호흡 신호 수집 중',
    reason:`수집 ${CONFIG.respirationPreviewMs/1000}초부터 신호가 충분하면 초기 호흡수를 표시합니다.`
  };
  if(!result || result.metrics?.rr?.status==='collecting')return {
    state:'호흡 분석 중',reason:result?.metrics?.rr?.reasonCode==='more_cycles'?result.rrReason:'모은 영상에서 호흡 신호를 분석하고 있습니다. 잠시만 기다려 주세요.'
  };
  return {state:result.metrics?.rr?.status==='conflict'?'호흡 결과 확인 중':'호흡 신호 부족',
    reason:result.rrReason || '호흡 파형의 품질을 확인하고 있습니다.'};
}

export function mountMeasurement({onReset,onContinue}) {
  const el=id=>document.getElementById(id), video=el('video');
  let mode='real',result=null,lastAnalysis=null,lastState={},lastRegionsAt=-Infinity;
  const wave=el('waveCanvas'),ctx=wave.getContext('2d'),overlay=el('roiCanvas');
  const clock=ms=>`${String(Math.floor(ms/60000)).padStart(2,'0')}:${String(Math.floor(ms/1000)%60).padStart(2,'0')}`;
  const label=()=>mode==='demo'?'가상 데이터 · 데모':'실제 웹캠 추정';
  function drawTimeline(state={},final=false) {
    lastState=state;
    const timeline=measurementTimeline(state,final);
    el('timelineMessage').textContent=timeline.message;
    el('timelineClock').textContent=`${timeline.seconds} / ${CONFIG.collectMs/1000}초`;
    el('timelineTrack').setAttribute('aria-valuenow',String(timeline.seconds));
    el('timelineTrack').setAttribute('aria-valuetext',`${timeline.seconds}초 수집. ${timeline.message}`);
    el('progressBar').style.width=timeline.percent+'%';
    el('progressText').textContent=Math.floor(timeline.percent)+'%';
    for(const [id,reached] of [['timelineStart',timeline.started],['timelineHr',timeline.hrReached],['timelineRr',timeline.rrReached],['timelineEnd',timeline.complete]]) {
      el(id).classList.toggle('is-reached',reached);
    }
  }
  function drawWave(values=[]) {
    ctx.clearRect(0,0,wave.width,wave.height);ctx.strokeStyle='#e7edf5';ctx.lineWidth=1;
    for(let y=25;y<wave.height;y+=40){ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(wave.width,y);ctx.stroke();}
    if(values.length<2)return;
    const max=Math.max(...values.map(Math.abs),1e-9);ctx.beginPath();ctx.strokeStyle=mode==='demo'?'#b77812':'#2878ff';ctx.lineWidth=2;
    values.forEach((v,i)=>{const x=i/(values.length-1)*wave.width,y=wave.height/2-v/max*wave.height*0.4;if(i)ctx.lineTo(x,y);else ctx.moveTo(x,y);});ctx.stroke();
  }
  function drawRegions(polygons=[]) {
    if(polygons.length && performance.now()-lastRegionsAt<100)return;
    lastRegionsAt=performance.now();
    if(overlay.width!==overlay.clientWidth)overlay.width=overlay.clientWidth;
    if(overlay.height!==overlay.clientHeight)overlay.height=overlay.clientHeight;
    const c=overlay.getContext('2d');c.clearRect(0,0,overlay.width,overlay.height);
    if(!video.videoWidth)return;
    const scale=Math.max(overlay.width/video.videoWidth,overlay.height/video.videoHeight);
    const w=video.videoWidth*scale,h=video.videoHeight*scale,dx=(overlay.width-w)/2,dy=(overlay.height-h)/2;
    c.strokeStyle='#44d38b';c.fillStyle='rgba(68,211,139,.12)';c.lineWidth=2;
    for(const points of polygons){c.beginPath();points.forEach((p,i)=>{const x=overlay.width-(dx+p.x*w),y=dy+p.y*h;if(i)c.lineTo(x,y);else c.moveTo(x,y);});c.closePath();c.fill();c.stroke();}
  }
  function showValues(r,final=false) {
    lastAnalysis=r;
    const val=x=>x==null?'--':String(Math.round(x));
    el('hrValue').textContent=val(r.hr);el('rrValue').textContent=val(r.rr);
    el('hrState').textContent=r.hr===null?(final?'측정 불가':'신호 수집 중'):(mode==='demo'?'가상 데이터':final?'심박수 추정값':'중간 추정값');
    showRespirationState(r,final,r.durationMs || 0);
    const tentativeHr=mode!=='demo' && r.metrics?.hr?.status==='tentative';
    const earlyHr=mode!=='demo' && r.metrics?.hr?.status==='preliminary';
    if(tentativeHr)el('hrState').textContent='신호 약함 · 참고값';
    if(earlyHr)el('hrState').textContent='초기 추정값 · 확인 중';
    el('hrDetails').textContent=r.hr===null || tentativeHr || earlyHr || r.metrics?.hr?.partialWindow?(r.hrReason || ''):'';
    el('qualityDetails').textContent=r.delayed?'영상 분석이 평소보다 오래 걸리고 있습니다. 결과가 준비되면 표시합니다.':
      final?'수집을 마쳤습니다. 각 항목의 결과와 안내를 확인해 주세요.':'중간 추정값은 신호가 충분할 때 표시되며, 측정하는 동안 달라질 수 있습니다.';
    if(r.metrics){
      const metadata=Object.entries(r.metrics).map(([key,m])=>key.toUpperCase()+': '+(m.sources.join(', ')||m.status)+(m.window?' · '+((m.window.endMs-m.window.startMs)/1000).toFixed(1)+'초 구간':''));
      el('modelEvidence').textContent=metadata.join(' / ');
      el('inferenceDiagnostics').textContent=JSON.stringify({capture:r.capture,timing:r.timing,errors:r.errors,candidates:r.candidates,audit:r.audit},null,2);
    }
    if(Array.isArray(r.respWave))drawRespiration(r.respWave);
    drawWave(r.wave);
    if(!final)return;
    for(const id of ['questionHr','finalHr'])el(id).textContent=r.hr===null?'측정 불가':val(r.hr);
    for(const id of ['questionRr','finalRr'])el(id).textContent=r.rr===null?'측정 불가':val(r.rr);
    const hasTentative=Object.values(r.metrics || {}).some(m=>m.status==='tentative');
    for(const id of ['questionMode','resultMode'])el(id).textContent=label()+(hasTentative?' · 신호 약한 참고값 포함':'');
    el('finalHrState').textContent=r.hr===null?r.hrReason:tentativeHr?'신호 약함 · 참고값 · 재측정 권장':'추정값 · 정상 여부 판정 안 함';
    el('finalRrState').textContent=r.rr===null?r.rrReason:r.metrics?.rr?.status==='tentative'?'신호 약함 · 참고값 · 재측정 권장':'추정값 · 정상 여부 판정 안 함';
    for(const [key,id] of [['hr','finalHrState'],['rr','finalRrState']])
      if(r.metrics?.[key]?.partialWindow)el(id).textContent+=' · '+r[key+'Reason'];
    el('resultMeasurementMeta').textContent=`${label()} · 수집 ${clock(r.collectionElapsedMs ?? r.durationMs)} · ${r.fps.toFixed(1)}fps`;
  }
  function showRespirationState(r,final,collectedMs) {
    if(!final && lastState.respirationCapture?.extending && r?.rr == null){
      const current=lastState.respirationCapture.currentMs/1000;
      el('rrState').textContent='호흡 영상 추가 수집 중';
      el('rrDetails').textContent=`현재 연속 영상 ${current.toFixed(1)}초입니다. 최종 확인에 필요한 연속 35초를 확보하면 수집을 마칩니다. 추가 수집은 최대 30초입니다.`;
      return;
    }
    const display=respirationDisplay(r,final,collectedMs,mode);
    el('rrState').textContent=display.state;el('rrDetails').textContent=display.reason;
  }
  function buttons(active) {
    el('measureBtn').disabled=active;el('modeSelect').disabled=active;el('settingsMode').disabled=active;
    el('cancelMeasureBtn').hidden=!active;el('cameraFrame').classList.toggle('measuring',active);
  }
  function clearValues() {
    result=null;lastAnalysis=null;el('continueBtn').hidden=true;
    el('downloadAnalysisBtn').disabled=true;
    for(const id of ['hrValue','rrValue','questionHr','questionRr','finalHr','finalRr'])el(id).textContent='--';
    for(const id of ['hrState','rrState'])el(id).textContent='측정 전';
    el('rrDetails').textContent='';el('hrDetails').textContent='';drawTimeline();
    el('captureNotice').textContent='';el('captureNotice').hidden=true;
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
      // Keep frame ingestion independent of expensive DOM/layout updates.
      if(s.phase===lastState.phase && s.revision===lastState.revision &&
         (s.elapsedMs || 0)-(lastState.elapsedMs || 0)<250)return;
      el('measureStatus').textContent=s.phase==='preparing'?'준비':s.phase==='collecting'?'수집 중':s.phase==='complete'?'분석 중':'신호 부족';
      if(s.respirationCapture?.extending)el('measureStatus').textContent='호흡 영상 추가 수집';
      el('prepareTimer').textContent=`준비 ${clock(s.preparedMs)} / ${clock(CONFIG.prepareMs)}`;
      el('timer').textContent=`${clock(s.collectedMs)} / ${clock(CONFIG.collectMs)}`;
      if(s.respirationCapture?.extending)el('timer').textContent=`추가 ${clock(s.respirationCapture.extraMs)} / ${clock(s.respirationCapture.maxExtraMs)}`;
      drawTimeline(s);
      el('measurementGuide').textContent=mode==='demo'?'가상 데이터 체험 중 · 실제 생체신호가 아닙니다.':s.reason;
      const capture=s.capture;
      const notice=captureNotice(capture);
      el('captureNotice').textContent=notice;el('captureNotice').hidden=!notice;
      el('captureMeta').textContent=`전체 ${clock(s.elapsedMs)} / 02:00 · 요청 30fps / 유효 수신 ${s.fps.toFixed(1)}fps · 전송 순서 누락 ${s.droppedFrames || 0}프레임`+
        (capture?` · 카메라 ${capture.cameraFps || 0}fps / 얼굴 처리 ${capture.processedFps || 0}fps · 얼굴 처리 평균 ${capture.extractionMeanMs || 0}ms · 처리 대기 교체 ${capture.pendingReplaced || 0}프레임`:'');
      showRespirationState(lastAnalysis,false,s.collectedMs);
    } else if(event.type==='reset') {
      result=null;el('downloadAnalysisBtn').disabled=true;
      showValues({hr:null,rr:null,wave:[]});
      lastAnalysis=null;
      drawTimeline({phase:'preparing',preparedMs:0,collectedMs:0});
      drawRespiration([]);el('modelEvidence').textContent='';el('inferenceDiagnostics').textContent='';
    } else if(event.type==='regions')drawRegions(event.polygons);
    else if(event.type==='analysis') {
      showValues(event.result,event.final);
      if(event.final)drawTimeline({phase:'complete',collectedMs:event.result.durationMs},true);
      else if(!lastState.phase || lastState.collectedMs < event.result.durationMs)drawTimeline({phase:'collecting',collectedMs:event.result.durationMs});
      if(event.final){
        result=event.result;
        const tentative=Object.values(result.metrics || {}).some(m=>m.status==='tentative');
        el('downloadAnalysisBtn').disabled=mode!=='real' || !result.signalDiagnostics;buttons(false);
        el('measureStatus').textContent=result.hr===null && result.rr===null?'신호 부족':
          tentative?'측정 완료 · 참고값 포함':result.hr===null || result.rr===null?'부분 측정 완료':'측정 완료';
        el('continueBtn').hidden=false;
        el('measurementGuide').textContent=result.hr===null && result.rr===null?
          '측정 신호가 부족합니다. 재측정하거나 증상 문진을 진행할 수 있습니다.':tentative?
          '약한 신호에서 얻은 참고값이 포함됩니다. 다시 측정해 비교하거나 건강 문진으로 이동하세요.':
          '결과를 확인한 뒤 건강 문진으로 이동하세요.';
      }
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
  el('downloadAnalysisBtn').onclick=()=>{
    const content=measurementAnalysisFile(result);
    if(!content)return;
    const url=URL.createObjectURL(new Blob([content],{type:'application/json'}));
    const link=document.createElement('a');link.href=url;
    link.download=`measurement-analysis-${new Date().toISOString().replace(/[:.]/g,'-')}.json`;
    document.body.append(link);link.click();link.remove();
    setTimeout(()=>URL.revokeObjectURL(url),1000);
  };
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
