import json
import numpy as np
import pytest
import torch
from inference.models import Adapter, SPECS, WEIGHTS

@pytest.mark.parametrize('spec',SPECS,ids=lambda s:s.id)
def test_official_checkpoint_output_and_repeatability(spec):
    if not (WEIGHTS/spec.checkpoint).exists():
        pytest.skip('Run python -m inference.setup_models to test real weights')
    model=Adapter(spec)
    assert model.model is not None,model.error
    frames=np.random.default_rng(3).integers(70,170,(21,128,128,3),dtype=np.uint8)
    a,b=model.predict(frames),model.predict(frames)
    assert set(a)==set(spec.metrics)
    for key in a:
        assert a[key].shape==(20,)
        assert np.isfinite(a[key]).all()
        np.testing.assert_array_equal(a[key],b[key])

def keras_numpy_reference(inputs,checkpoint):
    """Independent NHWC executor of the original saved Keras graph, for parity.

    Inference-only subset. Reads the HDF5 graph rather than a PyTorch layer order.
    This does not assert parity of the streaming preprocessing with a whole video.
    """
    import h5py
    with h5py.File(checkpoint,'r') as f:
        graph=json.loads(f.attrs['model_config'])['config']
        values={}
        for node in graph['layers']:
            name,kind,config=node['name'],node['class_name'],node['config']
            if kind=='InputLayer':
                values[name]=inputs[len(values)]
                continue
            incoming=[values[x[0]] for x in node['inbound_nodes'][0]]
            x=incoming[0]
            if kind=='TSM':
                z=x.reshape(-1,10,*x.shape[1:]);out=np.zeros_like(z);fold=x.shape[-1]//3
                out[:,:-1,...,:fold]=z[:,1:,...,:fold]
                out[:,1:,...,fold:2*fold]=z[:,:-1,...,fold:2*fold]
                out[...,2*fold:]=z[...,2*fold:];x=out.reshape(x.shape)
            elif kind=='Conv2D':
                w=np.array(f['model_weights'][name][name]['kernel:0'])
                b=np.array(f['model_weights'][name][name]['bias:0'])
                k=w.shape[0]
                if config['padding']=='same' and k>1:x=np.pad(x,((0,0),(k//2,k//2),(k//2,k//2),(0,0)))
                patches=np.lib.stride_tricks.sliding_window_view(x,(k,k),axis=(1,2))
                x=np.einsum('nhwcij,ijco->nhwo',patches,w,optimize=True)+b
                x=np.tanh(x) if config['activation']=='tanh' else 1/(1+np.exp(-x))
            elif kind=='Attention_mask':
                x=x/x.sum(axis=(1,2),keepdims=True)*x.shape[1]*x.shape[2]*.5
            elif kind=='Multiply':x=incoming[0]*incoming[1]
            elif kind=='AveragePooling2D':
                h,w=x.shape[1]//2,x.shape[2]//2
                x=x[:,:h*2,:w*2].reshape(x.shape[0],h,2,w,2,x.shape[3]).mean(axis=(2,4))
            elif kind=='Flatten':x=x.reshape(len(x),-1)
            elif kind=='Dense':
                x=x@np.array(f['model_weights'][name][name]['kernel:0'])+np.array(f['model_weights'][name][name]['bias:0'])
                if config['activation']=='tanh':x=np.tanh(x)
            elif kind!='Dropout':raise AssertionError(kind)
            values[name]=x
        return [values[node[0]] for node in graph['output_layers']]

def test_mtts_matches_saved_keras_graph_both_heads():
    if not (WEIGHTS/'mtts_can.hdf5').exists():pytest.skip('Model weights not installed')
    adapter=Adapter(SPECS[1])
    frames=np.random.default_rng(7).integers(60,170,(11,128,128,3),dtype=np.uint8)
    inputs=adapter.prepare(frames)
    expected=keras_numpy_reference([x.transpose(0,2,3,1) for x in inputs],WEIGHTS/'mtts_can.hdf5')
    actual=adapter.predict(frames)
    for metric,target in zip(('hr','rr'),expected):
        np.testing.assert_allclose(actual[metric],target.ravel(),atol=2e-5,rtol=2e-4)


def test_mtts_window_batches_match_one_shared_normalization_and_monolithic_network():
    if not (WEIGHTS/'mtts_can.hdf5').exists():pytest.skip('Model weights not installed')
    adapter=Adapter(SPECS[1])
    assert adapter.spec.normalization == 'continuous_window'
    # Lighting and motion scale vary across batches. Independent normalization
    # would change the network input and fail parity with the complete interval.
    rng=np.random.default_rng(10)
    t=np.arange(401,dtype=np.float32)
    texture=rng.normal(0,8,(36,36,3)).astype(np.float32)
    frames=100+texture[None]+(t*.06+np.sin(t*.07)*(1+t*.01))[:,None,None,None]
    prepared=adapter.prepare(frames)
    expected=adapter.forward(prepared)
    forwarded=[]
    forward=adapter.forward
    def track(inputs):
        forwarded.append(len(inputs[0]))
        return forward(inputs)
    adapter.forward=track
    actual=adapter.predict(frames)
    assert forwarded == [180,180,40]
    for metric,target in zip(adapter.spec.metrics,expected):
        np.testing.assert_allclose(actual[metric],target.ravel(),atol=2e-5,rtol=2e-4)
    # Regression evidence: this fixture distinguishes the old per-chunk inputs.
    old=adapter.prepare(frames[:181])
    assert not np.allclose(old[0],prepared[0][:180])
    assert not np.allclose(old[1],prepared[1][:180])
