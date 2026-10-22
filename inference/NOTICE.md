# 모델 출처와 실행 방식

- EfficientPhys: Xin Liu 등, WACV 2023. 공식 rPPG-Toolbox 소스와 PURE 가중치.
  models.lock.json에 커밋·URL·SHA-256을 고정했습니다. upstream 라이선스는
  **Responsible Artificial Intelligence Source Code License 1.1**입니다.
  설치 시 weights/rppg-toolbox-LICENSE에 원문을 함께 내려받습니다.
- MTTS-CAN: Xin Liu 등, NeurIPS 2020. MIT 라이선스의 공식 HDF5 가중치.
  models.py는 추론 전용 PyTorch 변환 구현입니다. 재학습하지 않았고 NHWC flatten 순서,
  temporal shift와 두 출력 헤드를 유지합니다. weights/mtts-can-LICENSE와
  weights/mtts_model.py에 원문을 함께 내려받습니다.
- 구형 TensorFlow를 현재 Windows/Python 환경의 필수 의존성으로 두지 않았습니다.
  대신 저장된 Keras 그래프를 별도 NumPy 실행기로 계산해 양쪽 출력의 일치를 테스트합니다.
  전체 원본 TensorFlow 동영상 파이프라인을 실행했다는 뜻은 아닙니다.
- 두 모델은 30fps와 10프레임 temporal shift 그룹을 사용합니다. EfficientPhys는
  180개 차분 출력마다 정규화하고 완료 구간을 캐시합니다. 경계 프레임 하나를 공유합니다.
- MTTS-CAN은 선택한 연속 분석 구간 전체에 하나의 정규화 기준을 적용합니다.
  [공식 전처리](https://github.com/xliucs/MTTS-CAN/blob/89ffe818e1701ebcc156d4193657258e506eb781/code/inference_preprocess.py)의
  motion 표준편차·appearance 평균/표준편차 계산 범위를 따릅니다. 6초마다 재정규화하던
  기존 경로는 제거했습니다. 정규화 후 신경망 계산만 180프레임씩 나누므로 배치마다 입력 척도가 바뀌지 않습니다.
  호흡 분석 시점(5초 주기 요청)과 최종 분석 때 구간 전체를 재계산하며, 완전히 같은 구간만 재사용합니다.
  차분 출력을 시간순으로 합친 뒤 한 번 적분합니다. JSON의 normalization은 continuous_window입니다.
- 전체 원본 TensorFlow 파이프라인 재현은 아닙니다. 실시간 연속 구간 선택, 얼굴 ROI,
  보간과 마지막 차분 처리, 공통 후처리 필터는 원본 예제와 차이가 있습니다.
  특히 예제의 smoothness-prior detrend(100)와 앱의 선형 detrend·공통 필터는 다릅니다.
  실제 영상으로 검증해야 하며 논문 정확도를 이 데모에 그대로 적용하지 않습니다.
- 정지 영상의 모델 경계 아티팩트를 생체신호로 오인하지 않도록 피부 RGB의 시간 변화,
  주기성, fps 및 프레임 연속성을 별도로 검사합니다.
- CHROM·POS와 맥파 유도 호흡은 비교 기준입니다. 맥파 유도 호흡의 진폭·간격 결과는
  하나의 종속 후보입니다. SQI와 군집 임계값은 공학적 초기값이며 임상 기준이 아닙니다.
- PhysAgent의 역할 분리와 후보 검증을 참고했습니다. Qwen3-VL 기반 원논문 재현이 아니며
  호흡 검증은 별도의 확장입니다. BiPulseFormer는 후보에만 등록했습니다.

가중치와 다운로드한 모델 소스는 Git에 포함하지 않습니다. 라이선스 원문은 licenses/에도
포함합니다. EfficientPhys 및 그 변환 코드에는 rPPG-Toolbox 라이선스의 사용 제한이 적용됩니다.
재배포 시 원문과 제한을 함께 전달해야 합니다.
