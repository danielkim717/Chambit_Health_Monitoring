import numpy as np
import pytest

from inference.signals import candidate, fuse, derived_respiration

@pytest.mark.parametrize('metric,rate', [('hr',60),('hr',90),('hr',120),('rr',9),('rr',15),('rr',24)])
def test_periodic_waveforms(metric,rate):
    t=np.arange(1800)/30
    c=candidate('test',metric,np.sin(2*np.pi*rate/60*t),30,0,60000)
    assert c['status']=='valid'
    assert abs(c['value']-rate)<1

def test_flat_and_noise_are_not_measurements():
    for x in [np.zeros(1800),np.random.default_rng(5).normal(size=1800)]:
        assert candidate('test','hr',x,30,0,60000)['value'] is None
    assert derived_respiration(np.sin(np.arange(1800)/30*2*np.pi),30,0,60000) is None


def test_rejected_respiration_keeps_evidence_without_becoming_a_measurement():
    import json
    # A changing respiratory frequency has a spectral peak, but is not periodic.
    from scipy.signal import chirp
    wave = chirp(np.arange(1800)/30, f0=.12, f1=.48, t1=60)
    ordinary = candidate('test', 'rr', wave, 30, 0, 60000)
    detailed = candidate('test', 'rr', wave, 30, 0, 60000, include_diagnostics=True)
    assert detailed['value'] is None and 'periodicity' in detailed['rejectionCodes']
    assert detailed['checks']['periodicity']['actual'] < .4
    assert detailed['features']['spectralPeakRate'] > 0
    assert 'signalDiagnostics' not in ordinary
    assert detailed['signalDiagnostics']['inputWave'] == wave.tolist()
    assert len(detailed['signalDiagnostics']['filteredWave']) == 1680
    assert detailed['signalDiagnostics']['filteredStartMs'] == 2000
    assert ordinary == {k: v for k, v in detailed.items() if k != 'signalDiagnostics'}
    json.dumps(detailed, allow_nan=False)


def test_nonfinite_diagnostic_input_is_not_serialized_as_nan():
    import json
    result = candidate('test', 'rr', np.full(1800, np.nan), 30, 0, 60000,
                       include_diagnostics=True)
    assert result['value'] is None and 'finite' in result['rejectionCodes']
    assert result['signalDiagnostics']['inputWave'] == []
    json.dumps(result, allow_nan=False)

def c(id,value,quality=.9,metric='hr',**kwargs):
    return dict(id=id,model=id,family=id,metric=metric,value=value,quality=quality,
                status='valid',startMs=0,endMs=60000,features={},**kwargs)

def test_conflict_does_not_average_mutually_exclusive_rates():
    result,audit=fuse([c('a',72),c('b',144)],'hr')
    assert result['value'] is None and result['status']=='conflict'
    assert any(x['kind']=='harmonic' for x in audit['debate'])

def test_proposal_cannot_invent_rate_or_fuse_clusters():
    result,audit=fuse([c('a',72),c('b',74),c('c',130,.6)],'hr',
                      {'selected':['a','c'], 'value':100,'weights':[0,1]})
    assert 72 <= result['value'] <=74
    assert audit['action']=='repair'

def test_no_double_votes_or_mixing_metrics_and_windows():
    a,b=c('a',72),c('b',74)
    b['family']='a'
    old=c('old',110);old['endMs']=30000
    result,audit=fuse([a,b,old,c('rr',15,metric='rr')],'hr')
    assert result['value']==72 and audit['selected']==['a']

def test_cluster_width_does_not_chain_incompatible_candidates():
    result,audit=fuse([c('a',70),c('b',74),c('c',78)],'hr')
    assert result['value'] is None
    assert len(audit['clusters'])==2

@pytest.mark.parametrize('selected',[[{'id':'a'}],['a','a'],None])
def test_malformed_proposal_is_repaired(selected):
    result,audit=fuse([c('a',72)],'hr',{'selected':selected})
    assert result['value']==72 and audit['action']=='repair'
