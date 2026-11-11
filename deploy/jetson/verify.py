"""Deployment checks; synthetic input only checks execution, never accuracy."""
import argparse
import asyncio
import hashlib
import json
from pathlib import Path
import sys
import struct
import time
from urllib.request import urlopen
from urllib.parse import urlsplit, urlunsplit

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))


def check_health(health):
    if health.get('status') != 'ready' or not health.get('allLearnedReady'):
        raise RuntimeError('Both learned models must be ready: ' + json.dumps(health, ensure_ascii=False))
    models = {m['id']: m for m in health['models']}
    for name in ('efficientphys', 'mtts_can'):
        model = models[name]
        if not model['ready'] or not str(model.get('device', '')).startswith('cuda'):
            raise RuntimeError('Expected a ready CUDA model: ' + json.dumps(model, ensure_ascii=False))
    return models


def local_check():
    import numpy as np
    import torch
    from inference.models import Adapter, SPECS

    if not torch.cuda.is_available():
        raise RuntimeError('CUDA unavailable. Install a PyTorch build compatible with this JetPack first.')
    print('GPU:', torch.cuda.get_device_name(0), 'torch:', torch.__version__, 'CUDA:', torch.version.cuda)
    models = [Adapter(spec) for spec in SPECS]
    check_health({'status': 'ready', 'allLearnedReady': all(m.model is not None for m in models),
                  'models': [m.health() for m in models]})
    frames = np.random.default_rng(42).integers(70, 160, (21, 128, 128, 3), dtype=np.uint8)
    for model in models:
        waves = model.predict(frames)
        for metric in model.spec.metrics:
            if waves[metric].shape != (20,) or not np.isfinite(waves[metric]).all():
                raise RuntimeError(f'{model.spec.id}/{metric}: invalid output')
        print(model.spec.id, 'output execution OK:', ', '.join(waves))
    manifest = json.loads((ROOT / 'chambit_health_demo/assets/manifest.json').read_text(encoding='utf-8'))
    for relative, expected in manifest['checksums'].items():
        content = (ROOT / 'chambit_health_demo' / relative).read_bytes()
        if hashlib.sha256(content).hexdigest() != expected:
            raise RuntimeError('Browser asset checksum mismatch: ' + relative)
    print('Local model and browser assets OK. This is NOT a human accuracy test.')


def server_check(base, wait):
    deadline = time.monotonic() + wait
    while True:
        try:
            with urlopen(base.rstrip('/') + '/api/health', timeout=5) as response:
                health = json.load(response)
            models = check_health(health)
            with urlopen(base.rstrip('/') + '/', timeout=5) as response:
                if response.status != 200 or '<html' not in response.read().decode('utf-8').lower():
                    raise RuntimeError('Web page did not return HTML')
            print(json.dumps({'web': 'ready', 'models': models}, ensure_ascii=False, indent=2))
            return
        except Exception as exc:
            if time.monotonic() >= deadline:
                raise RuntimeError(f'Server check failed: {exc}') from exc
            time.sleep(2)


async def websocket_check(base):
    """Exercise proxy/session/cancel with a no-face packet, not a measurement."""
    import websockets
    parts = urlsplit(base)
    if parts.scheme not in ('http', 'https'):
        raise ValueError('Expected an HTTP(S) base URL')
    address = urlunsplit(('wss' if parts.scheme == 'https' else 'ws', parts.netloc,
                         '/api/measurement', '', ''))
    origin = urlunsplit((parts.scheme, parts.netloc, '', '', ''))
    async with websockets.connect(address, origin=origin, open_timeout=5, close_timeout=5) as ws:
        connected = json.loads(await asyncio.wait_for(ws.recv(), 5))
        if connected.get('type') != 'connected' or connected.get('protocol') != 1:
            raise RuntimeError('Measurement connection unavailable: ' + json.dumps(connected, ensure_ascii=False))
        started_at = time.monotonic() * 1000
        await ws.send(json.dumps({'type': 'start', 't': started_at}))
        started = json.loads(await asyncio.wait_for(ws.recv(), 5))
        if started.get('type') != 'started':
            raise RuntimeError('Measurement session unavailable: ' + json.dumps(started, ensure_ascii=False))
        header = json.dumps({'sessionId': started['sessionId'], 'revision': started['revision'],
                             'seq': 0, 't': started_at, 'rgb': None, 'scene': {}}).encode()
        await ws.send(struct.pack('<I', len(header)) + header)
        state = json.loads(await asyncio.wait_for(ws.recv(), 5))
        if state.get('type') != 'state' or state.get('sessionId') != started['sessionId']:
            raise RuntimeError('Invalid frame state response: ' + json.dumps(state, ensure_ascii=False))
        await ws.send(json.dumps({'type': 'cancel'}))
        await asyncio.wait_for(ws.wait_closed(), 5)
    print('WebSocket start / no-face packet / cancel OK. No camera or physiological result generated.')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument('--local', action='store_true')
    mode.add_argument('--url', help='Web proxy URL, e.g. http://127.0.0.1:5500')
    parser.add_argument('--wait', type=float, default=0)
    parser.add_argument('--websocket', action='store_true', help='Check an idle measurement session and cancel it')
    args = parser.parse_args()
    if args.websocket and not args.url:
        parser.error('--websocket requires --url')
    if args.local:
        local_check()
    else:
        server_check(args.url, args.wait)
        if args.websocket:
            asyncio.run(websocket_check(args.url))


if __name__ == '__main__':
    main()
