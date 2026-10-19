import { test, expect } from '@playwright/test';

test.beforeEach(async({page})=>{
  // External typography/maps are unrelated to local camera processing.
  await page.route('https://fonts.googleapis.com/**',route=>route.abort());
});
test('real is default; denied permission never switches to demo',async({page})=>{
  await page.addInitScript(()=>{
    navigator.mediaDevices.getUserMedia=async()=>{throw new DOMException('denied','NotAllowedError');};
  });
  await page.goto('/');await page.locator('#startHero').click();
  await expect(page.locator('#modeSelect')).toHaveValue('real');
  await page.locator('#cameraBtn').click();await expect(page.locator('#measurementGuide')).toContainText('권한이 거부');
  await page.locator('#measureBtn').click();await expect(page.locator('#measurementGuide')).toContainText('카메라를 먼저');
  await expect(page.locator('#modeSelect')).toHaveValue('real');await expect(page.locator('#hrValue')).toHaveText('--');
});
test('actual local WASM and model initialize in Worker; fake camera has no face',async({page})=>{
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  const requests=[];page.on('request',r=>{if(r.method()==='POST')requests.push(r.url());});
  await page.goto('/');await page.locator('#startHero').click();await page.locator('#cameraBtn').click();
  await expect(page.locator('#cameraBtn')).toHaveText('카메라 끄기');await page.locator('#measureBtn').click();
  await expect(page.locator('#measurementGuide')).toContainText('얼굴을 정면으로',{timeout:25000});
  await expect(page.locator('#measureStatus')).toHaveText('준비');await expect(page.locator('#hrValue')).toHaveText('--');
  await expect(page.locator('#rrValue')).toHaveText('--');await expect(page.locator('#progressText')).toHaveText('0%');
  await page.locator('#cancelMeasureBtn').click();await expect(page.locator('#measureBtn')).toBeEnabled();
  expect(errors).toEqual([]);expect(requests).toEqual([]);
});
test('model loading failure is explicit; does not fabricate numbers',async({page})=>{
  await page.addInitScript(()=>{
    // Isolate a Worker failure from Edge's intermittently unavailable fake device.
    // The preceding test exercises getUserMedia and the actual MediaPipe Worker.
    navigator.mediaDevices.getUserMedia=async()=>{
      const canvas=document.createElement('canvas');canvas.width=320;canvas.height=240;
      const context=canvas.getContext('2d'),stream=canvas.captureStream(30);
      setInterval(()=>{context.fillStyle='#888';context.fillRect(0,0,320,240);},33);
      return stream;
    };
    window.Worker=class {postMessage(){setTimeout(()=>this.onerror?.(new Event('error')),0);}terminate(){}};
  });
  await page.goto('/');await page.locator('#startHero').click();await page.locator('#cameraBtn').click();
  await expect(page.locator('#cameraBtn')).toHaveText('카메라 끄기',{timeout:15000});
  await page.locator('#measureBtn').click();
  await expect(page.locator('#measurementGuide')).toContainText('얼굴 분석 파일');await expect(page.locator('#hrValue')).toHaveText('--');await expect(page.locator('#modeSelect')).toHaveValue('real');
});
test('65 second demo, questionnaire, result and restart use explicit virtual data',async({page})=>{
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  // Freeze between explicit advances: host load must not cross the 5s boundary.
  await page.clock.install({time:new Date('2026-10-19T00:00:00Z')});
  await page.clock.pauseAt(new Date('2026-10-19T00:00:01Z'));
  await page.goto('/');await page.locator('#startHero').click();await page.locator('#modeSelect').selectOption('demo');
  await page.locator('#measureBtn').click();await page.clock.runFor(4900);await expect(page.locator('#measureStatus')).toHaveText('준비');
  // Include the next 2s analysis tick after the 20s collection milestone.
  await expect(page.locator('#hrValue')).toHaveText('--');await page.clock.runFor(23000);
  await expect(page.locator('#hrValue')).toHaveText('72');await expect(page.locator('#rrValue')).toHaveText('--');
  await expect(page.locator('#timelineHr')).toHaveClass(/is-reached/);
  await expect(page.locator('#timelineRr')).not.toHaveClass(/is-reached/);
  await page.clock.runFor(15000);await expect(page.locator('#rrValue')).toHaveText('15');
  await expect(page.locator('#timelineRr')).toHaveClass(/is-reached/);
  await expect(page.locator('#continueBtn')).toBeHidden();await page.clock.runFor(23000);
  await expect(page.locator('#measureStatus')).toHaveText('측정 완료');await expect(page.locator('#timer')).toHaveText('01:00 / 01:00');
  await page.locator('#continueBtn').click();await expect(page.locator('#questionMode')).toContainText('가상 데이터');
  for(let i=0;i<4;i++)await page.locator('.answer-btn').first().click();
  await expect(page.locator('#result')).toHaveClass('page active');await expect(page.locator('#finalHr')).toHaveText('72');await expect(page.locator('#finalRr')).toHaveText('15');
  await expect(page.locator('#resultMode')).toContainText('가상 데이터');
  await page.locator('#restartBtn').click();await expect(page.locator('#hrValue')).toHaveText('--');await expect(page.locator('#timer')).toHaveText('00:00 / 01:00');await expect(page.locator('#continueBtn')).toBeHidden();
  await page.locator('#modeSelect').selectOption('real');await expect(page.locator('#measurementMode')).toHaveText('실제 웹캠 추정');expect(errors).toEqual([]);
});
test('navigation and hidden tab cancel an attempt; repeated starts do not duplicate it',async({page})=>{
  await page.clock.install();await page.goto('/');await page.locator('#startHero').click();await page.locator('#modeSelect').selectOption('demo');
  await page.locator('#measureBtn').evaluate(button=>{button.click();button.click();});await page.clock.runFor(6000);await expect(page.locator('#measureStatus')).toHaveText('수집 중');
  await page.locator('[data-page="home"]').click();await page.clock.runFor(70000);await page.locator('#startHero').click();await expect(page.locator('#hrValue')).toHaveText('--');await expect(page.locator('#measureBtn')).toBeEnabled();
  await page.locator('#measureBtn').click();await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:true});document.dispatchEvent(new Event('visibilitychange'));});
  await expect(page.locator('#measureStatus')).toHaveText('취소됨');await expect(page.locator('#continueBtn')).toBeHidden();
});
test('partial real result keeps respiration unavailable through questionnaire',async({page})=>{
  // UI-only fixture; real model execution is covered by the backend checkpoint tests.
  await page.route('/api/consultation/start',route=>route.fulfill({json:{
    consultationId:'a'.repeat(32),done:false,answered:0,total:4,mode:'real',provider:'rules',
    question:{id:'symptoms',text:'지금 불편한 증상이 있나요?',options:[{id:'none',text:'없어요.'}]}
  }}));
  await page.routeWebSocket('**/api/measurement',socket=>{
    socket.send(JSON.stringify({type:'connected'}));
    socket.onMessage(raw=>{
      if(JSON.parse(raw).type!=='start')return;
      socket.send(JSON.stringify({type:'started',sessionId:'test-session',revision:0}));
      setTimeout(()=>socket.send(JSON.stringify({type:'analysis',sessionId:'test-session',revision:0,final:true,
        result:{resultId:'b'.repeat(32),mode:'real',hr:78,rr:null,hrReason:'',
          rrReason:'카메라 영상이 충분히 부드럽게 전달되지 않아 호흡수를 측정하지 못했습니다. 다른 카메라 앱이나 무거운 작업을 닫고 다시 측정해 주세요.',
          durationMs:60000,fps:20,wave:[],quality:'partial',
          metrics:{hr:{sources:['chrom'],status:'valid'},rr:{sources:[],status:'insufficient',reasonCode:'low_fps'}},
          errors:[{model:'mtts_can',code:'low_fps',fps:20,requiredFps:24}]}})),50);
    });
  });
  await page.addInitScript(()=>{
    window.Worker=class {
      postMessage(message){
        if(message.type==='init')setTimeout(()=>this.onmessage?.({data:{type:'ready'}}),0);
      }
      terminate(){}
    };
  });
  await page.goto('/');await page.locator('#startHero').click();await page.locator('#cameraBtn').click();await page.locator('#measureBtn').click();
  await expect(page.locator('#measureStatus')).toHaveText('부분 측정 완료');await expect(page.locator('#rrState')).toHaveText('측정 불가');
  await expect(page.locator('#rrDetails')).toContainText('카메라 영상이 충분히 부드럽게');
  await expect(page.locator('#rrDetails')).not.toContainText('mtts_can');
  await expect(page.locator('#inferenceDiagnostics')).not.toBeVisible();
  expect(await page.locator('#measure').innerText()).not.toContain('mtts_can');
  await page.locator('.measurement-diagnostics summary').click();
  await expect(page.locator('#inferenceDiagnostics')).toContainText('mtts_can');
  await page.locator('#continueBtn').click();await expect(page.locator('#questionHr')).toHaveText('78');await expect(page.locator('#questionRr')).toHaveText('측정 불가');
  await expect(page.locator('#questionText')).toContainText('불편한 증상');
  await expect(page.locator('#finalRr')).toHaveText('측정 불가');await expect(page.locator('#finalRrState')).toContainText('부드럽게 전달되지 않아');
});
test('timeline marks 20-second heart and 35-second respiration starts',async({page})=>{
  let connection;
  const send=(type,extra)=>connection.send(JSON.stringify({type,sessionId:'rr-test',revision:0,...extra}));
  const measurement=(rr,hr=72)=>({mode:'real',hr,rr,hrReason:'',rrReason:'호흡수는 35초부터 분석합니다.',
    durationMs:rr===null?20000:36000,fps:30,wave:[],respWave:[],
    metrics:{hr:{sources:[],status:hr===null?'insufficient':'valid'},
      rr:{sources:rr===null?[]:['mtts_can'],status:rr===null?'collecting':'valid'}}});
  await page.routeWebSocket('**/api/measurement',socket=>{
    connection=socket;socket.send(JSON.stringify({type:'connected'}));
    socket.onMessage(raw=>{
      if(typeof raw!=='string' || JSON.parse(raw).type!=='start')return;
      send('started',{});
      send('analysis',{result:measurement(null),final:false});
    });
  });
  await page.addInitScript(()=>{
    navigator.mediaDevices.getUserMedia=async()=>{
      const canvas=document.createElement('canvas');canvas.width=320;canvas.height=240;
      const context=canvas.getContext('2d'),stream=canvas.captureStream(30);
      setInterval(()=>{context.fillStyle='#888';context.fillRect(0,0,320,240);},33);
      return stream;
    };
    window.Worker=class {
      postMessage(message){if(message.type==='init')setTimeout(()=>this.onmessage?.({data:{type:'ready'}}),0);}
      terminate(){}
    };
  });
  await page.goto('/');await page.locator('#startHero').click();await page.locator('#cameraBtn').click();
  await page.locator('#measureBtn').click();
  await expect(page.locator('#hrValue')).toHaveText('72');
  await expect(page.locator('#downloadAnalysisBtn')).toBeDisabled();
  await expect(page.locator('#rrState')).toHaveText('호흡 신호 수집 중');
  await expect(page.locator('#rrDetails')).toContainText('35초부터');
  await expect(page.locator('#timelineHr')).toHaveClass(/is-reached/);
  await expect(page.locator('#timelineRr')).not.toHaveClass(/is-reached/);
  await expect(page.locator('#timelineTrack')).toHaveAttribute('aria-valuenow','20');
  send('state',{state:{phase:'collecting',revision:0,preparedMs:5000,collectedMs:35000,
    elapsedMs:40000,fps:20,droppedFrames:0,reason:'호흡 분석',
    capture:{processedFrames:60,cameraFps:30,processedFps:20,extractionMeanMs:45,pendingReplaced:15}}});
  await expect(page.locator('#rrState')).toHaveText('호흡 분석 중');
  await expect(page.locator('#captureNotice')).toContainText('앱의 처리 속도');
  await expect(page.locator('#timelineRr')).toHaveClass(/is-reached/);
  send('analysis',{result:measurement(16,null),final:false});
  await expect(page.locator('#rrValue')).toHaveText('16');
  await expect(page.locator('#hrValue')).toHaveText('--');
  send('analysis',{result:{...measurement(16,74),durationMs:60000,resultId:'c'.repeat(32),
    hrReason:'신호가 약해 참고용으로 표시합니다.',rrReason:'신호가 약해 참고용으로 표시합니다. 영상이 끊긴 부분을 제외하고 연속된 43.0초 구간으로 추정했습니다.',
    metrics:{hr:{sources:['efficientphys'],status:'tentative'},rr:{sources:['mtts_can'],status:'tentative',partialWindow:true,window:{startMs:17000,endMs:60000}}},
    signalDiagnostics:{'mtts_can:rr':{inputWave:[0,1,0,-1],sampleRate:30}},
    frames:['excluded-video'],answers:['excluded-interview']},final:true});
  await expect(page.locator('#rrState')).toHaveText('신호 약함 · 참고값');
  await expect(page.locator('#hrState')).toHaveText('신호 약함 · 참고값');
  await expect(page.locator('#measureStatus')).toContainText('참고값 포함');
  await expect(page.locator('#finalHrState')).toContainText('참고값');
  await expect(page.locator('#finalRrState')).toContainText('참고값');
  await expect(page.locator('#rrDetails')).toContainText('연속된 43.0초');
  await expect(page.locator('#finalRrState')).toContainText('연속된 43.0초');
  await expect(page.locator('#questionMode')).toContainText('참고값 포함');
  await expect(page.locator('#finalRr')).toHaveText('16');
  await expect(page.locator('#timelineEnd')).toHaveClass(/is-reached/);
  await page.locator('.measurement-diagnostics summary').click();
  await expect(page.locator('#downloadAnalysisBtn')).toBeEnabled();
  const downloading=page.waitForEvent('download');
  await page.locator('#downloadAnalysisBtn').click();
  const download=await downloading;
  expect(download.suggestedFilename()).toMatch(/^measurement-analysis-.*\.json$/);
  const stream=await download.createReadStream(),chunks=[];
  for await(const chunk of stream)chunks.push(chunk);
  const saved=Buffer.concat(chunks).toString('utf8'),parsed=JSON.parse(saved);
  expect(parsed.hr).toBe(74);expect(parsed.rr).toBe(16);
  expect(parsed.metrics.rr.status).toBe('tentative');
  expect(parsed.metrics.rr.partialWindow).toBe(true);
  expect(parsed.metrics.rr.window).toEqual({startMs:17000,endMs:60000});
  expect(parsed.signalDiagnostics['mtts_can:rr'].inputWave).toEqual([0,1,0,-1]);
  expect(saved).not.toContain('excluded-');
  await page.locator('#measureBtn').click();
  await expect(page.locator('#downloadAnalysisBtn')).toBeDisabled();
  await expect(page.locator('#timelineRr')).not.toHaveClass(/is-reached/);
  await expect(page.locator('#captureNotice')).toBeHidden();
});

test('measurement controls fit desktop and narrow screens',async({page},testInfo)=>{
  await page.goto('/');await page.locator('#startHero').click();
  await page.screenshot({path:testInfo.outputPath('measurement-desktop.png'),fullPage:true});
  await page.setViewportSize({width:390,height:844});
  await expect(page.locator('#modeSelect')).toBeVisible();await expect(page.locator('#measureBtn')).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1)).toBe(true);
  await page.screenshot({path:testInfo.outputPath('measurement-mobile.png'),fullPage:true});
});
