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
    early = pipeline.run(job(18))
    assert early['rr'] is None and early['metrics']['rr']['status'] == 'collecting'
    preview = pipeline.run(job(20))
    assert preview['rr'] == pytest.approx(15, abs=1)
    assert preview['metrics']['rr']['status'] == 'preliminary'
    first = pipeline.run(job(35))
    assert first['hr'] is None
    assert first['rr'] == pytest.approx(15, abs=1)
    assert first['metrics']['rr']['sources'] == ['mtts_can']
    assert first['respWave']
    held = pipeline.run(job(37))
    assert held['metrics']['rr']['window'] == first['metrics']['rr']['window']
    updated = pipeline.run(job(40))
    assert updated['metrics']['rr']['window']['endMs'] > first['metrics']['rr']['window']['endMs']
    reset = pipeline.run(job(18, revision=1))
    assert reset['rr'] is None and reset['respWave'] == []


def test_full_waveforms_only_in_final_result_and_preserve_rejected_candidates(pipeline):
    import json
    intermediate = pipeline.run(job(36))
    assert 'signalDiagnostics' not in intermediate
    final = pipeline.run(job(60, final=True))
    assert final['hr'] is None and final['rr'] == pytest.approx(15, abs=1)
    diagnostics = final['signalDiagnostics']
    assert len(diagnostics['mtts_can:rr']['inputWave']) == 1800
    assert diagnostics['mtts_can:rr']['chunkLengths'] == [180]*10
    assert diagnostics['mtts_can:hr']['inputWave'] == [0.]*1800
    assert all('signalDiagnostics' not in c for c in final['candidates'])
    assert np.allclose(np.cumsum(diagnostics['mtts_can:rr']['modelDifferences']),
                       diagnostics['mtts_can:rr']['inputWave'])
    json.dumps(final, allow_nan=False)


def test_respiration_rejection_explains_detected_signal_not_camera_speed(pipeline):
    from scipy.signal import chirp
    def predict(frames):
        t = frames[:, 0, 0, 0]
        return {'hr': np.zeros(len(t)-1),
                'rr': np.diff(chirp(t, f0=.12, f1=.48, t1=60))}
    pipeline.models[0].predict = predict
    result = pipeline.run(job(60, final=True))
    assert result['rr'] is None
    assert result['metrics']['rr']['reasonCode'] == 'unclear_periodicity'
    assert '반복되는 호흡 변화' in result['rrReason']
    assert 'mtts_can' not in result['rrReason'] and 'fps' not in result['rrReason']
    assert result['signalDiagnostics']['mtts_can:rr']['filteredWave']


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


def test_rr_recovers_a_continuous_window_without_interpolating_across_gap(pipeline):
    request = job(60, final=True)
    request['samples'] = request['samples'][:500] + request['samples'][504:]
    seen = []
    original = pipeline.models[0].predict
    def track(frames):
        seen.extend(frames[:, 0, 0, 0].tolist())
        return original(frames)
    pipeline.models[0].predict = track
    result = pipeline.run(request)
    assert result['rr'] == pytest.approx(15, abs=1)
    rr = result['metrics']['rr']
    assert rr['partialWindow'] and result['quality'] == 'partial'
    assert rr['window']['startMs'] == pytest.approx(16800)
    assert rr['window']['endMs'] <= 60000
    assert min(seen) >= 16.8-1e-5
    assert '연속된 43.0초' in result['rrReason']
    assert result['signalDiagnostics']['mtts_can:rr']['startMs'] == rr['window']['startMs']
    assert pipeline.run(job(18, revision=1))['rr'] is None


def test_rr_does_not_join_two_short_spans_to_make_35_seconds(pipeline):
    request = job(60, final=True)
    request['samples'] = request['samples'][:900] + request['samples'][904:]
    result = pipeline.run(request)
    assert result['rr'] is None
    assert result['metrics']['rr']['reasonCode'] == 'short_continuous_window'
    assert '연속 35초' in result['rrReason']


def test_recovered_window_must_have_real_temporal_signal(pipeline):
    request = job(60, final=True)
    request['samples'] = request['samples'][:500] + tuple(
        (t, pixels, [100, 110, 120], scene) for t, pixels, _, scene in request['samples'][504:])
    assert pipeline.run(request)['rr'] is None


def test_latest_equal_length_continuous_window_wins_without_quality_search():
    from inference.pipeline import continuous_model_samples
    samples = tuple((t,) for t in list(range(0, 21001, 40))+list(range(22000, 43001, 40)))
    chosen = continuous_model_samples(samples, 24)
    assert chosen[0][0] == 22000 and chosen[-1][0] == 43000
    assert continuous_model_samples(tuple((t,) for t in range(0, 60001, 50)), 24) is None


def test_rr_distinguishes_brief_frame_gaps_from_low_fps(pipeline):
    request = job(36)
    request['samples'] = tuple(s for i, s in enumerate(request['samples']) if i % 300 < 297)
    result = pipeline.run(request)
    assert result['fps'] >= 24
    assert result['metrics']['rr']['reasonCode'] == 'frame_gap'
    assert '영상이 중간에 끊겨' in result['rrReason']
    assert 'mtts_can' not in result['rrReason']


def test_heart_preview_at_twelve_seconds_without_early_respiration(pipeline):
    def predict(frames):
        t = frames[:, 0, 0, 0]
        return {'hr': np.diff(np.sin(2*np.pi*1.2*t)), 'rr': np.zeros(len(t)-1)}
    pipeline.models[0].predict = predict
    result = pipeline.run(job(12))
    assert result['hr'] == pytest.approx(72, abs=1)
    assert result['metrics']['hr']['status'] == 'preliminary'
    assert result['rr'] is None and result['metrics']['rr']['status'] == 'collecting'
    confirmed = pipeline.run(job(20))
    assert confirmed['metrics']['hr']['status'] == 'valid'


def test_preview_cannot_be_carried_into_final_after_short_continuous_capture(pipeline):
    request = job(60)
    request['samples'] = request['samples'][:900] + request['samples'][904:]
    preview = pipeline.run(request)
    assert preview['rr'] == pytest.approx(15, abs=1)
    assert preview['metrics']['rr']['status'] == 'preliminary'
    request['final'] = True
    final = pipeline.run(request)
    assert final['rr'] is None and final['respWave'] == []
    assert all(c['status'] != 'preliminary' for c in final['candidates'])


def test_continuous_normalization_uses_whole_interval_on_rr_cadence_and_resets(pipeline):
    from copy import copy
    adapter = pipeline.models[0]
    adapter.spec = copy(adapter.spec)
    adapter.spec.normalization = 'continuous_window'
    seen = []
    predict = adapter.predict
    def track(frames):
        seen.append(len(frames))
        return predict(frames)
    adapter.predict = track
    first = pipeline.run(job(20))
    assert seen == [601] and first['rr'] == pytest.approx(15, abs=1)
    pipeline.run(job(22))
    assert seen == [601]  # No full-window work during the intervening HR job.
    next_result = pipeline.run(job(25))
    assert seen == [601,751] and next_result['rr'] == pytest.approx(15, abs=1)
    final = pipeline.run(job(60, final=True))
    assert seen[-1] == 1801
    assert final['signalDiagnostics']['mtts_can:rr']['normalization'] == 'continuous_window'
    assert final['signalDiagnostics']['mtts_can:rr']['chunkLengths'] == [1800]
    pipeline.run(job(60, final=True))
    assert seen == [601,751,1801]  # An unchanged interval may be reused.
    pipeline.run(job(60, revision=1, final=True))
    assert seen == [601,751,1801,1801]


def test_continuous_normalization_never_joins_across_a_camera_gap(pipeline):
    from copy import copy
    adapter = pipeline.models[0]
    adapter.spec = copy(adapter.spec)
    adapter.spec.normalization = 'continuous_window'
    seen = []
    predict = adapter.predict
    def track(frames):
        seen.append(frames[:,0,0,0].copy())
        return predict(frames)
    adapter.predict = track
    request = job(60, final=True)
    request['samples'] = request['samples'][:500] + request['samples'][504:]
    result = pipeline.run(request)
    assert len(seen) == 1 and seen[0][0] == pytest.approx(16.8)
    assert len(seen[0]) == 1291
    assert result['rr'] == pytest.approx(15, abs=1)
    assert result['metrics']['rr']['partialWindow']


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


def test_sliding_buffer_discards_stale_preprocessing_cache(pipeline):
    pipeline.run(job(60))
    request=job(66,final=True)
    request['samples']=request['samples'][180:]
    request['state']['collectionElapsedMs']=66000
    result=pipeline.run(request)
    assert result['rr']==pytest.approx(15,abs=1)
    assert result['collectionElapsedMs']==66000
    assert result['durationMs']==pytest.approx(60000)
    assert len(pipeline.cache)<=10
    assert all(key[1]==6000 for key in pipeline.cache)
    assert result['captureIntervals']['longestMs']==60000


def test_sliding_buffer_keeps_unchanged_post_gap_model_chunks(pipeline):
    calls=[]
    original=pipeline.models[0].predict
    def predict(frames):
        calls.append(len(frames))
        return original(frames)
    pipeline.models[0].predict=predict
    first=job(65)
    first['samples']=first['samples'][150:951]+first['samples'][957:]
    pipeline.run(first)
    calls.clear()
    final=job(67,final=True)
    final['samples']=final['samples'][210:951]+final['samples'][957:]
    result=pipeline.run(final)
    assert result['rr']==pytest.approx(15,abs=1)
    assert sum(calls)<=181  # Only the unfinished tail, never the full 35s interval.


def test_client_diagnostics_explain_slow_processing_but_cannot_validate_low_fps(pipeline):
    request = job(60, fps=20, final=True)
    request['state']['capture'] = {'cameraFps': 30, 'processedFps': 20, 'pendingReplaced': 20}
    result = pipeline.run(request)
    assert result['hr'] is None and result['rr'] is None
    assert result['metrics']['rr']['reasonCode'] == 'processing_slow'
    assert '앱의 영상 처리' in result['rrReason']
    assert result['capture']['cameraFps'] == 30


def test_weak_rr_is_partial_and_strict_mode_can_restore_original_rejection(pipeline):
    times = np.arange(1801)/30
    # Include the leading boundary sample consumed by temporal differencing.
    output_times = times[:-1]
    output = np.sin(2*np.pi*.25*output_times)+np.random.default_rng(2).normal(size=len(output_times))*7
    weak = np.r_[output[0], output]
    def predict(frames):
        t = frames[:, 0, 0, 0]
        return {'hr': np.diff(np.sin(2*np.pi*1.2*t)),
                'rr': np.diff(np.interp(t, times, weak))}
    pipeline.models[0].predict = predict
    result = pipeline.run(job(60, final=True))
    assert result['metrics']['hr']['status'] == 'valid'
    assert result['metrics']['rr']['status'] == 'tentative'
    assert result['quality'] == 'partial' and result['rr'] is not None
    pipeline.quality_mode = 'strict'
    strict = pipeline.run(job(60, revision=1, final=True))
    assert strict['rr'] is None
