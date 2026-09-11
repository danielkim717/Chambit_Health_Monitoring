"""Export native adapters and verify ONNX waveform parity on the current PC."""
import argparse
import json
from pathlib import Path
import numpy as np
import torch
from .models import Adapter, SPECS

class EfficientExport(torch.nn.Module):
    """Equivalent first difference expressed with ONNX-supported slices."""
    def __init__(self, model):
        super().__init__()
        self.base=model

    def forward(self, frames):
        m=self.base
        x=m.batch_norm(frames[1:]-frames[:-1])
        x=torch.tanh(m.motion_conv1(m.TSM_1(x)))
        x=torch.tanh(m.motion_conv2(m.TSM_2(x)))
        x=x*m.attn_mask_1(torch.sigmoid(m.apperance_att_conv1(x)))
        x=m.dropout_1(m.avg_pooling_1(x))
        x=torch.tanh(m.motion_conv3(m.TSM_3(x)))
        x=torch.tanh(m.motion_conv4(m.TSM_4(x)))
        x=x*m.attn_mask_2(torch.sigmoid(m.apperance_att_conv2(x)))
        x=m.dropout_3(m.avg_pooling_3(x)).flatten(1)
        return m.final_dense_2(m.dropout_4(torch.tanh(m.final_dense_1(x))))

def main():
    import onnxruntime as ort
    parser=argparse.ArgumentParser()
    parser.add_argument('--output',type=Path,default=Path('inference/artifacts'))
    args=parser.parse_args();args.output.mkdir(parents=True,exist_ok=True)
    report={}
    for spec in SPECS:
        model=Adapter(spec)
        if model.model is None:raise RuntimeError(model.error)
        model.model=model.model.cpu()
        frames=np.random.default_rng(9).integers(60,180,(181,128,128,3),dtype=np.uint8)
        prepared=model.prepare(frames)
        names=['frames'] if spec.id=='efficientphys' else ['motion','appearance']
        output=args.output/(spec.id+'.onnx')
        dynamic={name:{0:'frames_plus_one' if name=='frames' else 'frames'} for name in names}
        dynamic.update({metric:{0:'frames'} for metric in spec.metrics})
        export_model=EfficientExport(model.model).eval() if spec.id=='efficientphys' else model.model
        torch.onnx.export(export_model,tuple(torch.from_numpy(x) for x in prepared),str(output),
                          input_names=names,output_names=list(spec.metrics),dynamic_axes=dynamic,
                          opset_version=17,dynamo=False)
        session=ort.InferenceSession(str(output),providers=['CPUExecutionProvider'])
        errors={}
        # Both the regular chunk and the short live tail must execute.
        for length in (181,61):
            arrays=model.prepare(frames[:length])
            with torch.inference_mode():
                expected=model.model(*[torch.from_numpy(x) for x in arrays])
            expected=expected if isinstance(expected,tuple) else (expected,)
            actual=session.run(None,dict(zip(names,arrays)))
            for metric,a,b in zip(spec.metrics,expected,actual):
                np.testing.assert_allclose(a.numpy(),b,atol=2e-5,rtol=2e-3)
                errors[f'{metric}_{length}']=float(np.max(np.abs(a.numpy()-b)))
        report[spec.id]={'path':str(output),'maxAbsoluteErrors':errors}
    (args.output/'onnx-parity.json').write_text(json.dumps(report,indent=2)+'\n')
    print(json.dumps(report,indent=2))

if __name__=='__main__':main()
