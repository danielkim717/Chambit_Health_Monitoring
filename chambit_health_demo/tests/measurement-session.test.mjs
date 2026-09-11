import test from 'node:test';
import assert from 'node:assert/strict';
import { MeasurementSession } from '../measurement-session.mjs';
const sample=t=>({t,rgb:[130,100,80]});
function feedUntil(session,start,end,step=20){for(let t=start;t<=end;t+=step)session.feed(sample(t));}
test('five actual preparation seconds followed by sixty actual collection seconds',()=>{
  const s=new MeasurementSession(0);feedUntil(s,0,4980);assert.equal(s.phase,'preparing');assert.equal(s.samples.length,0);
  s.feed(sample(5000));assert.equal(s.phase,'collecting');assert.equal(s.snapshot(5000).collectedMs,0);
  feedUntil(s,5020,64980);assert.equal(s.phase,'collecting');s.feed(sample(65000));assert.equal(s.phase,'complete');assert.equal(s.snapshot(65000).collectedMs,60000);
});
test('wall time alone cannot advance collection',()=>{
  const s=new MeasurementSession(0);feedUntil(s,0,6000);s.tick(20000);assert.equal(s.phase,'preparing');assert.equal(s.samples.length,0);
});
test('half-second invalid signal discards collected segment; fresh preparation required',()=>{
  const s=new MeasurementSession(0);feedUntil(s,0,6000);
  for(let t=6020;t<=6540;t+=20)s.feed({t,reason:'face missing'});
  assert.equal(s.phase,'preparing');assert.equal(s.samples.length,0);
  feedUntil(s,6560,11540);assert.equal(s.phase,'preparing');s.feed(sample(11560));assert.equal(s.phase,'collecting');
});
test('brief loss is omitted without compressing the real sample clock',()=>{
  const s=new MeasurementSession(0);feedUntil(s,0,6000);s.feed({t:6020});s.feed(sample(6100));
  assert.equal(s.phase,'collecting');assert.equal(s.samples.at(-1).t,6100);assert.equal(s.snapshot(6100).collectedMs,1100);
});
test('long gap even without a watchdog tick resets preparation',()=>{
  const s=new MeasurementSession(0);feedUntil(s,0,6000);s.feed(sample(6500));assert.equal(s.phase,'preparing');assert.equal(s.samples.length,0);
});
test('duplicate and out-of-order samples are ignored',()=>{
  const s=new MeasurementSession(0);feedUntil(s,0,6000);const count=s.samples.length;s.feed(sample(6000));s.feed(sample(5900));assert.equal(s.samples.length,count);
});
test('attempt expires at 120 seconds and cancellation prevents later completion',()=>{
  const s=new MeasurementSession(0);feedUntil(s,0,6000);s.tick(120000);assert.equal(s.phase,'timeout');assert.equal(s.samples.length,0);s.feed(sample(120001));assert.equal(s.phase,'timeout');
  const c=new MeasurementSession(0);feedUntil(c,0,6000);c.cancel();c.feed(sample(6020));assert.equal(c.phase,'cancelled');assert.equal(c.samples.length,0);
});
