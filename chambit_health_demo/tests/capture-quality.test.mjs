import test from 'node:test';
import assert from 'node:assert/strict';
import {excessiveFaceMotion,usableSkinExposure} from '../measurement-config.mjs';

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
