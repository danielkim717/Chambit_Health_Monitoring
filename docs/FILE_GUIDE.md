# 참빛 프로젝트 파일 안내

`chambit_health_demo/`는 화면·카메라·웹 서버, `inference/`는 Python 추론·신호 판정·문진을 담당합니다. 화면 파일만 열거나 모델 파일 하나만 실행하는 방식이 아니라 `npm start`로 두 서버를 함께 시작합니다.

## Python 추론과 문진

| 파일 | 역할 | 처리 내용 |
|---|---|---|
| [inference/__init__.py](../inference/__init__.py) | Python 추론 패키지 표시 | inference 모듈을 python -m 명령으로 실행하기 위한 패키지입니다. |
| [inference/app.py](../inference/app.py) | 추론 서버 API와 측정 세션 관리 | FastAPI 요청과 WebSocket 프레임을 받아 Pipeline과 문진을 연결하고 결과 ID를 관리합니다. |
| [inference/pipeline.py](../inference/pipeline.py) | 측정 상태와 모델 분석 흐름 관리 | 준비·수집·완료 상태, 프레임 버퍼, 분석 구간, 모델 후보와 최종값을 관리합니다. |
| [inference/models.py](../inference/models.py) | 학습 모델 로딩과 실행 방식 통일 | 공식 가중치의 출처·체크섬을 확인하고 EfficientPhys·MTTS-CAN 실행을 연결합니다. |
| [inference/signals.py](../inference/signals.py) | 맥파 호흡 신호의 품질 판정과 후보 결합 | CHROM·POS, 필터·주파수·반복성 검사, 호흡 보조 후보, 충돌하지 않는 후보 선정을 처리합니다. |
| [inference/feedback.py](../inference/feedback.py) | 측정 실패 이유를 사용자 설명으로 변환 | 프레임 속도·신호 부족·모델 상태 등 판정 근거를 화면에 전달할 문구로 정리합니다. |
| [inference/consultation.py](../inference/consultation.py) | 한국어 문진과 선택형 LLM 정리 | 서버의 측정 결과와 답변을 바탕으로 질문을 진행하고 승인된 사실만 정리합니다. 새로운 측정값을 만들지 않습니다. |
| [inference/setup_models.py](../inference/setup_models.py) | 공식 모델 코드와 가중치 준비 | models.lock.json에 지정된 출처와 체크섬으로 필요한 모델 파일을 내려받습니다. |
| [inference/replay.py](../inference/replay.py) | 저장 영상으로 측정 흐름 재생 | 로컬 영상을 처리해 분석 JSON을 만듭니다. OpenCV 얼굴 검출을 사용하므로 브라우저 MediaPipe와 구분합니다. |
| [inference/evaluate.py](../inference/evaluate.py) | 기준값 대비 오차와 측정 성공률 집계 | 시도별 기준 심박·호흡과 추정값 CSV를 읽습니다. 실패 시도도 성공률의 분모에 포함합니다. |
| [inference/benchmark.py](../inference/benchmark.py) | 모델 추론 시간 확인 | 설치된 모델의 처리 시간을 점검합니다. 실제 사람의 심박·호흡 정확도 검증은 아닙니다. |
| [inference/export_models.py](../inference/export_models.py) | ONNX 내보내기와 출력 일치 확인 | 학습 모델을 ONNX로 변환하고 파형 차이를 비교합니다. 젯슨 실기기 성능 측정과는 별도입니다. |

## 웹 화면과 카메라

| 파일 | 역할 | 처리 내용 |
|---|---|---|
| [chambit_health_demo/script.js](../chambit_health_demo/script.js) | 페이지 이동과 병원 안내 연결 | 측정·문진 화면을 연결하고 지도·주변 병원·이력 표시를 관리합니다. |
| [chambit_health_demo/server.js](../chambit_health_demo/server.js) | 웹 파일 제공과 로컬 API 중계 | 정적 화면, 같은 출처 요청, WebSocket과 Python 서버 연결, 선택형 지도 요청을 처리합니다. |
| [chambit_health_demo/dev.mjs](../chambit_health_demo/dev.mjs) | 웹 서버와 추론 서버 동시 시작 | npm start의 진입점입니다. Node 웹 서버와 로컬 Python 추론 서버를 실행하고 함께 종료합니다. |
| [chambit_health_demo/frame-pump.mjs](../chambit_health_demo/frame-pump.mjs) | 카메라 프레임 전달과 처리 속도 기록 | 처리 중 프레임 하나와 최신 대기 프레임 하나를 관리하고 수집 통계를 계산합니다. |
| [chambit_health_demo/measurement-config.mjs](../chambit_health_demo/measurement-config.mjs) | 브라우저 측정 시간과 조건 설정 | 준비·수집·프레임 간격 등 화면과 처리 코드가 공유하는 기본값을 정의합니다. |
| [chambit_health_demo/measurement-controller.mjs](../chambit_health_demo/measurement-controller.mjs) | 카메라 Worker 서버 통신 연결 | 카메라 수집, Worker 얼굴 처리, WebSocket 전송, 취소와 서버 결과 수신을 관리합니다. |
| [chambit_health_demo/measurement-session.mjs](../chambit_health_demo/measurement-session.mjs) | 브라우저 측정 상태 전환 | 준비·수집·시간 초과 등 시각 기반 상태를 관리합니다. 최종 측정 결과는 서버 응답을 따릅니다. |
| [chambit_health_demo/measurement-timeline.mjs](../chambit_health_demo/measurement-timeline.mjs) | 측정 진행 시간과 분석 시작점 계산 | 수집 시간에 맞춰 심박 12초·호흡 20초·완료 60초 안내와 진행 상태를 계산합니다. |
| [chambit_health_demo/measurement-ui.mjs](../chambit_health_demo/measurement-ui.mjs) | 측정 결과와 실패 안내 화면 표시 | 수치·품질·분석 상세·재측정·분석 JSON 저장을 관리합니다. 실패 후보를 유효한 측정값으로 바꾸지 않습니다. |
| [chambit_health_demo/measurement-worker.js](../chambit_health_demo/measurement-worker.js) | 얼굴 처리 Worker 시작과 메시지 대기 | MediaPipe 호환 classic Worker에서 ES 모듈을 불러오고 로딩 중 메시지를 보관합니다. |
| [chambit_health_demo/measurement-worker.mjs](../chambit_health_demo/measurement-worker.mjs) | 얼굴 검출과 ROI 픽셀 추출 | MediaPipe로 얼굴과 이마·볼 영역을 찾고 자세·움직임·노출을 검사해 RGB 입력을 전달합니다. |
| [chambit_health_demo/consultation-ui.mjs](../chambit_health_demo/consultation-ui.mjs) | 문진 질문 답변과 동의 화면 | 서버에 질문·응답을 전달하고 정리 결과를 표시합니다. 외부 LLM 사용 동의를 연결합니다. |
| [chambit_health_demo/signal-analysis.mjs](../chambit_health_demo/signal-analysis.mjs) | 브라우저 신호 분석 보조 함수 | 보간·CHROM·필터·주기 후보 계산과 합성 신호 테스트에 사용합니다. 현재 최종값의 주 경로는 Python 서버입니다. |
| [chambit_health_demo/setup-assets.mjs](../chambit_health_demo/setup-assets.mjs) | MediaPipe 실행 자산 준비 | 브라우저에서 사용할 모델과 런타임 파일을 준비합니다. 자산 출처는 assets/NOTICE.md에 있습니다. |
| [chambit_health_demo/playwright.config.mjs](../chambit_health_demo/playwright.config.mjs) | 브라우저 검사 실행 설정 | Playwright의 검사 대상과 웹 실행 환경을 정의합니다. |

## 설정 모델 자산과 문서

| 파일 | 역할 |
|---|---|
| [README.md](../README.md) | 프로젝트 목적·설치·측정·문진·검증 범위를 안내하는 첫 화면 |
| [.gitignore](../.gitignore) | 개인 설정·가상환경·분석 파일·학습 가중치의 업로드 제외 규칙 |
| [inference/NOTICE.md](../inference/NOTICE.md) | 모델의 출처·라이선스·공식 전처리와의 차이 |
| [inference/models.lock.json](../inference/models.lock.json) | 공식 코드·가중치의 URL, 버전과 SHA-256 고정 목록 |
| [inference/requirements.txt](../inference/requirements.txt) | 실제 추론 서버의 Python 의존성 |
| [inference/requirements-dev.txt](../inference/requirements-dev.txt) | 기본 추론 의존성과 개발·테스트 의존성 |
| [inference/requirements-export.txt](../inference/requirements-export.txt) | ONNX 변환과 비교에 필요한 선택 의존성 |
| [inference/licenses/MTTS-CAN-LICENSE.txt](../inference/licenses/MTTS-CAN-LICENSE.txt) | MTTS-CAN의 원래 라이선스 |
| [inference/licenses/rPPG-Toolbox-LICENSE.txt](../inference/licenses/rPPG-Toolbox-LICENSE.txt) | 참조 rPPG-Toolbox의 원래 라이선스 |
| [chambit_health_demo/index.html](../chambit_health_demo/index.html) | 카메라·측정·문진·병원 안내 페이지의 화면 구조 |
| [chambit_health_demo/style.css](../chambit_health_demo/style.css) | 레이아웃·색상·모바일 화면 등 스타일 |
| [chambit_health_demo/package.json](../chambit_health_demo/package.json) | npm 실행 명령과 브라우저 개발 의존성 |
| [chambit_health_demo/package-lock.json](../chambit_health_demo/package-lock.json) | npm 패키지의 실제 설치 버전 고정 |
| [chambit_health_demo/.env.example](../chambit_health_demo/.env.example) | 지도·추론·선택형 LLM 환경 변수 양식. 실제 비밀키는 별도 .env에 입력 |
| [chambit_health_demo/.gitignore](../chambit_health_demo/.gitignore) | 웹 폴더의 로컬 생성물 제외 규칙 |
| [chambit_health_demo/VALIDATION.md](../chambit_health_demo/VALIDATION.md) | 날짜별 실제 검증 기록·실패 사례·검증하지 않은 범위 |
| [chambit_health_demo/assets/NOTICE.md](../chambit_health_demo/assets/NOTICE.md) | MediaPipe 모델과 런타임 자산의 출처 |
| [chambit_health_demo/assets/LICENSE-Apache-2.0.txt](../chambit_health_demo/assets/LICENSE-Apache-2.0.txt) | 브라우저 외부 자산의 Apache 2.0 라이선스 |
| [chambit_health_demo/assets/manifest.json](../chambit_health_demo/assets/manifest.json) | 브라우저 모델·런타임 자산의 무결성 정보 |
| [chambit_health_demo/assets/face_landmarker.task](../chambit_health_demo/assets/face_landmarker.task) | MediaPipe 얼굴 특징점 검출 모델 |
| [chambit_health_demo/assets/mediapipe/vision_bundle.mjs](../chambit_health_demo/assets/mediapipe/vision_bundle.mjs) | MediaPipe 공식 브라우저 vision 런타임 |
| [chambit_health_demo/assets/mediapipe/wasm/vision_wasm_internal.js](../chambit_health_demo/assets/mediapipe/wasm/vision_wasm_internal.js) | SIMD 지원 WebAssembly 실행을 연결하는 공식 로더 |
| [chambit_health_demo/assets/mediapipe/wasm/vision_wasm_internal.wasm](../chambit_health_demo/assets/mediapipe/wasm/vision_wasm_internal.wasm) | SIMD 지원 얼굴 처리 연산 바이너리 |
| [chambit_health_demo/assets/mediapipe/wasm/vision_wasm_nosimd_internal.js](../chambit_health_demo/assets/mediapipe/wasm/vision_wasm_nosimd_internal.js) | SIMD 없는 환경의 공식 WebAssembly 로더 |
| [chambit_health_demo/assets/mediapipe/wasm/vision_wasm_nosimd_internal.wasm](../chambit_health_demo/assets/mediapipe/wasm/vision_wasm_nosimd_internal.wasm) | SIMD 없는 환경의 얼굴 처리 연산 바이너리 |

## 테스트

아래는 코드 동작을 확인하는 검사입니다. 검사 통과가 실제 사람의 심박·호흡 정확도를 뜻하지는 않습니다. 기존 실행 결과는 [검증 기록](../chambit_health_demo/VALIDATION.md)에 있습니다.

| 파일 | 역할 |
|---|---|
| [inference/tests/test_consultation.py](../inference/tests/test_consultation.py) | 문진 흐름·동의·LLM 사실 제한과 잘못된 응답 처리 |
| [inference/tests/test_evaluate.py](../inference/tests/test_evaluate.py) | 실패 시도를 포함한 성공률 집계 |
| [inference/tests/test_models.py](../inference/tests/test_models.py) | 공식 가중치 출력의 반복성과 MTTS-CAN 참조 계산 일치 |
| [inference/tests/test_respiration_pipeline.py](../inference/tests/test_respiration_pipeline.py) | 호흡 분석 시작·실패 근거·파형 보존·프레임 처리 |
| [inference/tests/test_session.py](../inference/tests/test_session.py) | 시간 흐름·영상 공백·잘못된 프레임·측정 상태 초기화 |
| [inference/tests/test_signals.py](../inference/tests/test_signals.py) | 합성 신호·후보 충돌·동일 근거 중복·실패값 처리 |
| [inference/tests/test_websocket.py](../inference/tests/test_websocket.py) | 바이너리 프레임·취소·서버 결과 ID·문진 연결 |
| [chambit_health_demo/tests/browser/measurement.spec.mjs](../chambit_health_demo/tests/browser/measurement.spec.mjs) | 브라우저의 측정·데모·진행 막대·재측정·분석 저장 흐름 |
| [chambit_health_demo/tests/frame-pump.test.mjs](../chambit_health_demo/tests/frame-pump.test.mjs) | 최신 프레임 대기·촬영 시각 유지·처리 속도 기록 |
| [chambit_health_demo/tests/measurement-session.test.mjs](../chambit_health_demo/tests/measurement-session.test.mjs) | 브라우저의 준비·수집·시간 초과 상태 |
| [chambit_health_demo/tests/measurement-timeline.test.mjs](../chambit_health_demo/tests/measurement-timeline.test.mjs) | 심박·호흡 분석 시작점과 진행 막대 |
| [chambit_health_demo/tests/respiration-ui.test.mjs](../chambit_health_demo/tests/respiration-ui.test.mjs) | 호흡 대기·실패·최종 결과의 표시 |
| [chambit_health_demo/tests/server.test.mjs](../chambit_health_demo/tests/server.test.mjs) | 정적 파일·서버 요청·중계 접근 처리 |
| [chambit_health_demo/tests/signal-analysis.test.mjs](../chambit_health_demo/tests/signal-analysis.test.mjs) | 브라우저 신호 함수의 합성 파형 처리 |

## 추가 안내 문서

| 파일 | 역할 |
|---|---|
| [docs/PROJECT_STATUS.md](PROJECT_STATUS.md) | 구현 현황, 미완료 과제, 우선순위와 완료 조건 |
| [docs/REPOSITORY_GUIDE.md](REPOSITORY_GUIDE.md) | 새 저장소 복제, 복구, 개인 자료 제외 및 수정 후 업데이트 |
| [docs/ARCHITECTURE.md](../docs/ARCHITECTURE.md) | 카메라에서 측정·문진까지 연결되는 구조와 정보 흐름 |
| [docs/FILE_GUIDE.md](../docs/FILE_GUIDE.md) | 모든 파일을 역할별로 찾는 이 문서 |
| [docs/DOCUMENTATION_CHECKS.md](../docs/DOCUMENTATION_CHECKS.md) | 이번 설명 보완의 범위와 확인 결과 |
| [inference/README.md](../inference/README.md) | Python 모듈을 읽는 순서와 실행 명령 |
| [chambit_health_demo/README.md](../chambit_health_demo/README.md) | 화면·Worker·웹 서버 파일을 읽는 순서 |

## 무엇부터 수정하면 되나요?

- **화면 문구와 배치:** `index.html`, `style.css`, `measurement-ui.mjs`.
- **카메라 프레임과 얼굴 처리:** `frame-pump.mjs`, `measurement-controller.mjs`, `measurement-worker.mjs`.
- **모델 또는 신호 처리:** `inference/models.py`, `signals.py`, `pipeline.py`.
- **질문과 결과 정리:** `inference/consultation.py`, `consultation-ui.mjs`.
- **실제 동작 확인:** 해당 기능 테스트와 `VALIDATION.md`.

외부 모델·MediaPipe 배포 자산과 라이선스는 직접 작성한 코드와 구분합니다. 개인 측정 파일과 API 키는 저장소에 추가하지 않습니다.

[첫 화면](../README.md) · [구조 설명](ARCHITECTURE.md)
