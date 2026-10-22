// 파일 역할: 측정 진행 시간과 분석 시작점 계산
// 연결과 사용: 수집 시간에 맞춰 초기 심박 12초·초기 호흡 20초·완료 60초 안내와 진행 상태를 계산합니다.
// 파일 안내: docs/FILE_GUIDE.md
import { CONFIG } from './measurement-config.mjs';

// Advance only with accepted capture time, never with an independent UI timer.
export function measurementTimeline(state={}, final=false) {
  const phase=state.phase || 'idle';
  const ms=phase==='preparing' || phase==='idle'?0:Math.max(0,Math.min(CONFIG.collectMs,state.collectedMs || 0));
  const seconds=Math.floor(ms/1000);
  let message='카메라를 켜고 측정을 시작해 주세요.';
  if(phase==='preparing')message=`자세를 맞추는 중 · 준비 ${Math.max(0,Math.ceil((CONFIG.prepareMs-(state.preparedMs || 0))/1000))}초 남았어요`;
  else if(final)message='수집을 마쳤어요. 아래에서 측정 결과를 확인하세요.';
  else if(state.respirationCapture?.extending) {
    const r=state.respirationCapture;
    message=`호흡용 연속 영상 ${(r.currentMs/1000).toFixed(1)} / ${r.requiredMs/1000}초 · 추가 수집 ${Math.floor(r.extraMs/1000)} / ${r.maxExtraMs/1000}초`;
  }
  else if(ms>=CONFIG.collectMs)message='수집 완료 · 마지막 결과를 정리하고 있어요';
  else if(phase==='collecting') {
    if(ms<CONFIG.previewMs)message=`초기 심박 분석까지 ${Math.ceil((CONFIG.previewMs-ms)/1000)}초 남았어요`;
    else if(ms<CONFIG.respirationPreviewMs)message=`초기 심박 분석 중 · 초기 호흡 분석까지 ${Math.ceil((CONFIG.respirationPreviewMs-ms)/1000)}초`;
    else message=`심박·호흡 분석 중 · 수집 완료까지 ${Math.ceil((CONFIG.collectMs-ms)/1000)}초`;
  }
  return {seconds,percent:ms/CONFIG.collectMs*100,message,
    started:phase==='collecting' || phase==='complete',
    hrReached:ms>=CONFIG.previewMs,rrReached:ms>=CONFIG.respirationPreviewMs,complete:ms>=CONFIG.collectMs && !state.respirationCapture?.extending};
}
