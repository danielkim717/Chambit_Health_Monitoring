"""Timestamp-based acquisition tests, not human respiratory accuracy evidence."""
import numpy as np
import pytest
from inference.pipeline import Measurement, capture_intervals

PIXELS = np.zeros((1, 1, 3), dtype=np.uint8)

def feed(s, t):
    s.feed({'t': t, 'seq': s.last_seq+1, 'rgb': [100+np.sin(t/1000), 110, 120]}, PIXELS)

def test_short_gap_extends_capture_until_real_35_second_interval_is_available():
    s = Measurement(0, prepare_ms=0, rr_min_fps=24)
    jobs = []
    for i in range(2701):
        t = i*1000/30
        if 31700 < t < 31900: continue
        feed(s, t)
        request = s.job(final=s.phase=='complete')
        if request: jobs.append(request)
        if i==1800:
            assert s.phase=='collecting' and s.extending
            assert s.state(t)['respirationCapture']['longestMs'] < 35000
        if s.phase=='complete': break
    assert 66900 <= s.good <= 67000
    assert s.capture_check['longestMs'] >= 35000
    assert not s.extending
    assert s.samples[-1][0]-s.samples[0][0] <= 60000+1000/30+1e-6
    assert len(s.samples)<=1802
    assert s.state(s.good)['fps'] > 29
    assert any(not j['final'] and j['state']['collectionElapsedMs']>60000 for j in jobs)
    assert jobs[-1]['final']

@pytest.mark.parametrize('fps', [20, 30])
def test_extra_capture_is_bounded_even_when_the_condition_never_succeeds(fps):
    s = Measurement(0, prepare_ms=0, rr_min_fps=24)
    for i in range(90*fps+1):
        t=i*1000/fps
        if fps==30 and any(bound<t<bound+200 for bound in (20000,40000,60000,80000)):continue
        feed(s,t)
    assert s.phase=='complete' and s.good==90000
    assert s.capture_check['longestMs']<35000
    assert s.state(s.good)['respirationCapture']['extraMs']==30000

def test_no_ready_respiratory_model_does_not_add_waiting():
    s=Measurement(0,prepare_ms=0)
    for i in range(1201):feed(s,i*50)
    assert s.phase=='complete' and not s.extending

def test_restart_and_attempt_deadline_take_precedence_over_extension():
    s=Measurement(0,prepare_ms=0,rr_min_fps=24,max_ms=80000)
    for i in range(1201):feed(s,i*50)
    assert s.extending
    s.tick(60600)
    assert s.phase=='preparing' and not s.extending and s.capture_check=={}
    bounded=Measurement(0,prepare_ms=0,rr_min_fps=24,max_ms=80000)
    for i in range(1581):feed(bounded,i*50)
    assert bounded.phase=='complete' and bounded.good==79000

def test_diagnostics_explain_gaps_without_creating_missing_samples():
    samples=tuple((t,) for t in [0, 33, 66, 258, 291])
    result=capture_intervals(samples)
    assert result['gapCount']==1
    assert result['gaps']==[{'startMs':66.,'endMs':258.,'durationMs':192.}]
    assert len(result['intervals'])==2
    assert result['longestMs']==0
