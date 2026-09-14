import test from 'node:test';
import assert from 'node:assert/strict';
import { measurementTimeline } from '../measurement-timeline.mjs';

test('capture milestones are analysis starts, not promises of a valid reading',()=>{
  const at=collectedMs=>measurementTimeline({phase:'collecting',collectedMs});
  assert.equal(at(19999).hrReached,false);
  assert.equal(at(20000).hrReached,true);
  assert.equal(at(34999).rrReached,false);
  assert.equal(at(35000).rrReached,true);
  assert.match(at(35000).message,/분석 중/);
  assert.equal(at(60000).percent,100);
  assert.match(at(60000).message,/결과를 정리/);
});

test('preparation and reacquisition do not falsely advance the timeline',()=>{
  const reset=measurementTimeline({phase:'preparing',preparedMs:2000,collectedMs:50000});
  assert.equal(reset.percent,0);
  assert.equal(reset.hrReached,false);
  assert.equal(reset.rrReached,false);
  assert.match(reset.message,/3초/);
  assert.equal(measurementTimeline().percent,0);
  assert.equal(measurementTimeline({phase:'complete',collectedMs:61000},true).percent,100);
});
