# 파일 역할: 측정 실패 이유를 사용자 설명으로 변환
# 연결과 사용: 프레임 속도·신호 부족·모델 상태 등 판정 근거를 화면에 전달할 문구로 정리합니다.
# 파일 안내: docs/FILE_GUIDE.md
"""User-facing measurement feedback, separate from model diagnostics."""

def explain_failure(metric, result, candidates, errors, models, capture=None):
    if result['value'] is not None:
        return
    label = '심박수' if metric == 'hr' else '호흡수'
    model_ids = {m.spec.id for m in models if metric in m.spec.metrics}
    relevant = [e for e in errors if e['model'] in model_ids or e['model'] == 'capture']
    codes = {e.get('code') for e in relevant}
    if result['status'] == 'conflict':
        code = 'conflict'
    elif 'low_fps' in codes:
        code = 'low_fps'
        # Client telemetry explains the likely bottleneck; it cannot validate a
        # rejected physiological result or change measured server timestamps.
        capture = capture or {}
        if capture.get('cameraFps', 0) >= 24 and (
            capture.get('pendingReplaced', 0) > 0 or capture.get('bitmapDropped', 0) > 0 or
            capture.get('transportDropped', 0) > 0):
            code = 'processing_slow'
    elif 'frame_gap' in codes:
        code = 'frame_gap'
    elif (observed := [c for c in candidates if c['metric'] == metric]) and all(
            'periodicity' in c.get('rejectionCodes', []) for c in observed):
        code = 'unclear_periodicity'
    elif any(c['metric'] == metric for c in candidates) or 'weak_signal' in codes:
        code = 'weak_signal'
    elif 'model_unavailable' in codes or (metric == 'rr' and not model_ids):
        code = 'model_unavailable'
    elif 'analysis_error' in codes:
        code = 'analysis_error'
    else:
        code = 'weak_signal'
    messages = {
        'unclear_periodicity': f'영상에서 반복되는 {"맥박" if metric == "hr" else "호흡"} 변화를 뚜렷하게 찾지 못해 {label}를 표시하지 못했습니다. 편안하게 정면을 바라보며 자연스럽게 호흡하고 다시 측정해 주세요. 이 결과만으로 실제 호흡이나 심장 상태를 판단할 수는 없습니다.',
        'low_fps': f'카메라 영상이 충분히 부드럽게 전달되지 않아 {label}를 측정하지 못했습니다. 다른 카메라 앱이나 무거운 작업을 닫고, 밝은 곳에서 다시 측정해 주세요.',
        'processing_slow': f'카메라 영상은 들어오고 있지만 앱의 영상 처리나 전송 중 일부가 누락되어 {label}를 측정하지 못했습니다. 다른 무거운 작업을 닫고 다시 시도해 주세요.',
        'frame_gap': f'영상이 중간에 끊겨 {label}를 측정하지 못했습니다. 카메라 연결을 확인하고 얼굴을 화면 안에 유지한 채 다시 측정해 주세요.',
        'weak_signal': f'얼굴 영상에서 {label} 신호를 충분히 구분하지 못했습니다. 얼굴에 빛이 고르게 닿도록 하고, 움직임을 줄여 다시 측정해 주세요.',
        'model_unavailable': f'{label} 측정 기능을 준비하지 못했습니다. 잠시 후 다시 시도하고, 계속되면 측정 서버의 실행 상태를 확인해 주세요.',
        'analysis_error': f'영상 분석을 마치지 못해 {label}를 표시할 수 없습니다. 잠시 후 다시 측정해 주세요.',
        'conflict': f'분석 결과가 서로 달라 {label}를 확정하지 못했습니다. 편안한 자세로 다시 측정해 주세요.',
    }
    result.update(reasonCode=code, reason=messages[code])
