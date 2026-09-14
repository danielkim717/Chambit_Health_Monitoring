import test from 'node:test';
import assert from 'node:assert/strict';
import { respirationDisplay, measurementAnalysisFile } from '../measurement-ui.mjs';

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
  assert.equal(respirationDisplay(result,false,20000).state,'호흡 신호 수집 중');
  assert.match(respirationDisplay(result,false,20000).reason,/35초부터/);
  assert.equal(respirationDisplay(result,false,35000).state,'호흡 분석 중');
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
