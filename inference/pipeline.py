"""Per-measurement state and a bounded, incremental inference pipeline."""
from collections import deque
from dataclasses import dataclass, field
import time
import uuid

import cv2
import numpy as np

from .signals import candidate, chrom, pos, derived_respiration, fuse
from .feedback import explain_failure

HR_PREVIEW_MS = 20000
RR_PREVIEW_MS = 35000

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

    def reset(self, reason):
        self.revision += 1
        self.phase = 'preparing'
        self.samples.clear()
        self.stable = self.collection = self.good = None
        self.last_hr = self.last_rr = 0
        self.capture = {}
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
            if t-self.collection >= self.collect_ms:
                self.phase = 'complete'
        self.reason = '편안하게 정면을 바라보며 자연스럽게 호흡해 주세요.'
        return True

    def state(self, now):
        good = self.good if self.good is not None else 0
        collection = self.collection if self.collection is not None else good
        stable = self.stable if self.stable is not None else good
        duration = max(0, good-collection)
        fps = (len(self.samples)-1)*1000/duration if duration > 0 else 0
        return {'phase': self.phase, 'revision': self.revision, 'reason': self.reason,
                'preparedMs': min(self.prepare_ms, max(0, good-stable)),
                'collectedMs': min(duration, self.collect_ms), 'elapsedMs': max(0, now-self.started),
                'fps': fps, 'requestedFps': 30, 'receivedFrames': self.received,
                'droppedFrames': self.dropped, 'transportDelayMs': round(self.transit_ms, 1),
                'capture': dict(self.capture)}

    def job(self, final=False):
        if len(self.samples) < 2:
            return None
        duration = self.samples[-1][0]-self.samples[0][0]
        # Fill the incremental model cache before the first visible 20-second result.
        hr = duration >= 6000 and duration-self.last_hr >= 2000
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
        self.cache = {}
        self.generation = None
        self.last_rr = None
        self.last_rr_end = None
        self.last_rr_wave = []

    def run(self, job):
        started = time.perf_counter()
        generation = (job['sessionId'], job['revision'])
        if generation != self.generation:
            self.cache.clear()
            self.last_rr = None
            self.last_rr_end = None
            self.last_rr_wave = []
            self.generation = generation
        samples = job['samples']
        times = np.array([s[0] for s in samples], dtype=float)
        start, end = float(times[0]), float(times[-1])
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
                candidates.append(candidate(name, 'hr', wave, fs, start, end))
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
            if adapter.model is None:
                errors.append({'model': spec.id, 'code': 'model_unavailable', 'message': adapter.error})
                continue
            if not timing_ok or fps < spec.min_fps or max_gap > 100:
                code = 'low_fps' if fps < spec.min_fps else 'frame_gap' if max_gap > 100 else 'weak_signal'
                errors.append({'model': spec.id, 'code': code, 'fps': fps, 'maxGapMs': max_gap,
                               'requiredFps': spec.min_fps, 'allowedGapMs': 100,
                               'message': '학습 모델의 입력 속도, 연속성 또는 영상 변화량 조건을 충족하지 못했습니다.'})
                continue
            model_start = time.perf_counter()
            try:
                grid = np.arange(start, end+.001, 1000/spec.fps)
                index = np.searchsorted(times, grid, side='right').clip(1, len(times)-1)
                weight = ((grid-times[index-1])/(times[index]-times[index-1])).astype(np.float32)
                count = (len(grid)-1)//10*10
                pieces = {metric: [] for metric in spec.metrics}
                for offset in range(0, count, spec.chunk_frames):
                    n = min(spec.chunk_frames, count-offset)
                    key = (spec.id, start, offset)
                    output = self.cache.get(key)
                    if output is None:
                        indices, mix = index[offset:offset+n+1], weight[offset:offset+n+1, None, None, None]
                        # Completed chunks already have cached outputs. Resize only
                        # the real source frames needed for this new/tail chunk.
                        needed = np.unique(np.concatenate((indices-1, indices)))
                        reduced = np.stack([cv2.resize(samples[i][1], (spec.size, spec.size),
                                                      interpolation=cv2.INTER_AREA) for i in needed])
                        before = reduced[np.searchsorted(needed, indices-1)].astype(np.float32)
                        after = reduced[np.searchsorted(needed, indices)].astype(np.float32)
                        frames = before*(1-mix)+after*mix
                        output = adapter.predict(frames)
                        if n == spec.chunk_frames:
                            self.cache[key] = output
                    for metric in spec.metrics:
                        pieces[metric].append(output[metric])
                for metric, segments in pieces.items():
                    if not segments or (metric == 'rr' and not rr_due):
                        continue
                    # Reconstruct differences once over a contiguous output sequence.
                    # Never concatenate independently bandpassed/cumulative waveforms.
                    wave = np.cumsum(np.concatenate(segments))
                    candidates.append(candidate(spec.id, metric, wave, spec.fps, start, end))
                timings[spec.id] = round((time.perf_counter()-model_start)*1000, 1)
            except Exception as exc:
                errors.append({'model': spec.id, 'code': 'analysis_error', 'message': f'{type(exc).__name__}: {exc}'})
        hr, hr_audit = fuse(candidates, 'hr')
        capture = job['state'].get('capture', {})
        explain_failure('hr', hr, candidates, errors, self.models, capture)
        if rr_due:
            rr, rr_audit = fuse(candidates, 'rr')
            explain_failure('rr', rr, candidates, errors, self.models, capture)
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
                'quality': 'good' if valid_hr and valid_rr else 'partial' if valid_hr or valid_rr else 'insufficient',
                'wave': best['wave'] if best else [], 'respWave': self.last_rr_wave,
                'candidates': [{k: v for k, v in c.items() if k != 'wave'} for c in candidates],
                'audit': {'scene': scene, 'hr': hr_audit, 'rr': rr_audit},
                'errors': errors, 'capture': capture, 'timing': {'inferenceMs': round(elapsed, 1), 'models': timings,
                    'queueMs': round((started-job['queuedAt'])*1000, 1)},
                'delayed': (time.perf_counter()-job['queuedAt'])*1000 > (5000 if rr_due else 2000)}
