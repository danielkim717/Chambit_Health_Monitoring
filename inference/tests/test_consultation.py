import asyncio
import json
import httpx
import pytest
from fastapi.testclient import TestClient

from inference.app import create_app
from inference.consultation import Interview, organize_facts

RESULT={'mode':'real','hr':72,'rr':None,'quality':'partial'}

def test_unknown_is_not_risk_and_missing_respiration_adds_quality_question():
    interview=Interview(RESULT)
    for q in ['symptoms','onset','context','lifestyle']:interview.answer(q,'unknown')
    assert interview.current()['id']=='quality'
    interview.answer('quality','unknown')
    summary=asyncio.run(interview.summary())
    assert summary['done'] and not summary['urgent']
    assert '호흡수: 측정 불가' in summary['summary']
    assert not any('정상입니다' in text for text in summary['summary'])

def test_severe_symptom_overrides_plausible_numbers_and_never_calls_llm():
    interview=Interview({**RESULT,'rr':15,'quality':'good'},'remote',True)
    interview.answer('symptoms','urgent')
    summary=asyncio.run(interview.summary())
    assert summary['urgent'] and '119' in summary['action']
    assert summary['providerUsed']=='rules'

def test_max_eight_questions_and_duplicate_answer_rejected():
    i=Interview(RESULT)
    for q,answer in [('symptoms','palpitations'),('onset','recurrent'),('context','both'),('lifestyle','both')]:
        i.answer(q,answer)
    assert len(i.queue)==8
    with pytest.raises(ValueError):i.answer('lifestyle','both')

def test_missing_remote_configuration_falls_back_without_fabrication(monkeypatch):
    monkeypatch.delenv('REMOTE_LLM_BASE_URL',raising=False)
    i=Interview(RESULT,'remote',True)
    summary=asyncio.run(i.summary())
    assert summary['providerUsed']=='rules' and summary['fallback']

@pytest.mark.parametrize('output',[{'factIds':['new_diagnosis']},{'factIds':['hr'],'hr':90},{'factIds':['hr','hr']}])
def test_llm_cannot_change_measurements_or_add_diagnoses(monkeypatch,output):
    monkeypatch.setenv('REMOTE_LLM_BASE_URL','https://example.test/v1')
    monkeypatch.setenv('REMOTE_LLM_MODEL','test')
    def handler(request):
        payload=json.loads(request.content)
        assert 'frames' not in str(payload)
        return httpx.Response(200,json={'choices':[{'message':{'content':json.dumps(output)}}]})
    async def run():
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            with pytest.raises(ValueError):
                await organize_facts('remote',True,{'hr':'심박수 72 bpm'},[],client)
    asyncio.run(run())

def test_api_accepts_only_server_owned_result_and_remote_consent():
    with TestClient(create_app(models=[])) as client:
        assert client.post('/api/consultation/start',json={'resultId':'0'*32}).status_code==404
        result=client.post('/api/measurement/demo').json()
        assert result['mode']=='demo'
        assert client.post('/api/consultation/start',json={'resultId':result['resultId'],'hr':200}).status_code==422
        assert client.post('/api/consultation/start',json={'resultId':result['resultId'],'provider':'remote'}).status_code==400
        interview=client.post('/api/consultation/start',json={'resultId':result['resultId']}).json()
        for question in ['symptoms','onset','context','lifestyle']:
            response=client.post('/api/consultation/answer',json={'consultationId':interview['consultationId'],'questionId':question,'optionId':'unknown'})
            assert response.status_code==200
        assert response.json()['done'] and any('가상' in x for x in response.json()['summary'])

def test_valid_llm_selects_only_given_facts_and_omitted_vitals_still_render(monkeypatch):
    monkeypatch.setenv('LOCAL_LLM_BASE_URL','http://127.0.0.1:8080/v1')
    monkeypatch.setenv('LOCAL_LLM_MODEL','test')
    def handler(request):
        return httpx.Response(200,json={'choices':[{'message':{'content':'{"factIds":["limits"]}'}}]})
    async def run():
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            result=await Interview(RESULT,'local').summary(client)
            assert result['providerUsed']=='local'
            assert '심박수 추정값: 72 bpm' in result['summary']
            assert '호흡수: 측정 불가' in result['summary']
    asyncio.run(run())
