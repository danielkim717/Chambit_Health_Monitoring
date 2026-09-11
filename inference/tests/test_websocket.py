"""Transport/state tests use a marked estimator double, not accuracy evidence."""
import json
import struct
import time
import numpy as np
from fastapi.testclient import TestClient
from inference.app import create_app

class EstimatorDouble:
    calls=[]
    def __init__(self,models):pass
    def run(self,job):
        self.calls.append((job['revision'],job['final']))
        time.sleep(.005)
        return {'mode':'real','hr':None,'rr':None,'quality':'insufficient',
                'durationMs':job['samples'][-1][0]-job['samples'][0][0],
                'hrReason':'test double','rrReason':'test double','fps':30}

def send_frame(ws,session_id,seq,t,revision=0,valid=True):
    header={'sessionId':session_id,'seq':seq,'t':t,'revision':revision,
            'rgb':[120+seq%3,100,80] if valid else None}
    encoded=json.dumps(header).encode()
    ws.send_bytes(struct.pack('<I',len(encoded))+encoded+(bytes(128*128*3) if valid else b''))

def state(ws):
    while True:
        message=ws.receive_json()
        if message['type']=='state':return message['state']

def test_websocket_final_result_is_server_owned_and_can_start_interview():
    with TestClient(create_app(models=[],pipeline_factory=EstimatorDouble)) as client:
        with client.websocket_connect('/api/measurement') as ws:
            assert ws.receive_json()['type']=='connected'
            ws.send_json({'type':'start','t':0})
            sid=ws.receive_json()['sessionId']
            for seq in range(1952):
                send_frame(ws,sid,seq,seq*1000/30)
                s=state(ws)
                if s['phase']=='complete':break
            while True:
                result=ws.receive_json()
                if result['type']=='analysis' and result['final']:break
            result_id=result['result']['resultId']
            ws.send_json({'type':'cancel'})
        reply=client.post('/api/consultation/start',json={'resultId':result_id})
        assert reply.status_code==200

def test_cancel_and_revision_reject_wrong_session_frames():
    with TestClient(create_app(models=[])) as client:
        with client.websocket_connect('/api/measurement') as ws:
            ws.receive_json();ws.send_json({'type':'start','t':0});sid=ws.receive_json()['sessionId']
            send_frame(ws,sid,0,0);assert state(ws)['revision']==0
            send_frame(ws,sid,1,600);assert state(ws)['revision']==1
            send_frame(ws,sid,2,633,revision=0);assert state(ws)['revision']==1
            send_frame(ws,'wrong',3,666,revision=1)
            assert ws.receive_json()['type']=='error'
