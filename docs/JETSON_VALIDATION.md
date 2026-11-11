# 젯슨 이식 검증 · 2026-11-11

## 실제 확인한 범위

- 장치: Jetson Orin Nano, aarch64, L4T 36.4.7, CUDA 12.6, RAM 7.4GiB.
- 환경: Python 3.10.12, Node.js 22.23.4, JPL CUDA PyTorch 2.8.0.
- NumPy 1.26.4, SciPy 1.15.3, OpenCV 4.11.0.86, h5py 3.15.1. 전체 의존성은 `inference/requirements-jetson-lock.txt`에 기록했다.
- 실제 EfficientPhys 공식 가중치에서 HR, MTTS-CAN 공식 가중치에서 HR·RR 파형 생성.
  합성 영상 21프레임에 대해 출력 20샘플·유한값·GPU 실행과 브라우저 자산 체크섬 확인.
- `INFERENCE_DEVICE=cuda .venv/bin/python -m pytest inference/tests -q`: **79 passed**.
- 젯슨에서 Node 자동 검사: **43 passed**.
- PC의 영향받는 문진·모델 검사: **15 passed**.
- Node 웹 서버를 통해 `/api/health`의 두 모델 ready/cuda와 HTML 200 확인.
- 노트북 → SSH 터널 → 젯슨 Node → Python WebSocket에서 connected/start,
  얼굴 없는 바이너리 프레임에 대한 state, cancel 종료 확인. 실제 카메라는 사용하지 않았다.
- `chambit-web`, `chambit-inference` 사용자 서비스가 enabled/active, `Linger=yes` 확인.
- VS Code 원격 프로젝트와 ARM64 Codex·Python 확장 설치. Codex CLI 버전 응답 확인.
  사용자 Codex 계정 로그인은 별도 단계다.

## 이식 과정에서 수정한 문제

1. PC 의존성은 Python 3.11 이상 및 NumPy 2를 전제했다. 젯슨의 Python 3.10과
   NumPy 1.x로 빌드된 GPU PyTorch에 맞는 별도 설치 목록과 잠금 목록을 구성했다.
2. Python 3.10에 없는 `asyncio.timeout` 때문에 LLM 문진 경로가 실패했다.
   동일한 15초 전체 요청 제한을 `asyncio.wait_for`로 구현하고 기존 문진 검사를 통과했다.
3. Orin의 TF32 계산에서 MTTS-CAN의 기준 그래프 비교 오차가 허용 범위를 넘었다.
   모델 실행에서 matmul/cuDNN TF32를 비활성화해 FP32 기준 비교를 통과했다.
   테스트 허용 오차를 늘리지 않았다. TF32 비활성화의 실제 측정 지연 영향은 추가 측정 대상이다.

## 아직 검증하지 않은 범위

- 실제 사람의 웹캠 60초 연속 측정, 네트워크 수신 fps와 추론 지연 목표 달성.
- 호흡수 측정 성공률 개선과 기준 장비 대비 심박·호흡 정확도.
- 실제 전원 재부팅 후 접속 복구와 30분 연속 동작·열·메모리 시험.
- 로컬 LLM 설치·한국어 응답 품질·측정과의 자원 경쟁.
- SSH 터널 없이 접속하는 신뢰된 HTTPS 도메인 또는 외부 인터넷 공개 배포.

이 기록은 실행·호환성·연결 검사다. 모델 출력이 생성된다는 사실을 생체신호 정확도로 해석하지 않는다.
