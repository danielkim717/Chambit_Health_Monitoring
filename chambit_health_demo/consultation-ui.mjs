const el=id=>document.getElementById(id);
async function post(path,body,signal){
  const response=await fetch(path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal});
  const data=await response.json();
  if(!response.ok)throw new Error(typeof data.detail==='string'?data.detail:'문진 요청을 처리하지 못했습니다.');
  return data;
}
export function mountConsultation({getResult,onComplete}){
  let interview=null,done=false,generation=0,abort=null,busy=false;
  function reset(){
    generation++;abort?.abort();interview=null;done=false;busy=false;
    el('consultationStatus').textContent='';el('answerOptions').replaceChildren();
  }
  function render(data){
    interview=data;
    el('consultationStatus').textContent='';
    el('qCount').textContent=data.done?'문진 완료':(data.answered+1)+' / '+data.total;
    el('qProgress').style.width=(data.done?100:data.answered/data.total*100)+'%';
    if(data.done){
      done=true;
      el('resultTitle').textContent=data.title;
      el('resultDesc').textContent=data.mode==='demo'?'가상 측정값으로 진행한 문진입니다.':'이번 측정과 사용자 응답에 근거한 안내입니다.';
      el('actionText').textContent=data.action;
      el('scoreLabel').textContent=data.urgent?'즉시 도움 요청':'다음 행동';
      el('providerUsed').textContent=data.fallback || ({rules:'로컬 규칙으로 정리',remote:'외부 LLM이 선택한 검증 문구',local:'로컬 LLM이 선택한 검증 문구'}[data.providerUsed]);
      const wrap=el('consultationSummary');wrap.replaceChildren();
      for(const text of data.summary){const p=document.createElement('p');p.textContent=text;wrap.append(p);}
      for(const answer of data.answers){
        if(!answer.note)continue;
        const p=document.createElement('p');p.textContent='추가 기록 (사용자 입력): '+answer.note;wrap.append(p);
      }
      const choices=Object.fromEntries(data.answers.map(a=>[a.questionId,a.optionId]));
      el('stressResult').textContent=['stress','both'].includes(choices.lifestyle)?'스트레스 있음':choices.lifestyle==='good'?'적음':'확인 안 됨';
      el('sleepResult').textContent=['sleep','both'].includes(choices.lifestyle)?'수면 부족':choices.lifestyle==='good'?'충분':'확인 안 됨';
      el('medicalNotice').hidden=!data.urgent && !data.summary.some(x=>x.includes('의료진과 상담'));
      const icon=document.querySelector('.status-icon');icon.textContent=data.urgent?'!':'✓';icon.classList.toggle('caution',data.urgent);
      onComplete();return;
    }
    el('questionText').textContent=data.question.text;
    el('answerNote').value='';
    const wrap=el('answerOptions');wrap.replaceChildren();
    for(const option of data.question.options){
      const button=document.createElement('button');button.className='answer-btn';button.textContent=option.text;
      button.onclick=()=>answer(data.question.id,option.id);
      wrap.append(button);
    }
  }
  async function start(){
    reset();const ticket=generation;
    abort=new AbortController();
    el('questionText').textContent='측정 결과로 문진을 준비합니다.';
    try{
      let result=getResult();
      if(!result)throw new Error('측정 결과가 없습니다. 측정을 완료해 주세요.');
      if(result.mode==='demo' && !result.resultId)result=await post('/api/measurement/demo',{},abort.signal);
      const provider=el('consultationProvider').value,consent=el('remoteConsent').checked;
      if(provider==='remote' && !consent)throw new Error('설정에서 측정 요약과 답변의 외부 전송에 동의하거나 로컬 문진을 선택하세요.');
      const data=await post('/api/consultation/start',{resultId:result.resultId,provider,consent},abort.signal);
      if(ticket===generation)render(data);
    }catch(error){
      if(ticket!==generation)return;
      el('consultationStatus').textContent=error.message;
      const button=document.createElement('button');button.className='secondary';button.textContent='문진 다시 연결';button.onclick=start;
      el('answerOptions').replaceChildren(button);
    }
  }
  async function answer(questionId,optionId){
    if(busy || done)return;
    busy=true;const ticket=generation;
    for(const b of el('answerOptions').children)b.disabled=true;
    el('consultationStatus').textContent='응답을 정리합니다…';
    try{
      const data=await post('/api/consultation/answer',{consultationId:interview.consultationId,questionId,optionId,note:el('answerNote').value},abort.signal);
      if(ticket===generation)render(data);
    }catch(error){if(ticket===generation)el('consultationStatus').textContent=error.message;}
    finally{if(ticket===generation){busy=false;for(const b of el('answerOptions').children)b.disabled=false;}}
  }
  el('consultationProvider').onchange=()=>{
    el('remoteConsentWrap').hidden=el('consultationProvider').value!=='remote';
    if(el('consultationProvider').value!=='remote')el('remoteConsent').checked=false;
  };
  return {start,reset,get done(){return done;}};
}
