import test from 'node:test';
import assert from 'node:assert/strict';
import {excessiveFaceMotion,usableSkinExposure,FaceDetectionCache} from '../measurement-config.mjs';

test('face geometry reuse is bounded and cleared on face loss and restart',()=>{
  const cache=new FaceDetectionCache();let calls=0;
  const face=()=>{calls++;return [{x:calls}];};
  assert.equal(cache.read(0,face)[0].x,1);
  assert.equal(cache.read(33,face)[0].x,1);
  assert.equal(cache.read(67,face)[0].x,2);
  assert.deepEqual(cache.read(134,()=>[]),[]);
  assert.equal(cache.read(135,face)[0].x,3);
  cache.reset();assert.equal(cache.read(136,face)[0].x,4);
  assert.equal(cache.read(300,face)[0].x,5);
});

test('small face shifts and scale changes pass while large motion still rejects',()=>{
  const previous={x:.5,y:.5,width:.3,t:0};
  assert.equal(excessiveFaceMotion(previous,{x:.512,y:.5},.3,33),false);
  assert.equal(excessiveFaceMotion(previous,{x:.5,y:.5},.316,33),false);
  assert.equal(excessiveFaceMotion(previous,{x:.52,y:.5},.3,33),true);
  assert.equal(excessiveFaceMotion(previous,{x:.5,y:.5},.34,33),true);
  assert.equal(excessiveFaceMotion(null,{x:.5,y:.5},.3,33),false);
});

test('partly shadowed ROI passes but severely shaded or tiny ROI does not',()=>{
  assert.equal(usableSkinExposure(70,100),true);
  assert.equal(usableSkinExposure(60,100),false);
  assert.equal(usableSkinExposure(20,20),false);
  assert.equal(usableSkinExposure(0,0),false);
});
