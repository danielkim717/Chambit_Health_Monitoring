"""Scheduling and rejection regression tests; synthetic outputs, not accuracy evidence."""
import time
from types import SimpleNamespace

import numpy as np
import pytest

from inference.pipeline import Pipeline


class RespirationDouble:
    spec = SimpleNamespace(id='mtts_can', metrics=('hr', 'rr'), min_fps=24,
                           fps=30, size=1, chunk_frames=180)
    model = True
    error = None

    def predict(self, frames):
        t = frames[:, 0, 0, 0]
        return {'hr': np.zeros(len(t)-1), 'rr': np.diff(np.sin(2*np.pi*.25*t))}


def job(seconds, fps=30, revision=0, final=False):
    times = np.arange(int(seconds*fps)+1)/fps
    return {'sessionId': 'test', 'revision': revision, 'final': final,
            # Simulate the RR-due snapshot being displaced by a newer HR job.
            'rrDue': False, 'state': {'droppedFrames': 0}, 'queuedAt': time.perf_counter(),
            'samples': tuple((t*1000, np.full((1, 1, 3), t, dtype=np.float32),
                              [100+np.sin(t), 110, 120], {}) for t in times)}


@pytest.fixture
def pipeline(monkeypatch):
    # Isolate HR failure from a valid, independent respiratory model output.
    monkeypatch.setattr('inference.pipeline.chrom', lambda rgb, fs: np.zeros(len(rgb)))
    monkeypatch.setattr('inference.pipeline.pos', lambda rgb, fs: np.zeros(len(rgb)))
    return Pipeline([RespirationDouble()])


def test_rr_runs_after_displaced_job_and_without_valid_hr(pipeline):
    early = pipeline.run(job(20))
    assert early['rr'] is None and early['metrics']['rr']['status'] == 'collecting'
    first = pipeline.run(job(35))
    assert first['hr'] is None
    assert first['rr'] == pytest.approx(15, abs=1)
    assert first['metrics']['rr']['sources'] == ['mtts_can']
    assert first['respWave']
    held = pipeline.run(job(37))
    assert held['metrics']['rr']['window'] == first['metrics']['rr']['window']
    updated = pipeline.run(job(40))
    assert updated['metrics']['rr']['window']['endMs'] > first['metrics']['rr']['window']['endMs']
    reset = pipeline.run(job(30, revision=1))
    assert reset['rr'] is None and reset['respWave'] == []


def test_rr_input_rejection_names_the_model_and_condition(pipeline):
    result = pipeline.run(job(60, fps=20, final=True))
    assert result['rr'] is None
    assert result['metrics']['rr']['reasonCode'] == 'low_fps'
    assert '부드럽게 전달되지 않아' in result['rrReason']
    assert 'mtts_can' not in result['rrReason'] and 'fps' not in result['rrReason']
    assert result['errors'][0]['requiredFps'] == 24


def test_rr_missing_checkpoint_is_not_a_generic_signal_failure(pipeline):
    pipeline.models[0].model = None
    pipeline.models[0].error = '가중치 파일 없음'
    result = pipeline.run(job(60, final=True))
    assert result['rr'] is None
    assert result['metrics']['rr']['reasonCode'] == 'model_unavailable'
    assert '측정 기능을 준비하지 못했습니다' in result['rrReason']
    assert 'mtts_can' not in result['rrReason']
    assert result['errors'][0]['message'] == '가중치 파일 없음'


def test_rr_distinguishes_brief_frame_gaps_from_low_fps(pipeline):
    request = job(36)
    request['samples'] = request['samples'][:500] + request['samples'][503:]
    result = pipeline.run(request)
    assert result['fps'] >= 24
    assert result['metrics']['rr']['reasonCode'] == 'frame_gap'
    assert '영상이 중간에 끊겨' in result['rrReason']
    assert 'mtts_can' not in result['rrReason']


def test_heart_preview_at_twenty_seconds_without_early_respiration(pipeline):
    def predict(frames):
        t = frames[:, 0, 0, 0]
        return {'hr': np.diff(np.sin(2*np.pi*1.2*t)), 'rr': np.zeros(len(t)-1)}
    pipeline.models[0].predict = predict
    result = pipeline.run(job(20))
    assert result['hr'] == pytest.approx(72, abs=1)
    assert result['rr'] is None and result['metrics']['rr']['status'] == 'collecting'


def test_completed_model_chunks_do_not_resize_old_video_again(pipeline, monkeypatch):
    import cv2
    pipeline.run(job(36))
    original = cv2.resize
    resized = []
    def track(image, *args, **kwargs):
        resized.append(1)
        return original(image, *args, **kwargs)
    monkeypatch.setattr(cv2, 'resize', track)
    result = pipeline.run(job(38))
    assert len(resized) <= 64  # Only the two-second tail, not all 1,141 frames.
    assert result['rr'] == pytest.approx(15, abs=1)


def test_client_diagnostics_explain_slow_processing_but_cannot_validate_low_fps(pipeline):
    request = job(60, fps=20, final=True)
    request['state']['capture'] = {'cameraFps': 30, 'processedFps': 20, 'pendingReplaced': 20}
    result = pipeline.run(request)
    assert result['hr'] is None and result['rr'] is None
    assert result['metrics']['rr']['reasonCode'] == 'processing_slow'
    assert '앱의 영상 처리' in result['rrReason']
    assert result['capture']['cameraFps'] == 30
