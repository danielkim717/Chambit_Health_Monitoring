# 저장소 백업·복구 및 업데이트

새 저장소: [danielkim717/Chambit_Health_Monitoring](https://github.com/danielkim717/Chambit_Health_Monitoring)

2026-10-12에 Monitoring을 공개 저장소로 전환했습니다. 이후 개발과 업데이트는 Monitoring을 기준으로 합니다.
GitHub Topics에는 `computer-vision`, `rppg`, `remote-photoplethysmography`, `heart-rate`,
`respiratory-rate`, `health-monitoring`, `webcam`, `pytorch`, `fastapi`, `mediapipe`를 등록했습니다.

기존 `Chambit_Health_Interview`는 2026-10-12 확인 시 비공개 저장소로 존재했습니다.
새 저장소는 해당 저장소의 최신 이력과 현재 작업 내용을 함께 보존합니다.

## 다른 PC에서 복구

GitHub의 저장소 **Code → HTTPS** 주소로 새 폴더에 복제합니다. 공개 저장소이므로 로그인 없이
복제할 수 있으며, 변경 내용을 푸시하려면 쓰기 권한이 필요합니다.
복제 후 [README](../README.md)의 설치·실행 절차를 따릅니다.

```powershell
git clone https://github.com/danielkim717/Chambit_Health_Monitoring.git
cd Chambit_Health_Monitoring
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r inference/requirements-dev.txt
.\.venv\Scripts\python.exe -m inference.setup_models
cd chambit_health_demo
npm.cmd ci --ignore-scripts
npm.cmd start
```

기본 접속 주소는 `http://localhost:5500`입니다. 다른 웹 포트를 사용하려면
`npm.cmd start` 전에 PowerShell에서 `$env:PORT='5501'`처럼 지정합니다.
가상환경은 PC 사이에 복사하지 말고 다시 만듭니다. 개인 키가 필요하다면 `.env.example`을
참고해 `.env`를 로컬에 별도로 구성합니다. 규칙 문진은 외부 API 키 없이 사용할 수 있습니다.

## 포함한 파일

- 브라우저 화면, 얼굴 추적·측정 코드와 로컬 MediaPipe 실행 자산
- Node 서버와 Python 모델·신호·문진 코드
- 모델 출처·체크섬·라이선스 원문, 가중치 설치 도구
- 자동 테스트, 검증 기록, 설치·구조·개발 현황 문서
- 이전 건강문진 저장소의 로컬 커밋 이력

## Git에서 제외한 파일

- `.venv/`, `node_modules/`, Python·테스트 캐시
- 개인 `.env`, API 키, 서버 로그
- `inference/weights/`의 모델 가중치와 내려받은 소스
- `inference/artifacts/`, 루트 `artifacts/`, 브라우저 검사 결과
- `measurement-analysis-*.json` 개인 측정 분석 파일
- `portfolio_revision/` 개인 포트폴리오 및 `resPyre/` 참조 체크아웃
- `.publish/` 로컬 게시용 체크아웃

개인 얼굴 영상이나 측정 파일은 이름이 달라져도 저장소에 추가하지 않습니다.
모델 가중치는 `inference.setup_models`로 다시 받고 체크섬을 검증합니다.

## 수정 후 업데이트

처음 작업 폴더를 정할 때 `git remote -v`로 업로드 대상이 새 건강 모니터링 저장소인지 확인합니다.
협업자의 원본 저장소와 새 저장소를 혼동하지 않도록 새 저장소를 별도 폴더에 복제해 작업하는 것이 좋습니다.

```powershell
git status --short
git diff
# 변경 범위에 맞게 Python/Node/브라우저 검사를 실행합니다.
git add <검토한 코드와 문서 경로>
git diff --cached --check
git commit -m "변경 내용을 설명하는 메시지"
git push origin main
```

푸시 후 GitHub의 최신 커밋과 로컬 `git rev-parse HEAD`가 일치하는지 확인합니다.
원격에 다른 변경이 있으면 먼저 내용을 확인해 통합하고, 강제 푸시로 덮어쓰지 않습니다.
저장소의 **Insights → Network / Commits**와 각 파일의 **History**에서 과거 버전을 확인할 수 있습니다.

새로 복제한 저장소는 일반 Git 작업 흐름을 사용합니다. 현재 원본 작업 폴더는 협업자의
저장소 연결을 유지하므로 자동 게시 작업은 `.publish/` 아래 별도 체크아웃에서 수행합니다.
