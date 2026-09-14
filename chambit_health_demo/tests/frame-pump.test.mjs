import test from 'node:test';
import assert from 'node:assert/strict';
import { FramePump, CaptureStats, captureNotice } from '../frame-pump.mjs';
import { MeasurementController } from '../measurement-controller.mjs';

const frame=t=>({t,bitmap:{closed:false,close(){this.closed=true;}}});

test('latest pending real frame starts immediately when a slow Worker finishes',()=>{
  const sent=[];const pump=new FramePump(f=>sent.push(f));
  const a=frame(0),b=frame(33),c=frame(66);
  pump.push(a);pump.push(b);pump.push(c);
  assert.equal(b.bitmap.closed,true);assert.deepEqual(sent.map(f=>f.t),[0]);
  pump.done();assert.deepEqual(sent.map(f=>f.t),[0,66]);
  assert.equal(pump.pending,null);assert.equal(pump.replaced,1);
  const d=frame(99);pump.push(d);pump.close();pump.done();
  assert.equal(d.bitmap.closed,true);assert.equal(sent.length,2);
  const late=frame(132);pump.push(late);assert.equal(late.bitmap.closed,true);
});

test('a simulated 38ms Worker sustains over 24fps instead of losing alternate frames',()=>{
  let now=0,done=Infinity,inflight;
  const sent=[],pump=new FramePump(f=>{sent.push(f.t);inflight=f;done=now+38;});
  for(let i=0;i<300;i++){
    const t=i*1000/30;
    while(done<=t){now=done;done=Infinity;inflight.bitmap.close();pump.done();}
    now=t;pump.push(frame(t));
  }
  assert.ok(sent.length>=250,`processed ${sent.length} real frames in approximately 10s`);
  assert.equal(new Set(sent).size,sent.length);
  assert.ok(sent.every(t=>Math.abs(t*30/1000-Math.round(t*30/1000))<1e-8));
  pump.close();inflight.bitmap.close();
});

test('capture accepts jittered 30fps frames without a second rate limiter',async()=>{
  let callback;
  const video={readyState:4,requestVideoFrameCallback(fn){callback=fn;return 1;},cancelVideoFrameCallback(){}};
  const controller=new MeasurementController(video,()=>{}),sent=[];
  controller.active=true;controller.revision=0;controller.captureStats=new CaptureStats(30);
  controller.framePump=new FramePump(f=>sent.push(f));
  const original=globalThis.createImageBitmap;
  globalThis.createImageBitmap=async()=>frame(0).bitmap;
  try{
    controller.capture(0);
    for(let i=0;i<60;i++){
      const t=i*1000/30+(i%2?-5:0);
      await callback(t,{mediaTime:t/1000,presentedFrames:i});
      controller.framePump.done();
    }
    assert.equal(sent.length,60);
    assert.equal(sent[1].t,1000/30-5);
    assert.ok(controller.captureStats.snapshot().cameraFps>29);
  }finally{controller.stop('');globalThis.createImageBitmap=original;sent.forEach(f=>f.bitmap.close());}
});

test('a bitmap resolving after cancellation is closed and never sent',async()=>{
  let callback,resolve;
  const video={readyState:4,requestVideoFrameCallback(fn){callback=fn;return 1;},cancelVideoFrameCallback(){}};
  const controller=new MeasurementController(video,()=>{}),sent=[];
  controller.active=true;controller.revision=0;controller.captureStats=new CaptureStats(30);
  controller.framePump=new FramePump(f=>sent.push(f));
  const original=globalThis.createImageBitmap,bitmap=frame(0).bitmap;
  globalThis.createImageBitmap=()=>new Promise(r=>resolve=r);
  try{
    controller.capture(0);const pending=callback(0,{mediaTime:0});
    controller.stop('');resolve(bitmap);await pending;
    assert.equal(bitmap.closed,true);assert.equal(sent.length,0);
  }finally{globalThis.createImageBitmap=original;}
});

test('capture diagnostics distinguish camera presentation, processing, and ROI rejection',()=>{
  const stats=new CaptureStats(30);
  stats.observe(0,1);stats.observe(1000,31);
  for(let i=0;i<=15;i++)stats.result(i*1000/15,i%3!==0,38);
  const value=stats.snapshot(12);
  assert.equal(value.cameraFps,30);assert.equal(value.callbackFps,1);
  assert.equal(value.processedFps,15);assert.equal(value.invalidFrames,6);
  assert.equal(value.pendingReplaced,12);assert.equal(value.extractionP95Ms,38);
});

test('slow input is explained during capture rather than only after a minute',()=>{
  assert.equal(captureNotice({processedFrames:10,cameraFps:15,processedFps:15}),'');
  assert.match(captureNotice({processedFrames:60,cameraFps:20,processedFps:20}),/카메라의 영상 전달 속도/);
  assert.match(captureNotice({processedFrames:60,cameraFps:30,processedFps:20}),/앱의 처리 속도/);
  assert.equal(captureNotice({processedFrames:60,cameraFps:30,processedFps:29}),'');
});
