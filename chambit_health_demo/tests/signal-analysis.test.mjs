import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeSamples, analyzePulse } from '../signal-analysis.mjs';

function synthetic(hr,rr,{fps=30,duration=60,jitter=false,modulation=true}={}) {
  const samples=[];
  for(let i=0;i<=duration*fps;i++) {
    const t=i/fps+(jitter && i>0 && i<duration*fps?0.004*Math.sin(i*1.37):0);
    const breath=2*Math.PI*rr/60*t;
    const phase=2*Math.PI*hr/60*t+(modulation?hr/rr*0.06*Math.sin(breath):0);
    const pulse=(1+(modulation?0.18*Math.cos(breath):0))*(Math.sin(phase)+0.15*Math.sin(2*phase));
    const common=0.002*Math.sin(2*Math.PI*0.06*t);
    samples.push({t:t*1000,rgb:[130*(1+0.004*pulse+common),100*(1+0.008*pulse+common),80*(1+0.002*pulse+common)]});
  }
  return samples;
}
for(const hr of [60,90,120])for(const rr of [9,15,24])test(`RGB: ${hr} bpm, ${rr} breaths/min`,()=>{
  const r=analyzeSamples(synthetic(hr,rr));
  assert.notEqual(r.hr,null,JSON.stringify(r));assert.notEqual(r.rr,null,`${hr}/${rr}: ${r.rrReason}`);
  assert.ok(Math.abs(r.hr-hr)<=3,`HR ${r.hr}`);assert.ok(Math.abs(r.rr-rr)<=2,`RR ${r.rr}`);
  assert.equal(r.quality,'good');assert.equal(r.durationMs,60000);
});
test('raw pulse preserves amplitude and interval respiration',()=>{
  const fs=30,hr=90,rr=15;
  const pulse=Array.from({length:1801},(_,i)=>{const t=i/fs,b=2*Math.PI*rr/60*t;return (1+0.18*Math.cos(b))*Math.sin(2*Math.PI*hr/60*t+hr/rr*0.06*Math.sin(b));});
  const r=analyzePulse(pulse,fs);assert.ok(Math.abs(r.hr-hr)<=3);assert.notEqual(r.rr,null);assert.ok(Math.abs(r.rr-rr)<=2);
});
test('time interpolation tolerates camera frame jitter',()=>{
  const r=analyzeSamples(synthetic(90,15,{jitter:true}));assert.ok(Math.abs(r.hr-90)<=3);assert.notEqual(r.rr,null);assert.ok(Math.abs(r.rr-15)<=2);
});
test('flat image, empty input and random color noise have no readings',()=>{
  assert.equal(analyzeSamples([]).hr,null);
  const flat=synthetic(90,15).map(s=>({...s,rgb:[130,100,80]}));assert.equal(analyzeSamples(flat).hr,null);
  let seed=12345;const random=()=>{seed=(1664525*seed+1013904223)>>>0;return seed/2**32;};
  for(let k=0;k<5;k++) {
    const noise=flat.map(s=>({...s,rgb:s.rgb.map(v=>v+(random()-0.5)*4)}));
    const r=analyzeSamples(noise);assert.equal(r.hr,null);assert.equal(r.rr,null);
  }
});
test('pulse with no respiratory modulation must not invent respiration',()=>{
  const r=analyzeSamples(synthetic(90,15,{modulation:false}));assert.ok(Math.abs(r.hr-90)<=3);assert.equal(r.rr,null);assert.equal(r.quality,'partial');
});
test('too short, low fps, missing frames and duplicate time reject both metrics',()=>{
  const samples=synthetic(90,15);
  const cases=[samples.slice(0,300),synthetic(90,15,{fps:10}),samples.filter(s=>s.t<20000||s.t>20800),[...samples.slice(0,10),samples[9],...samples.slice(10)]];
  for(const input of cases){const r=analyzeSamples(input);assert.equal(r.hr,null);assert.equal(r.rr,null);}
});
