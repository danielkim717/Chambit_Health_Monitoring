import test from 'node:test';
import assert from 'node:assert/strict';
import { respirationDisplay, measurementAnalysisFile } from '../measurement-ui.mjs';

test('recovered respiration names the actual partial window',()=>{
  const result={rr:15,rrReason:'연속된 43.0초 구간으로 추정했습니다.',metrics:{rr:{partialWindow:true,status:'valid'}}};
  assert.equal(respirationDisplay(result,true,60000).reason,result.rrReason);
  assert.equal(respirationDisplay(result,false,60000).reason,result.rrReason);
});

test('weak respiration values remain explicitly tentative during and after measurement',()=>{
  const result={rr:15,rrReason:'다시 측정해 비교해 주세요.',metrics:{rr:{status:'tentative'}}};
  for(const final of [false,true]){
    assert.equal(respirationDisplay(result,final,60000).state,'신호 약함 · 참고값');
    assert.equal(respirationDisplay(result,final,60000).reason,result.rrReason);
  }
});

test('analysis export keeps rejected evidence but excludes video and interview data',()=>{
  const result={mode:'real',hr:72,rr:null,signalDiagnostics:{'test:rr':{inputWave:[1,2,3]}},
    candidates:[{value:null,features:{spectralPeakRate:12}}],
    frames:['private'],pixels:['private'],answers:['private'],resultId:'private'};
  const file=measurementAnalysisFile(result),parsed=JSON.parse(file);
  assert.equal(parsed.rr,null);
  assert.deepEqual(parsed.signalDiagnostics,result.signalDiagnostics);
  assert.equal(parsed.candidates[0].value,null);
  assert.ok(!file.includes('private'));
  assert.equal(measurementAnalysisFile(null),null);
  assert.equal(measurementAnalysisFile({mode:'real'}),null);
  assert.equal(measurementAnalysisFile({...result,mode:'demo'}),null);
});

test('respiration explains its later start while heart rate is visible',()=>{
  const result={hr:72,rr:null,metrics:{rr:{status:'collecting'}}};
  assert.equal(respirationDisplay(result,false,12000).state,'호흡 신호 수집 중');
  assert.match(respirationDisplay(result,false,12000).reason,/20초부터/);
  assert.equal(respirationDisplay(result,false,20000).state,'호흡 분석 중');
});

test('early respiration is labelled as an initial estimate with its reason',()=>{
  const result={rr:15,rrReason:'짧은 구간의 초기 추정값입니다.',metrics:{rr:{status:'preliminary'}}};
  assert.equal(respirationDisplay(result,false,20000).state,'초기 추정값 · 확인 중');
  assert.equal(respirationDisplay(result,false,20000).reason,result.rrReason);
});

test('respiration distinguishes rejected signals, conflicts, and final failure',()=>{
  const result={hr:72,rr:null,rrReason:'영상이 중간에 끊겨 호흡수를 측정하지 못했습니다.',metrics:{rr:{status:'insufficient'}}};
  assert.equal(respirationDisplay(result,false,50000).state,'호흡 신호 부족');
  assert.equal(respirationDisplay(result,false,50000).reason,result.rrReason);
  result.metrics.rr.status='conflict';
  assert.equal(respirationDisplay(result,false,50000).state,'호흡 결과 확인 중');
  assert.equal(respirationDisplay(result,true,60000).state,'측정 불가');
});

test('a valid respiration result is displayed independently of heart rate',()=>{
  assert.equal(respirationDisplay({hr:null,rr:15},false,46000).state,'중간 추정값');
  assert.equal(respirationDisplay({hr:null,rr:15},true,60000).state,'호흡수 추정값');
  assert.equal(respirationDisplay({hr:72,rr:15},false,30000,'demo').state,'가상 데이터');
});
