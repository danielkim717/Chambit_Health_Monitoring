# 웹 화면과 카메라 파일 안내

`npm start`는 웹 서버와 Python 추론 서버를 함께 실행합니다. 화면, 카메라 Worker, 서버 중계를 아래처럼 나눴습니다.

| 파일 | 역할 | 연결 |
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

[설치와 시작](../README.md) · [전체 파일 안내](../docs/FILE_GUIDE.md) · [구조 설명](../docs/ARCHITECTURE.md)
