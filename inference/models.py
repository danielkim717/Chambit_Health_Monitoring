# 파일 역할: 학습 모델 로딩과 실행 방식 통일
# 연결과 사용: 공식 가중치의 출처·체크섬을 확인하고 EfficientPhys·MTTS-CAN 실행을 연결합니다.
# 파일 안내: docs/FILE_GUIDE.md
"""Versioned model adapters; native inference and optional ONNX execution.

MTTS-CAN is an inference-only PyTorch translation of Xin Liu's MIT implementation.
Weights remain the original Keras HDF5 tensors; NHWC flatten order is preserved.
See weights/mtts-can-LICENSE and models.lock.json for upstream attribution.
"""
from dataclasses import dataclass
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import time

import cv2
import numpy as np
import torch
from torch import nn

ROOT = Path(__file__).resolve().parent
WEIGHTS = ROOT / 'weights'
DEVICE = os.getenv('INFERENCE_DEVICE', 'cuda' if torch.cuda.is_available() else 'cpu')
torch.set_num_threads(int(os.getenv('TORCH_THREADS', '2')))

@dataclass(frozen=True)
class ModelSpec:
    id: str
    size: int
    metrics: tuple
    checkpoint: str
    source: str
    license: str = 'See downloaded upstream LICENSE and models.lock.json'
    fps: int = 30
    min_fps: int = 24
    chunk_frames: int = 180
    frame_depth: int = 10
    output: str = 'temporal_difference'

SPECS = [
    ModelSpec('efficientphys', 72, ('hr',), 'PURE_EfficientPhys.pth', 'ubicomplab/rPPG-Toolbox'),
    ModelSpec('mtts_can', 36, ('hr', 'rr'), 'mtts_can.hdf5', 'xliucs/MTTS-CAN'),
]

def verified(name):
    lock = json.loads((ROOT / 'models.lock.json').read_text())
    path = WEIGHTS / name
    if hashlib.sha256(path.read_bytes()).hexdigest() != lock[name]['sha256']:
        raise ValueError(f'가중치 무결성 오류: {name}')
    return path

def standardize(x):
    return (x - x.mean()) / max(float(x.std()), 1e-6)

def shift(x):
    n, c, h, w = x.shape
    x = x.reshape(-1, 10, c, h, w)
    fold = c // 3
    out = torch.zeros_like(x)
    out[:, :-1, :fold] = x[:, 1:, :fold]
    out[:, 1:, fold:2*fold] = x[:, :-1, fold:2*fold]
    out[:, :, 2*fold:] = x[:, :, 2*fold:]
    return out.reshape(n, c, h, w)

def attention(x):
    return x / x.sum(dim=(2, 3), keepdim=True).clamp_min(1e-8) * x.shape[2] * x.shape[3] * .5

class MttsNetwork(nn.Module):
    def __init__(self, checkpoint):
        super().__init__()
        import h5py
        self.layers = nn.ModuleDict()
        with h5py.File(checkpoint, 'r') as f:
            for name in ['conv2d'] + [f'conv2d_{i}' for i in range(1, 10)] + ['dense', 'dense_1', 'output_1', 'output_2']:
                group = f['model_weights'][name][name]
                kernel, bias = np.array(group['kernel:0']), np.array(group['bias:0'])
                if kernel.ndim == 4:
                    padding = 1 if name in ['conv2d', 'conv2d_2', 'conv2d_5', 'conv2d_7'] else 0
                    layer = nn.Conv2d(kernel.shape[2], kernel.shape[3], kernel.shape[0], padding=padding)
                    kernel = kernel.transpose(3, 2, 0, 1)
                else:
                    layer = nn.Linear(kernel.shape[0], kernel.shape[1])
                    kernel = kernel.T
                layer.weight.data.copy_(torch.from_numpy(kernel.copy()))
                layer.bias.data.copy_(torch.from_numpy(bias))
                self.layers[name] = layer

    def forward(self, motion, appearance):
        c = lambda name, x: torch.tanh(self.layers[name](x))
        d = c('conv2d_1', shift(c('conv2d', shift(motion))))
        a = c('conv2d_3', c('conv2d_2', appearance))
        d = nn.functional.avg_pool2d(d * attention(torch.sigmoid(self.layers['conv2d_4'](a))), 2)
        a = nn.functional.avg_pool2d(a, 2)
        d = c('conv2d_6', shift(c('conv2d_5', shift(d))))
        a = c('conv2d_8', c('conv2d_7', a))
        d = nn.functional.avg_pool2d(d * attention(torch.sigmoid(self.layers['conv2d_9'](a))), 2)
        # Keras Flatten is channels-last. Flattening NCHW silently corrupts both heads.
        flat = d.permute(0, 2, 3, 1).reshape(d.shape[0], -1)
        return (self.layers['output_1'](c('dense', flat)),
                self.layers['output_2'](c('dense_1', flat)))

class Adapter:
    def __init__(self, spec):
        self.spec = spec
        self.error = None
        self.model = None
        self.runtime = 'pytorch'
        self.warmup_ms = None
        try:
            checkpoint = verified(spec.checkpoint)
            onnx_path = os.getenv(f'{spec.id.upper()}_ONNX')
            if onnx_path:
                import onnxruntime as ort
                self.model = ort.InferenceSession(onnx_path, providers=['CPUExecutionProvider'])
                self.runtime = 'onnxruntime'
            elif spec.id == 'efficientphys':
                source = verified('efficientphys.py')
                module_spec = importlib.util.spec_from_file_location('official_efficientphys', source)
                module = importlib.util.module_from_spec(module_spec)
                module_spec.loader.exec_module(module)
                self.model = module.EfficientPhys(frame_depth=10, img_size=72).to(DEVICE)
                weights = torch.load(checkpoint, map_location=DEVICE, weights_only=True)
                self.model.load_state_dict({k.removeprefix('module.'): v for k, v in weights.items()}, strict=True)
                self.model.eval()
            else:
                self.model = MttsNetwork(checkpoint).to(DEVICE).eval()
            started = time.perf_counter()
            # Warmup never becomes a measurement.
            self.predict(np.random.default_rng(42).integers(70, 160, (11, 128, 128, 3), dtype=np.uint8))
            self.warmup_ms = round((time.perf_counter() - started) * 1000, 1)
        except Exception as exc:
            self.model = None
            self.error = f'{type(exc).__name__}: {exc}'

    def prepare(self, frames):
        x = np.stack([cv2.resize(f, (self.spec.size, self.spec.size), interpolation=cv2.INTER_AREA) for f in frames]).astype(np.float32)
        if self.spec.id == 'efficientphys':
            return [standardize(x).transpose(0, 3, 1, 2).copy()]
        x = np.clip(x / 255., 1/255., 1.)
        motion = np.diff(x, axis=0) / np.maximum(x[1:] + x[:-1], 1e-6)
        motion /= max(float(motion.std()), 1e-6)
        appearance = standardize(x)[:-1]
        return [motion.transpose(0, 3, 1, 2).copy(), appearance.transpose(0, 3, 1, 2).copy()]

    def predict(self, frames):
        if self.model is None:
            raise RuntimeError(self.error or 'Model not loaded')
        n = (len(frames) - 1) // 10 * 10
        if n < 10:
            raise ValueError('At least 11 real frames are required')
        inputs = self.prepare(frames[:n+1])
        if self.runtime == 'onnxruntime':
            outputs = self.model.run(None, {i.name: a for i, a in zip(self.model.get_inputs(), inputs)})
        else:
            with torch.inference_mode():
                outputs = self.model(*[torch.from_numpy(a).to(DEVICE) for a in inputs])
                outputs = outputs if isinstance(outputs, tuple) else (outputs,)
                outputs = [a.cpu().numpy() for a in outputs]
        result = {metric: a.reshape(-1).astype(np.float64) for metric, a in zip(self.spec.metrics, outputs)}
        if any(len(a) != n or not np.isfinite(a).all() for a in result.values()):
            raise ValueError('Invalid model waveform')
        return result

    def health(self):
        from dataclasses import asdict
        return {**asdict(self.spec), 'ready': self.model is not None, 'error': self.error,
                'runtime': self.runtime, 'device': DEVICE if self.runtime == 'pytorch' else 'cpu',
                'warmupMs': self.warmup_ms,
                'runtimeSha256': hashlib.sha256(Path(os.environ[f'{self.spec.id.upper()}_ONNX']).read_bytes()).hexdigest() if self.runtime == 'onnxruntime' else None,
                'sha256': json.loads((ROOT / 'models.lock.json').read_text()).get(self.spec.checkpoint, {}).get('sha256') if (ROOT / 'models.lock.json').exists() else None}

def load_models():
    enabled = os.getenv('ENABLED_MODELS', 'efficientphys,mtts_can').split(',')
    return [Adapter(s) for s in SPECS if s.id in enabled]
