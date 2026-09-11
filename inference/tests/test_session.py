import json
import struct
import numpy as np
import pytest
from fastapi import HTTPException
from inference.app import decode_frame, ExpiringStore
from inference.pipeline import Measurement, Pipeline

PIXELS=np.zeros((128,128,3),dtype=np.uint8)
def feed(s,t,valid=True,seq=None):
    return s.feed({'t':t,'seq':s.last_seq+1 if seq is None else seq,'rgb':[120,100,80]},PIXELS if valid else None)

def test_prepare_collection_and_camera_gap():
    s=Measurement(0)
    for t in np.arange(0,5400,1000/30): feed(s,float(t))
    assert s.phase=='collecting'
    revision=s.revision
    s.tick(6000)
    assert s.phase=='preparing' and not s.samples and s.revision==revision+1
    for t in np.arange(6100,11500,1000/30): feed(s,float(t))
    assert s.phase=='collecting'
    assert s.samples[0][0]>=11100

def test_duplicates_rejected_and_brief_loss_does_not_compress_clock():
    s=Measurement(0,prepare_ms=0)
    feed(s,0);feed(s,33)
    assert not feed(s,33,seq=1)
    feed(s,66,False);feed(s,99)
    assert s.state(99)['collectedMs']==99
    assert len(s.samples)==3

def test_timeout_does_not_generate_frames():
    s=Measurement(0)
    s.tick(120001)
    assert s.phase=='timeout' and s.job() is None

def test_binary_protocol_and_payload_validation():
    h=json.dumps({'t':1,'seq':0,'revision':0,'rgb':[120,100,80]}).encode()
    packet=struct.pack('<I',len(h))+h+PIXELS.tobytes()
    header,image=decode_frame(packet)
    assert image.shape==(128,128,3)
    with pytest.raises(ValueError):decode_frame(packet[:-1])
    h=json.dumps({'t':float('nan'),'seq':0,'revision':0,'rgb':None}).encode()
    with pytest.raises(ValueError):decode_frame(struct.pack('<I',len(h))+h)

def test_result_expiry_and_capacity():
    store=ExpiringStore(ttl=10,limit=1)
    store.put('a',1);store.put('b',2)
    with pytest.raises(HTTPException):store.get('a')
    store.ttl=-1
    with pytest.raises(HTTPException):store.get('b')

def test_flat_frames_reject_baselines_and_learned_path():
    s=Measurement(0,prepare_ms=0)
    for i in range(1801):feed(s,i*1000/30)
    result=Pipeline([]).run(s.job(final=True))
    assert result['hr'] is None and result['rr'] is None
