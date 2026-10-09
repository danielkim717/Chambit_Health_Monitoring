# Python 추론 서버 파일 안내

모델·신호·수집 상태·문진을 처리하는 로컬 서버입니다. 저장소 루트에서 Python 모듈로 실행합니다.

| 파일 | 역할 | 연결 |
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

[설치와 시작](../README.md) · [전체 파일 안내](../docs/FILE_GUIDE.md) · [구조 설명](../docs/ARCHITECTURE.md)
