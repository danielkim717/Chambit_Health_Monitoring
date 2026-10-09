# 파일 역할: 공식 모델 코드와 가중치 준비
# 연결과 사용: models.lock.json에 지정된 출처와 체크섬으로 필요한 모델 파일을 내려받습니다.
# 파일 안내: docs/FILE_GUIDE.md
"""Fetch official model artifacts, pin revisions and verify every subsequent download.

Run from the repository root: python -m inference.setup_models
The first bootstrap writes models.lock.json; review/commit that lock with the source.
No downloaded Python code is executed by this installer.
"""
import hashlib
import json
from pathlib import Path
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parent
LOCK = ROOT / 'models.lock.json'
SOURCES = {
    'efficientphys.py': ('ubicomplab/rPPG-Toolbox', 'neural_methods/model/EfficientPhys.py'),
    'PURE_EfficientPhys.pth': ('ubicomplab/rPPG-Toolbox', 'final_model_release/PURE_EfficientPhys.pth'),
    'rppg-toolbox-LICENSE': ('ubicomplab/rPPG-Toolbox', 'LICENSE'),
    'mtts_model.py': ('xliucs/MTTS-CAN', 'code/model.py'),
    'mtts_can.hdf5': ('xliucs/MTTS-CAN', 'mtts_can.hdf5'),
    'mtts-can-LICENSE': ('xliucs/MTTS-CAN', 'LICENSE'),
}

def fetch(url):
    with urlopen(Request(url, headers={'User-Agent': 'Chambit-model-setup'}), timeout=90) as response:
        return response.read()

def main():
    folder = ROOT / 'weights'
    folder.mkdir(exist_ok=True)
    lock = json.loads(LOCK.read_text()) if LOCK.exists() else {}
    revisions = {}
    for name, (repo, source) in SOURCES.items():
        entry = lock.get(name)
        if entry:
            url = entry['url']
        else:
            if repo not in revisions:
                revisions[repo] = json.loads(fetch(f'https://api.github.com/repos/{repo}/commits/main'))['sha']
            url = f'https://raw.githubusercontent.com/{repo}/{revisions[repo]}/{source}'
        path = folder / name
        data = path.read_bytes() if path.exists() else fetch(url)
        digest = hashlib.sha256(data).hexdigest()
        if entry and digest != entry['sha256']:
            raise RuntimeError(f'Checksum mismatch: {name}; remove only this artifact and retry.')
        if len(data) < 200 or data.startswith(b'version https://git-lfs'):
            raise RuntimeError(f'Not a complete artifact: {name}')
        path.write_bytes(data)
        lock[name] = {'url': url, 'sha256': digest, 'bytes': len(data)}
        # Retain progress if a later network request fails.
        LOCK.write_text(json.dumps(lock, indent=2) + '\n', encoding='utf-8')
        print(f'{name}: {len(data)} bytes, sha256={digest}', flush=True)

if __name__ == '__main__':
    main()
