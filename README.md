# 참빛설계 · 실시간 비접촉 건강 체크

웹캠 얼굴 영상으로 심박수·호흡수를 추정하고 한국어 문진을 진행합니다.
**HTML 화면 + 같은 PC의 Python 추론 서버**로 실행합니다. 얼굴 ROI는 로컬 서버의
최대 60초 메모리 버퍼에서 처리하며 외부 전송하거나 자동 저장하지 않습니다.

카메라 추정값과 문진은 의료 진단이 아닙니다. 신호 부족·후보 충돌 시 수치를 확정하지 않습니다.

## 프로젝트 정리 · 2026-10-12

실제 웹캠 입력부터 모델 추론, 결과 표시, 규칙 기반 건강 문진까지 연결한 1차 시제품입니다.
심박 추정값 출력은 확인했으며, 호흡 측정의 안정성과 기준 장비 대비 정확도는 추가 검증이 필요합니다.
이 날짜는 저장소와 문서를 정리한 날짜이며 새로운 정확도 시험을 완료한 날짜는 아닙니다.

| 문서 | 내용 |
|---|---|
| [구현 현황과 다음 과제](docs/PROJECT_STATUS.md) | 완료 범위, 알려진 한계, 우선순위와 완료 조건 |
| [시스템 구조](docs/ARCHITECTURE.md) | 웹캠 → 모델 → 후보 검증 → 문진의 데이터 흐름과 코드 위치 |
| [백업·복구 및 업데이트](docs/REPOSITORY_GUIDE.md) | 새 PC에서 복구, Git 업데이트, 포함·제외 파일 |
| [검증 이력](chambit_health_demo/VALIDATION.md) | 수행한 검사와 실제 사람 대상 검증의 구분 |
| [모델 출처와 실행 차이](inference/NOTICE.md) | 가중치, 라이선스, 공식 전처리와의 차이 |

## 무엇을 만들었나요?

카메라 수집부터 신호 추정, 품질 확인, 결과 설명과 문진까지 연결한 로컬 웹 데모입니다. 모델 하나의 출력만 보여 주는 대신, 영상이 끊기거나 서로 다른 후보가 충돌할 때 결과를 보류하고 이유를 안내하는 흐름을 구현했습니다.

| 단계 | 입력과 처리 | 담당 파일 |
|---|---|---|
| 얼굴 영상 수집 | 카메라 프레임에서 얼굴 영역과 RGB 정보 추출 | `measurement-controller.mjs`, `measurement-worker.mjs` |
| 맥파·호흡 후보 | 학습 모델과 CHROM·POS 등으로 파형 생성 | `inference/models.py`, `inference/pipeline.py` |
| 품질과 결과 판정 | 신호 반복성·충돌·수집 조건 확인, 실패 이유 설명 | `inference/signals.py`, `inference/feedback.py` |
| 화면과 문진 | 측정값·수집 근거 표시, 한국어 질문과 답변 정리 | `measurement-ui.mjs`, `inference/consultation.py` |

[전체 파일 설명](docs/FILE_GUIDE.md) · [구조와 데이터 흐름](docs/ARCHITECTURE.md) · [웹 화면 코드](chambit_health_demo/README.md) · [추론 서버 코드](inference/README.md) · [기존 검증 기록](chambit_health_demo/VALIDATION.md)

## 실행

Python 3.11–3.13, Node.js 22 이상을 사용합니다. 저장소 루트에서 실행하세요.

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r inference/requirements-dev.txt
.\.venv\Scripts\python.exe -m inference.setup_models
cd chambit_health_demo
npm.cmd ci --ignore-scripts
npm.cmd start
```

[http://localhost:5500](http://localhost:5500)을 열고 카메라 권한을 허용합니다.
`npm start`는 웹 서버(5500)와 추론 서버(8000)를 함께 시작합니다. 종료는 Ctrl+C입니다.
처음에는 위 설치 과정을 완료해야 합니다. 이후에는 `chambit_health_demo`에서 `npm.cmd start`로 시작합니다.
모델 가중치·가상환경·개인 `.env` 설정은 저장소에 포함하지 않습니다.

Linux에서는 `.venv/Scripts/python.exe` 대신 `.venv/bin/python`을 사용합니다.
GPU PC는 환경에 맞는 PyTorch를 설치하고 `INFERENCE_DEVICE=cuda`를 설정하세요.
젯슨은 JetPack에 맞는 별도 환경이 필요하며 PC용 requirements를 그대로 설치하지 않습니다.

## 측정과 문진

1. **카메라 켜기 → 실제 측정 시작**을 누르고 모델 준비 상태를 확인합니다.
2. 정면·고른 조명에서 준비 5초 후 60초 동안 자연스럽게 호흡합니다.
3. 심박수는 수집 20초부터 2초 간격, 호흡수는 35초부터 5초 간격으로 분석합니다.
   상단 진행 막대에서 분석 시작 시점을 확인합니다. 신호가 충분할 때 중간 추정값을 표시하며,
   수집 60초 후 최종 결과를 정리합니다. 초기 중간값은 계속 달라질 수 있습니다.
4. 필요한 경우 **측정 상세 정보 · 개발용**에서 모델 출처·분석 구간·수신 fps·처리 지연을 확인합니다.
   실제 측정 완료 후 **측정 분석 파일 저장**을 누르면 실패 후보를 포함한 전체 분석 파형과
   품질 판정 근거를 JSON으로 내려받습니다. 얼굴 영상·ROI 픽셀·문진 답변은 포함하지 않습니다.
5. 최종 결과에서 **건강 문진으로**를 누릅니다. 측정 실패 시에도 증상 문진은 가능합니다.
6. 공통 4문항과 최대 4개 후속 질문 후 측정 근거·응답·다음 행동을 확인합니다.

임의의 건강 점수는 없습니다. 얼굴 이탈·품질 저하·0.5초 이상 공백은 준비부터 다시 시작하며,
최대 수집 시도는 120초입니다. 학습 모델은 실제 24fps 이상·100ms 이하 프레임 간격을 요구합니다.
늦은 추론 요청은 최신 요청 하나만 대기시키며 한 기기에서 한 측정만 실행합니다.

카메라에서는 최대 30fps를 요청하고, 도착한 프레임에 별도의 간격 제한을 중복 적용하지 않습니다.
얼굴 처리에는 실행 중 1개·대기 중 최신 실제 프레임 1개만 유지합니다. 원래 촬영 시각을 유지하며
프레임을 복제하지 않습니다. 완료된 모델 구간의 영상 크기 변환은 반복하지 않습니다.
개발용 상세 정보의 `capture`에서 카메라 속도·얼굴 처리 속도·대기 교체·얼굴 조건 거부·전송 누락을
구분합니다. 이 정보는 원인 설명용이며 서버의 유효 fps·신호 품질 조건을 완화하지 않습니다.

카메라 없이 체험하려면 **가상 데이터 데모**를 직접 선택하세요.
가상 수치는 항상 표시되며 실패 시 자동으로 데모로 전환하지 않습니다.

측정 실패 시 영상이 느리게 전달되는지, 중간에 끊기는지, 신호가 부족한지를 쉬운 말로 안내합니다.
모델 이름과 오류 원문은 접혀 있는 개발용 상세 정보에서 확인합니다.
영상 속도가 충분해도 파형의 반복성을 확인하지 못하면 수치를 표시하지 않습니다.
이 경우 영상 속도 부족과 구분해서 안내합니다.

분석 파일의 `candidates[].checks`와 `rejectionCodes`는 통과 조건과 탈락 이유입니다.
`features.spectralPeakRate`는 거부된 파형에서도 계산될 수 있는 스펙트럼 후보로, 유효한 측정값이 아닙니다.
최종값은 `metrics.hr.value`, `metrics.rr.value`를 확인하며 실패 시 `null`을 유지합니다.
`signalDiagnostics`에는 최종 구간의 입력 파형·필터 적용 후 파형·샘플링 속도·경계 제거 정보가,
학습 모델에는 추가로 차분 출력·구간 길이·구간별 정규화 정보가 들어 있습니다.
중간 결과에는 전체 파형을 넣지 않습니다. 보조 호흡 유도가 성립하지 않아 후보가 생성되지 않은
경우에는 해당 보조 파형도 없습니다. 최종 실패 후보의 스펙트럼 수치를 대신 표시하지 않습니다.
파일은 사용자가 버튼을 눌렀을 때만 저장하며, `measurement-analysis-*.json`은 Git에서 제외합니다.
동일한 수집 60초의 기준 심박·호흡과 함께 비교해야 정확도를 평가할 수 있습니다.

## 모델과 후보 검증

| 모델 | 역할 | 실행 |
|---|---|---|
| EfficientPhys / PURE 공식 가중치 | 심박 파형 | PyTorch, ONNX 선택 |
| MTTS-CAN / 공식 HDF5 | 심박·호흡 파형 | PyTorch 변환 구현, ONNX 선택 |
| CHROM·POS | 심박 비교 기준 | NumPy·SciPy |
| CHROM 맥파 변동 | 보조 호흡 후보 | 진폭·간격 일치 시 사용 |
| BiPulseFormer | 연구 후보 | 구현·가중치 미포함 |

`python -m inference.setup_models`로 공식 코드·가중치를 다운로드합니다.
[모델 잠금 파일](inference/models.lock.json)에 커밋과 SHA-256을 고정하고 로딩 시 검증합니다.
가중치가 없으면 해당 모델은 사용 불가로 표시되고 CHROM·POS 기준은 실행할 수 있습니다.
출처·라이선스·실시간 전처리의 차이는 [모델 안내](inference/NOTICE.md)에 기록했습니다.

PhysAgent를 참고해 Scene·Quality·Debate·Judge·Verifier 역할을 경량 코드로 분리했습니다.
현재 Judge는 결정적 후보 선택입니다. 서로 다른 구간·신호 종류·충돌 군집을 평균하지 않으며,
품질 점수는 정확할 확률이 아닙니다. LLM은 새로운 심박·호흡 수치를 만들지 않습니다.

## 선택형 LLM 문진

`chambit_health_demo/.env.example`을 `.env`로 복사하고 필요한 값을 설정한 뒤 재시작합니다.
브라우저 **설정 → 문진 정리 방식**에서 선택합니다.

- **로컬 규칙 문진:** 기본값. API 키와 인터넷 없이 작동합니다.
- **외부 LLM:** chat-completions 호환 서비스의 `REMOTE_LLM_BASE_URL`, `REMOTE_LLM_MODEL`,
  `REMOTE_LLM_API_KEY`를 설정합니다. 사용자가 측정 요약·답변 전송에 동의해야 합니다.
- **로컬 LLM:** 별도 실행한 서버의 `LOCAL_LLM_BASE_URL`, `LOCAL_LLM_MODEL`을 설정합니다.
  Qwen3-1.7B Q4·비사고 모드가 첫 검토 후보이며 모델 자체는 자동 설치하지 않습니다.

LLM은 검증된 사실 문구의 관련성과 순서를 선택합니다. 생성 숫자·새 진단·처방은 표시하지 않습니다.
완전한 자유 대화형 의료 챗봇은 아닙니다. 잘못된 JSON·사실·네트워크 오류·15초 초과 시
로컬 규칙으로 정리합니다. 긴급 증상 선택은 LLM 없이 고정 안내를 표시합니다.
추가 기록란의 자유 문장은 자동 응급 판정에 사용하지 않습니다.

카메라 영상은 LLM에 보내지 않고 API 키는 서버에 보관합니다.
서버의 측정·문진은 메모리에만 보관하며 30분 후 만료됩니다. 각각 최대 100개 세션을 유지합니다.
사용자가 내려받은 분석 파일은 사용자 기기에 남습니다.

## API와 구성

| 경로 | 기능 |
|---|---|
| `GET /api/health` | 모델 준비·체크섬·실행기·장치 상태 |
| `WS /api/measurement` | start → started → binary frames → state/analysis → cancel |
| `POST /api/measurement/demo` | 명시적 가상 결과 ID 발급 |
| `POST /api/consultation/start` | 서버 resultId로 문진 시작 |
| `POST /api/consultation/answer` | 질문 ID·선택지·선택 기록 전달 |

Node는 같은 출처의 요청을 로컬 Python으로 중계합니다. 바이너리는
`uint32 LE JSON 길이 + UTF-8 JSON + 128×128×3 RGB bytes` 형식입니다.
헤더는 `sessionId, revision, seq, t, rgb, scene`입니다. 잘못된 얼굴 프레임은
`rgb:null`로 전달하고 픽셀을 포함하지 않습니다. 구간 변경·취소 후 이전 결과는 폐기합니다.

`inference/`는 모델·신호·상태·문진·API·검증 도구,
`chambit_health_demo/`는 화면·카메라 Worker·전송·Node 프록시입니다.
카카오 병원 안내는 키가 없으면 가상 병원 데이터로 동작합니다.

## 검증

```powershell
# 저장소 루트
.\.venv\Scripts\python.exe -m pytest inference/tests -q
cd chambit_health_demo
npm.cmd test
npm.cmd run test:browser
```

실제 가중치 출력·Keras 저장 그래프 대비 MTTS-CAN 수치 일치·구간 초기화·후보 충돌·
문진·LLM 응답을 검사합니다. 가상 카메라와 UI 대역은 실제 사람 정확도 증거가 아닙니다.

기준값이 있는 얼굴 영상은 저장소 루트에서 재생 검증할 수 있습니다.

```powershell
.\.venv\Scripts\python.exe -m inference.replay path/to/video.avi --output inference/artifacts/replay.json
.\.venv\Scripts\python.exe -m inference.evaluate path/to/attempts.csv
```

CSV 열: `participant,attempt,condition,reference_hr,hr,reference_rr,rr`.
실패값은 빈칸으로 남기며 성공률 분모에 포함합니다. 재생 CLI의 얼굴 검출은 OpenCV Haar이므로
브라우저 MediaPipe와 구분합니다. 실제 수행 여부는 [VALIDATION.md](chambit_health_demo/VALIDATION.md)에 기록합니다.

## 젯슨 이식 준비

```powershell
# 저장소 루트; 선택 설치
.\.venv\Scripts\python.exe -m pip install -r inference/requirements-export.txt
.\.venv\Scripts\python.exe -m inference.export_models
```

ONNX 두 모델과 파형 일치 보고서는 `inference/artifacts/`에 생성됩니다.
검증한 파일을 `EFFICIENTPHYS_ONNX`, `MTTS_CAN_ONNX`에 지정하면 ONNX Runtime으로 실행합니다.
현재 ONNX 실행기는 CPU 기준입니다. TensorRT 엔진은 젯슨 기종·JetPack 확정 후 대상 장치에서
생성하고 FP16 차이·동적 입력·30분 연속 성능을 확인해야 합니다.
젯슨 실기기와 로컬 LLM의 성능은 아직 검증하지 않았습니다.
