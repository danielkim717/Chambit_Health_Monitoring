# Jetson Orin Nano 개발·배포

## 현재 상태 · 2026-11-11

- 대상: Jetson **Orin Nano** 개발자 키트. 사용자가 설치한 JetPack은 6.2이며 실제 버전·메모리·CUDA는 접속 후 확인한다.
- 노트북에 VS Code Remote-SSH와 OpenAI Codex 확장이 설치되어 있다.
- 이전 주소 `192.168.68.67`로 SSH 접속을 시도했으나 응답 시간이 초과됐다. 젯슨의 현재 주소와 로그인 확인이 필요하다.
- 이 문서와 배포 도구는 준비 단계다. **젯슨에 설치·GPU 추론·서비스 자동 시작·카메라 측정을 완료했다는 기록이 아니다.**
- PC의 동작 기준을 보존하고 젯슨에 별도 복제한다. Windows 가상환경과 node_modules는 복사하지 않는다.

## 1. 접속과 원격 개발

젯슨 터미널에서 `hostname -I`로 현재 LAN 주소를 확인한다. 노트북과 같은 네트워크를 사용한다.
`172.17.*` Docker 주소는 사용하지 않는다. SSH 서버가 없을 때만 다음을 실행한다.

```bash
sudo apt-get update
sudo apt-get install openssh-server
sudo systemctl enable --now ssh
```

노트북 PowerShell에서 `ssh taewoo@현재주소`로 로그인한다. 최초 접속 시 표시되는 호스트 키는
젯슨의 `ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub` 결과와 비교한다.
비밀번호는 로컬 SSH 로그인 창에서 입력하며 코드·문서·채팅에 저장하지 않는다.

VS Code에서 `Remote-SSH: Connect to Host...` → `taewoo@현재주소`를 선택한다.
연결된 원격 창에서 젯슨의 프로젝트 폴더를 열고 Codex 확장의 원격 실행과 파일 접근을 확인한다.
현재 대화의 맥락은 자동 전달된다고 가정하지 말고 README·이 문서·구현 현황을 먼저 읽게 한다.

```bash
mkdir -p ~/apps
cd ~/apps
git clone https://github.com/danielkim717/Chambit_Health_Monitoring.git
cd Chambit_Health_Monitoring
bash deploy/jetson/inspect.sh
```

이미 같은 폴더가 있다면 덮어쓰지 않는다. `git status`와 원격 주소부터 확인한다.
`inspect.sh`는 OS·L4T·자원·Python·Node·시스템 PyTorch를 읽기만 한다.

## 2. 화면 접속 먼저 확인

Node.js 22 이상을 준비하고 젯슨의 프로젝트 루트에서 실행한다.

```bash
node chambit_health_demo/server.js
```

노트북의 기존 프로젝트 루트에서 다음을 실행한다. `현재주소`는 실제 IP로 바꾼다.

```powershell
./deploy/jetson/connect.ps1 -JetsonAddress 현재주소
```

노트북 브라우저의 **http://localhost:5502**로 접속한다. 터널을 실행한 창은 열어 둔다.
이 단계는 HTML 접속 검사다. Python 서버가 없으면 모델 상태 API는 실패하며 실제 측정은 되지 않는다.
노트북의 다른 개발 서버와 혼동하지 않도록 5502 포트를 쓴다.
`http://젯슨IP:5500`을 직접 여는 방식은 사용하지 않는다. 현재 서버는 loopback에만 바인딩되며,
브라우저 카메라는 HTTPS 또는 localhost와 같은 보안 문맥이 필요하다.

## 3. Python·GPU 환경 구성

젯슨의 실제 L4T·Python·CUDA를 확인한 뒤 호환되는 NVIDIA PyTorch 환경을 선택한다.
PC용 `inference/requirements.txt`를 그대로 설치하지 않는다. 특히 SciPy 1.16.1은 Python 3.11 이상을
요구하므로 Ubuntu 22.04의 기본 Python 3.10과 맞지 않는다. 일반 PyPI torch로 NVIDIA 빌드를 덮어쓰지 않는다.

선택 기준:

1. 기존 CUDA PyTorch가 동작하면 먼저 해당 Python과 라이브러리 버전을 기록하고 재사용 가능성을 확인한다.
2. 새 환경은 NVIDIA의 JetPack 호환표를 기준으로 wheel 또는 컨테이너를 선택한다.
   JetPack 6.2 표에는 컨테이너가 안내되어 있으므로 임의의 wheel URL을 추정하지 않는다.
3. 현재 서비스 설치 도구는 **호스트의 `.venv/bin/python` 경로**를 전제로 한다.
   컨테이너를 선택하면 GPU 장치·네트워크·볼륨을 포함한 별도 실행 설정을 먼저 작성한다.
4. FastAPI·NumPy·SciPy·OpenCV·h5py·httpx 및 테스트 의존성을 선택한 Python/PyTorch와 맞춘다.
5. `.venv/bin/python`에서 CUDA 장치 접근과 실제 두 모델 실행을 확인한 후 버전을 고정한다.

호환 환경이 준비된 후에만 실행한다.

```bash
.venv/bin/python -m inference.setup_models
INFERENCE_DEVICE=cuda .venv/bin/python deploy/jetson/verify.py --local
```

검증 도구는 체크섬이 고정된 실제 EfficientPhys·MTTS-CAN을 로딩하고, 합성 프레임에 대해
심박·호흡 파형의 길이와 유한값을 검사한다. **이는 실행 확인이며 실제 사람 정확도 검증이 아니다.**
브라우저 자산도 manifest의 체크섬과 비교한다. 파일 누락 시 앱 폴더에서
`npm ci --ignore-scripts`와 `npm run setup:assets`로 준비한다.

## 4. 재부팅 후 서버 자동 시작

수동 실행 중인 프로젝트 서버를 먼저 종료한다. 5500·8000 포트가 다른 프로그램에 사용 중이면
임의로 종료하지 말고 원인을 확인한다. 프로젝트 소유자 계정으로 다음을 실행한다.

```bash
bash deploy/jetson/install-services.sh --check
bash deploy/jetson/install-services.sh
```

첫 명령은 실제 모델·자산과 서비스 문법을 검사하고 서비스 내용을 출력한다. 두 번째는 sudo를 통해
`chambit-inference.service`와 `chambit-web.service`를 설치·활성화한다. 기존 동명 파일은 시각을 붙여
백업한다. 모델은 서비스 시작 때 한 번 로딩하며, 서비스는 일반 사용자 권한으로 실행한다.
서비스 설치 직후 최대 120초 동안 웹 HTML과 두 모델의 CUDA 준비 상태를 확인한다.
기존 `.env`를 사용할 경우 장치·활성 모델을 검토한다. `INFERENCE_DEVICE=cpu` 또는 모델 제외 설정은
CUDA 배포 완료 조건을 통과하지 못한다. 이 배포의 포트는 웹 5500·추론 8000으로 고정한다.

```bash
systemctl status chambit-inference chambit-web --no-pager
journalctl -u chambit-inference -u chambit-web -n 100 --no-pager
.venv/bin/python deploy/jetson/verify.py --url http://127.0.0.1:5500
```

SSH를 끊거나 원격 화면을 닫아도 서버는 유지된다. 노트북의 SSH 터널을 닫으면 그 노트북의
localhost 접속은 끝나므로 다시 터널을 열어야 한다. 터널 없이 상시 접속하는 HTTPS 배포는 다음 단계다.
인터넷 전체에 노출하는 포트 포워딩은 이 단계에 포함하지 않는다.

서비스 중지·자동 시작 해제:

```bash
sudo systemctl disable --now chambit-web chambit-inference
```

코드 업데이트는 작업 내용 확인 → Git 업데이트 → 해당 환경 테스트 → 서비스 재시작 순서로 진행한다.
모델·가상환경·개인 `.env`·측정 파일은 Git에 올리지 않는다.

## 완료 확인표와 다음 개발

- [ ] SSH 로그인과 VS Code 원격 폴더 접근
- [ ] 실제 JetPack·Python·CUDA·RAM·여유 저장공간 기록
- [ ] 젯슨에서 제공한 HTML을 노트북 localhost 터널로 열기
- [ ] 실제 두 학습 모델의 CUDA 실행과 HR·RR 출력 형태 확인
- [ ] `/api/health`의 두 모델 준비와 노트북 카메라·WebSocket 연결 확인
- [ ] 실제 60초 측정: 결과 상태·처리 지연·호흡 실패 근거 기록
- [ ] 재부팅 후 자동 시작과 재접속
- [ ] 이후: 호흡 안정화 → 결정적 후보 검증 보강 → 소형 LLM 문진 → 동의 기반 기록·근거 검색

참고: [NVIDIA PyTorch 설치](https://docs.nvidia.com/deeplearning/frameworks/install-pytorch-jetson-platform/index.html),
[JetPack 호환표](https://docs.nvidia.com/deeplearning/frameworks/install-pytorch-jetson-platform-release-notes/pytorch-jetson-rel.html),
[VS Code Remote SSH](https://code.visualstudio.com/docs/remote/ssh),
[브라우저 카메라 보안 문맥](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia).
