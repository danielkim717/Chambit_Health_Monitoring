# 파일 역할: 측정 상태와 모델 분석 흐름 관리
# 연결과 사용: 준비·수집·완료 상태, 프레임 버퍼, 분석 구간, 모델 후보와 최종값을 관리합니다.
# 파일 안내: docs/FILE_GUIDE.md
"""Per-measurement state and a bounded, incremental inference pipeline."""
from collections import deque
from dataclasses import dataclass, field
import os
import time
import uuid

import cv2
import numpy as np

from .signals import candidate, chrom, pos, derived_respiration, fuse, PREVIEW_SECONDS, FINAL_SECONDS
from .feedback import explain_failure

HR_PREVIEW_MS = PREVIEW_SECONDS['hr'] * 1000
RR_PREVIEW_MS = PREVIEW_SECONDS['rr'] * 1000
RR_FINAL_MS = FINAL_SECONDS['rr'] * 1000
RR_EXTRA_MS = 30000


def capture_intervals(samples, min_fps=24):
    times = np.array([s[0] for s in samples], dtype=float)
    if len(times) < 2:
        return {'longestMs': 0., 'currentMs': 0., 'gapCount': 0, 'gaps': [], 'intervals': []}
    gaps = np.diff(times)
    breaks = np.flatnonzero(gaps > 100)
    cuts = np.r_[0, breaks+1, len(times)]
    intervals = []
    for left, right in zip(cuts[:-1], cuts[1:]):
        span = times[right-1]-times[left]
        fps = (right-left-1)*1000/span if span > 0 else 0.
        # Match the actual ten-frame model grid; raw duration alone can overstate it.
        supported = int(span*30/1000/10+1e-6)*10*1000/30 if fps >= min_fps else 0.
        intervals.append({'startMs': float(times[left]), 'endMs': float(times[right-1]),
                          'fps': float(fps), 'supportedMs': float(supported)})
    return {'longestMs': max(i['supportedMs'] for i in intervals),
            'currentMs': intervals[-1]['supportedMs'], 'gapCount': len(breaks),
            'gaps': [{'startMs': float(times[i]), 'endMs': float(times[i+1]),
                      'durationMs': float(gaps[i])} for i in breaks], 'intervals': intervals}


def continuous_model_samples(samples, min_fps):
    """Keep one real, continuous interval; never join across a camera gap."""
    times = np.array([s[0] for s in samples], dtype=float)
    cuts = np.r_[0, np.flatnonzero(np.diff(times) > 100) + 1, len(times)]
    spans = []
    for left, right in zip(cuts[:-1], cuts[1:]):
        duration = times[right-1]-times[left]
        if right-left > 1 and duration >= HR_PREVIEW_MS and (right-left-1)*1000/duration >= min_fps:
            spans.append((duration, times[right-1], left, right))
    if not spans:
        return None
    # Prefer the longest supported interval (latest on a tie), not the best-looking signal.
    _, _, left, right = max(spans)
    return samples[left:right]

@dataclass
class Measurement:
    started: float
    id: str = field(default_factory=lambda: uuid.uuid4().hex)
    revision: int = 0
    phase: str = 'preparing'
    samples: deque = field(default_factory=lambda: deque(maxlen=2100))
    stable: float | None = None
    collection: float | None = None
    good: float | None = None
    last: float | None = None
    last_seq: int = -1
    invalid: float | None = None
    reason: str = '얼굴을 정면으로 맞춰 주세요.'
    received: int = 0
    dropped: int = 0
    prepare_ms: float = 5000
    collect_ms: float = 60000
    max_ms: float = 120000
    last_hr: float = 0
    last_rr: float = 0
    clock_skew_ms: float | None = None
    transit_ms: float = 0
    capture: dict = field(default_factory=dict)
    rr_min_fps: float | None = None
    extra_ms: float = RR_EXTRA_MS
    extending: bool = False
    capture_check: dict = field(default_factory=dict)

    def reset(self, reason):
        self.revision += 1
        self.phase = 'preparing'
        self.samples.clear()
        self.stable = self.collection = self.good = None
        self.last_hr = self.last_rr = 0
        self.capture = {}
        self.extending = False
        self.capture_check = {}
        self.reason = reason

    def tick(self, t):
        if self.phase not in ('preparing', 'collecting'):
            return
        if t-self.started >= self.max_ms:
            self.phase = 'timeout'
            self.samples.clear()
            self.reason = '120초 내 측정을 완료하지 못했습니다.'
        elif self.good is not None and t-self.good >= 500:
            self.reset('영상 또는 얼굴 신호가 끊겨 준비부터 다시 시작합니다.')

    def feed(self, packet, pixels):
        t, seq = packet['t'], packet['seq']
        if seq <= self.last_seq or (self.last is not None and t <= self.last):
            self.dropped += 1
            return False
        self.dropped += max(0, seq-self.last_seq-1) if self.last_seq >= 0 else 0
        self.last, self.last_seq = t, seq
        self.received += 1
        self.capture = dict(packet.get('capture', {}))
        self.tick(t)
        if self.phase not in ('preparing', 'collecting'):
            return False
        # Explicit quality-invalid frames advance elapsed time but never become signal.
        if pixels is None:
            self.invalid = t if self.invalid is None else self.invalid
            self.reason = packet.get('reason') or '촬영 조건을 확인해 주세요.'
            if self.phase == 'preparing':
                self.stable = None
            if t-self.invalid >= 500 and self.good is not None:
                self.reset(self.reason)
            return False
        self.invalid = None
        self.good = t
        self.stable = t if self.stable is None else self.stable
        if self.phase == 'preparing' and t-self.stable >= self.prepare_ms:
            self.phase = 'collecting'
            self.collection = t
        if self.phase == 'collecting':
            self.samples.append((t, pixels, packet['rgb'], packet.get('scene', {})))
            # Retain at most 60 seconds (plus one boundary frame for interpolation).
            while len(self.samples) > 1 and t-self.samples[1][0] > self.collect_ms:
                self.samples.popleft()
            self.capture_check = capture_intervals(self.samples, self.rr_min_fps or 24)
            if t-self.collection >= self.collect_ms:
                deadline = min(self.collection+self.collect_ms+self.extra_ms, self.started+self.max_ms-1000)
                self.extending = (self.rr_min_fps is not None and
                                  self.capture_check['longestMs'] < RR_FINAL_MS and t < deadline)
                if not self.extending:
                    self.phase = 'complete'
        self.reason = '편안하게 정면을 바라보며 자연스럽게 호흡해 주세요.'
        if self.extending:
            self.reason = '호흡 분석에 필요한 연속 영상이 부족해 최대 30초 더 수집합니다. 편안하게 자연 호흡을 유지해 주세요.'
        return True

    def state(self, now):
        good = self.good if self.good is not None else 0
        collection = self.collection if self.collection is not None else good
        stable = self.stable if self.stable is not None else good
        duration = max(0, good-collection)
        span = self.samples[-1][0]-self.samples[0][0] if len(self.samples)>1 else 0
        fps = (len(self.samples)-1)*1000/span if span > 0 else 0
        return {'phase': self.phase, 'revision': self.revision, 'reason': self.reason,
                'preparedMs': min(self.prepare_ms, max(0, good-stable)),
                'collectedMs': min(duration, self.collect_ms), 'elapsedMs': max(0, now-self.started),
                'collectionElapsedMs': duration,
                'respirationCapture': {'extending': self.extending,
                    'longestMs': self.capture_check.get('longestMs', 0),
                    'currentMs': self.capture_check.get('currentMs', 0), 'requiredMs': RR_FINAL_MS,
                    'extraMs': max(0, duration-self.collect_ms), 'maxExtraMs': self.extra_ms,
                    'gapCount': self.capture_check.get('gapCount', 0)},
                'fps': fps, 'requestedFps': 30, 'receivedFrames': self.received,
                'droppedFrames': self.dropped, 'transportDelayMs': round(self.transit_ms, 1),
                'capture': dict(self.capture)}

    def job(self, final=False):
        if len(self.samples) < 2:
            return None
        duration = self.samples[-1][0]-self.collection
        # Fill the incremental model cache before the first visible 12-second result.
        hr = duration >= 6000 and duration-self.last_hr >= (5000 if self.extending else 2000)
        rr = duration >= RR_PREVIEW_MS and duration-self.last_rr >= 5000
        if not final and not (hr or rr):
            return None
        if hr or final:
            self.last_hr = duration
        if rr or final:
            self.last_rr = duration
        return {'sessionId': self.id, 'revision': self.revision, 'samples': tuple(self.samples),
                'final': final, 'rrDue': rr or final, 'state': self.state(self.samples[-1][0]),
                'queuedAt': time.perf_counter()}

class Pipeline:
    def __init__(self, models):
        self.models = models
        self.quality_mode = os.getenv('SIGNAL_QUALITY_MODE', 'balanced')
        if self.quality_mode not in ('strict', 'balanced'):
            raise ValueError('SIGNAL_QUALITY_MODE must be strict or balanced')
        self.cache = {}
        self.window_cache = {}
        self.generation = None
        self.last_rr = None
        self.last_rr_end = None
        self.last_rr_wave = []
        self.buffer_start = None

    def run(self, job):
        started = time.perf_counter()
        generation = (job['sessionId'], job['revision'])
        if generation != self.generation:
            self.cache.clear()
            self.window_cache.clear()
            self.last_rr = None
            self.last_rr_end = None
            self.last_rr_wave = []
            self.generation = generation
        samples = job['samples']
        times = np.array([s[0] for s in samples], dtype=float)
        start, end = float(times[0]), float(times[-1])
        # Discard expired preprocessing windows, but retain an unchanged interval
        # after a gap. Evicting that interval on every slide repeats all inference.
        if self.buffer_start != start:
            self.cache = {key: value for key, value in self.cache.items() if key[1] >= start}
            self.buffer_start = start
        acquisition_end = end
        # Schedule from completed RR analysis, not from a queued request that may
        # have been replaced by a newer HR snapshot while inference was busy.
        rr_due = job['final'] or (end-start >= RR_PREVIEW_MS and
                  (self.last_rr_end is None or end-self.last_rr_end >= 5000))
        fps = (len(times)-1)*1000/(end-start)
        # Align every candidate to the same supported 10-frame grid interval.
        end = start + int((end-start)*30/1000/10+1e-6)*10*1000/30
        candidates, errors, timings = [], [], {}
        # Irregular camera time is retained. Linear resampling is permitted only for
        # small gaps on an adequately sampled stream, never to disguise a low fps.
        raw_rgb = np.array([s[2] for s in samples])
        temporal_signal = bool(np.max(np.std(raw_rgb, axis=0)) > 1e-4)
        max_gap = float(np.max(np.diff(times)))
        timing_ok = fps >= 15 and max_gap < 500 and temporal_signal
        if timing_ok:
            fs = min(30., fps)
            grid = np.arange(start, end+.001, 1000/fs)
            rgb = np.array([s[2] for s in samples])
            rgb = np.column_stack([np.interp(grid, times, rgb[:, c]) for c in range(3)])
            for name, method in [('chrom', chrom), ('pos', pos)]:
                wave = method(rgb, fs)
                c = candidate(name, 'hr', wave, fs, start, end, include_diagnostics=job['final'],
                              quality_mode=self.quality_mode, allow_preview=not job['final'])
                if job['final']:
                    c['signalDiagnostics']['inputMeaning'] = 'baseline_pulse_waveform'
                candidates.append(c)
                if name == 'chrom' and rr_due:
                    rr = derived_respiration(wave, fs, start, end)
                    if rr:
                        candidates.append(rr)
        else:
            code = 'low_fps' if fps < 15 else 'frame_gap' if max_gap >= 500 else 'weak_signal'
            errors.append({'model': 'capture', 'code': code, 'fps': fps, 'maxGapMs': max_gap,
                           'message': '프레임 속도, 연속성 또는 영상 변화량이 부족합니다.'})
        for adapter in self.models:
            spec = adapter.spec
            normalization = getattr(spec, 'normalization', 'per_chunk')
            if adapter.model is None:
                errors.append({'model': spec.id, 'code': 'model_unavailable', 'message': adapter.error})
                continue
            # Whole-window respiratory preprocessing costs more than an incremental
            # heart update. Run it on the RR cadence (and on early HR/final jobs).
            if normalization == 'continuous_window' and not rr_due and end-start >= RR_PREVIEW_MS:
                continue
            model_samples = samples
            if max_gap > 100 or fps < spec.min_fps:
                model_samples = continuous_model_samples(samples, spec.min_fps)
            model_signal = model_samples is not None and bool(np.max(np.std(
                np.array([s[2] for s in model_samples]), axis=0)) > 1e-4)
            if model_samples is None or not model_signal:
                code = 'low_fps' if fps < spec.min_fps else 'frame_gap' if max_gap > 100 else 'weak_signal'
                errors.append({'model': spec.id, 'code': code, 'fps': fps, 'maxGapMs': max_gap,
                               'requiredFps': spec.min_fps, 'allowedGapMs': 100,
                               'message': '학습 모델의 입력 속도, 연속성 또는 영상 변화량 조건을 충족하지 못했습니다.'})
                continue
            model_times = np.array([s[0] for s in model_samples], dtype=float)
            model_start_ms, model_end_ms = float(model_times[0]), float(model_times[-1])
            model_end_ms = model_start_ms + int((model_end_ms-model_start_ms)*30/1000/10+1e-6)*10*1000/30
            partial_window = model_start_ms != start or model_end_ms != end
            required_rr_ms = RR_FINAL_MS if job['final'] else RR_PREVIEW_MS
            if partial_window and rr_due and 'rr' in spec.metrics and model_end_ms-model_start_ms < required_rr_ms:
                errors.append({'model': spec.id, 'code': 'short_continuous_window',
                               'availableSeconds': (model_end_ms-model_start_ms)/1000,
                               'requiredSeconds': required_rr_ms/1000,
                               'message': '호흡 분석에 필요한 연속 구간이 부족합니다.'})
            model_start = time.perf_counter()
            try:
                grid = np.arange(model_start_ms, model_end_ms+.001, 1000/spec.fps)
                index = np.searchsorted(model_times, grid, side='right').clip(1, len(model_times)-1)
                weight = ((grid-model_times[index-1])/(model_times[index]-model_times[index-1])).astype(np.float32)
                count = (len(grid)-1)//10*10
                pieces = {metric: [] for metric in spec.metrics}
                step = max(count, 10) if normalization == 'continuous_window' else spec.chunk_frames
                for offset in range(0, count, step):
                    n = min(step, count-offset)
                    key = (spec.id, model_start_ms, offset)
                    window_key = (model_start_ms, model_end_ms)
                    cached_window = self.window_cache.get(spec.id)
                    output = ((cached_window[1] if cached_window and cached_window[0] == window_key else None)
                              if normalization == 'continuous_window' else self.cache.get(key))
                    if output is None:
                        indices, mix = index[offset:offset+n+1], weight[offset:offset+n+1, None, None, None]
                        # Completed chunks already have cached outputs. Resize only
                        # the real source frames needed for this new/tail chunk.
                        needed = np.unique(np.concatenate((indices-1, indices)))
                        reduced = np.stack([cv2.resize(model_samples[i][1], (spec.size, spec.size),
                                                      interpolation=cv2.INTER_AREA) for i in needed])
                        before = reduced[np.searchsorted(needed, indices-1)].astype(np.float32)
                        after = reduced[np.searchsorted(needed, indices)].astype(np.float32)
                        frames = before*(1-mix)+after*mix
                        output = adapter.predict(frames)
                        if normalization == 'continuous_window':
                            self.window_cache[spec.id] = (window_key, output)
                        elif n == spec.chunk_frames:
                            self.cache[key] = output
                    for metric in spec.metrics:
                        pieces[metric].append(output[metric])
                for metric, segments in pieces.items():
                    if not segments or (metric == 'rr' and not rr_due):
                        continue
                    # Reconstruct differences once over a contiguous output sequence.
                    # Never concatenate independently bandpassed/cumulative waveforms.
                    differences = np.concatenate(segments)
                    wave = np.cumsum(differences)
                    c = candidate(spec.id, metric, wave, spec.fps, model_start_ms, model_end_ms,
                                  include_diagnostics=job['final'], quality_mode=self.quality_mode,
                                  allow_preview=not job['final'])
                    c['partialWindow'] = partial_window
                    if job['final']:
                        c['signalDiagnostics'].update(inputMeaning='cumulative_model_temporal_difference',
                            modelDifferences=differences.tolist(), chunkFrames=spec.chunk_frames,
                            chunkLengths=[len(segment) for segment in segments],
                            normalization=normalization, inputSize=spec.size,
                            inferenceBatchFrames=spec.chunk_frames)
                    candidates.append(c)
                timings[spec.id] = round((time.perf_counter()-model_start)*1000, 1)
            except Exception as exc:
                errors.append({'model': spec.id, 'code': 'analysis_error', 'message': f'{type(exc).__name__}: {exc}'})
        hr, hr_audit = fuse(candidates, 'hr')
        self.describe_window(hr, start, acquisition_end)
        capture = job['state'].get('capture', {})
        explain_failure('hr', hr, candidates, errors, self.models, capture)
        if not job['final']:
            self.describe_collecting(hr, 'hr', candidates)
        if rr_due:
            rr, rr_audit = fuse(candidates, 'rr')
            self.describe_window(rr, start, acquisition_end)
            explain_failure('rr', rr, candidates, errors, self.models, capture)
            if not job['final']:
                self.describe_collecting(rr, 'rr', candidates)
            self.last_rr = (rr, rr_audit)
            self.last_rr_end = acquisition_end
        elif self.last_rr is not None:
            rr, rr_audit = self.last_rr
        else:
            rr, rr_audit = fuse([], 'rr')
            rr['status'], rr['reason'] = 'collecting', f'호흡수는 수집 {RR_PREVIEW_MS//1000}초부터 분석합니다.'
        valid_hr, valid_rr = hr['value'] is not None, rr['value'] is not None
        best = next((c for c in candidates if c['id'] in hr_audit['selected']), None)
        best_rr = next((c for c in candidates if c['id'] in rr_audit['selected']), None)
        if rr_due:
            self.last_rr_wave = best_rr['wave'] if best_rr else []
        scene = {'receivedFps': fps, 'maxGapMs': float(np.max(np.diff(times))),
                 'droppedFrames': job['state']['droppedFrames']}
        for key in ['motion', 'brightness', 'exposure']:
            values = [s[3].get(key) for s in samples if s[3].get(key) is not None]
            scene[key] = float(np.mean(values)) if values else None
        elapsed = (time.perf_counter()-started)*1000
        return {'mode': 'real', 'hr': hr['value'], 'rr': rr['value'], 'hrReason': hr['reason'], 'rrReason': rr['reason'],
                'metrics': {'hr': hr, 'rr': rr}, 'durationMs': acquisition_end-start, 'fps': fps,
                'collectionElapsedMs': job['state'].get('collectionElapsedMs', acquisition_end-start),
                'respirationCapture': job['state'].get('respirationCapture', {}),
                **({'captureIntervals': capture_intervals(samples)} if job['final'] else {}),
                'quality': 'good' if hr['status'] == rr['status'] == 'valid' and not (hr.get('partialWindow') or rr.get('partialWindow')) else 'partial' if valid_hr or valid_rr else 'insufficient',
                'wave': best['wave'] if best else [], 'respWave': self.last_rr_wave,
                'candidates': [{k: v for k, v in c.items() if k not in ('wave', 'signalDiagnostics')} for c in candidates],
                **({'signalDiagnostics': {c['id']: c['signalDiagnostics'] for c in candidates
                                          if 'signalDiagnostics' in c}} if job['final'] else {}),
                'audit': {'scene': scene, 'hr': hr_audit, 'rr': rr_audit},
                'errors': errors, 'capture': capture, 'timing': {'inferenceMs': round(elapsed, 1), 'models': timings,
                    'queueMs': round((started-job['queuedAt'])*1000, 1)},
                'delayed': (time.perf_counter()-job['queuedAt'])*1000 > (5000 if rr_due else 2000)}

    @staticmethod
    def describe_collecting(result, metric, candidates):
        observed = [c for c in candidates if c['metric'] == metric]
        if result['value'] is None and observed and all(
                set(c['rejectionCodes']) & {'duration', 'observedCycles'} for c in observed):
            result.update(status='collecting', reasonCode='more_cycles',
                          reason='반복되는 신호를 더 모으고 있습니다. 충분히 확인되면 초기 추정값을 표시합니다.')

    @staticmethod
    def describe_window(result, start, end):
        window = result.get('window')
        if result['value'] is None or not window:
            return
        # Ignore only the normal < 1/3s alignment tail; expose genuine excluded footage.
        if window['startMs'] > start+1 or window['endMs'] < end-334:
            result['partialWindow'] = True
            seconds = (window['endMs']-window['startMs'])/1000
            result['reason'] = (result['reason']+' ' if result['reason'] else '') + f'영상이 끊긴 부분을 제외하고 연속된 {seconds:.1f}초 구간으로 추정했습니다.'
