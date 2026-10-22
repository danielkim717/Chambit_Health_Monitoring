# 파일 역할: 추론 서버 API와 측정 세션 관리
# 연결과 사용: FastAPI 요청과 WebSocket 프레임을 받아 Pipeline과 문진을 연결하고 결과 ID를 관리합니다.
# 파일 안내: docs/FILE_GUIDE.md
"""Loopback-only FastAPI service; one camera measurement at a time."""
import asyncio
from collections import OrderedDict
from contextlib import asynccontextmanager, suppress
import json
import math
import struct
import time
import uuid

from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from pydantic import BaseModel, ConfigDict, Field

import numpy as np

from .consultation import Interview
from .models import load_models
from .pipeline import Measurement, Pipeline, HR_PREVIEW_MS

class ExpiringStore:
    def __init__(self, ttl=1800, limit=100):
        self.ttl, self.limit, self.data = ttl, limit, OrderedDict()

    def put(self, id, value):
        self.prune()
        self.data[id] = (time.monotonic(), value)
        while len(self.data) > self.limit:
            self.data.popitem(last=False)

    def prune(self):
        now = time.monotonic()
        for key, (created, _) in list(self.data.items()):
            if now-created > self.ttl:
                del self.data[key]

    def get(self, id):
        entry = self.data.get(id)
        if entry is None or time.monotonic()-entry[0] > self.ttl:
            self.data.pop(id, None)
            raise HTTPException(404, '세션이 만료되었습니다. 다시 측정해 주세요.')
        return entry[1]

class StartInterview(BaseModel):
    model_config = ConfigDict(extra='forbid')
    resultId: str = Field(min_length=32, max_length=32)
    provider: str = 'rules'
    consent: bool = False

class AnswerInterview(BaseModel):
    model_config = ConfigDict(extra='forbid')
    consultationId: str = Field(min_length=32, max_length=32)
    questionId: str = Field(max_length=40)
    optionId: str = Field(max_length=40)
    note: str = Field(default='', max_length=500)

def decode_frame(data):
    if len(data) < 4 or len(data) > 60000:
        raise ValueError('Invalid frame packet size')
    size = struct.unpack_from('<I', data)[0]
    if not 1 <= size <= 4096 or len(data) < size+4:
        raise ValueError('Invalid header')
    header = json.loads(data[4:4+size])
    if not isinstance(header, dict):
        raise ValueError('Invalid metadata')
    for name in ('t', 'seq', 'revision'):
        value = header.get(name)
        if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or value < 0:
            raise ValueError('Invalid frame timestamp/sequence')
    if not isinstance(header['seq'], int) or not isinstance(header['revision'], int):
        raise ValueError('Sequence must be integer')
    capture = header.get('capture', {})
    allowed = {'configuredFps', 'cameraFps', 'callbackFps', 'processedFps', 'observedFrames',
               'processedFrames', 'invalidFrames', 'bitmapDropped', 'pendingReplaced',
               'transportDropped', 'extractionMeanMs', 'extractionP95Ms'}
    if not isinstance(capture, dict) or not set(capture).issubset(allowed) or any(
        isinstance(value, bool) or not isinstance(value, (int, float)) or
        not math.isfinite(value) or not 0 <= value <= 1e8 for value in capture.values()):
        raise ValueError('Invalid capture diagnostics')
    rgb = header.get('rgb')
    raw = data[4+size:]
    if rgb is None:
        if raw:
            raise ValueError('Invalid frames must have no pixel payload')
        return header, None
    if len(raw) != 128*128*3 or not isinstance(rgb, list) or len(rgb) != 3 or any(
        isinstance(x, bool) or not isinstance(x, (float, int)) or not math.isfinite(x) or not 0<=x<=255 for x in rgb):
        raise ValueError('Expected 128x128 RGB and three finite ROI means')
    scene = header.get('scene', {})
    if not isinstance(scene, dict) or any(not isinstance(x, (int, float)) or not math.isfinite(x) for x in scene.values()):
        raise ValueError('Invalid scene evidence')
    return header, np.frombuffer(raw, dtype=np.uint8).reshape(128, 128, 3).copy()

def create_app(models=None, pipeline_factory=Pipeline):
    @asynccontextmanager
    async def lifespan(app):
        app.state.models = await asyncio.to_thread(load_models) if models is None else models
        app.state.active = False
        async def expire():
            while True:
                await asyncio.sleep(30)
                results.prune()
                interviews.prune()
        cleanup = asyncio.create_task(expire())
        try:
            yield
        finally:
            cleanup.cancel()
            with suppress(asyncio.CancelledError):
                await cleanup
            results.data.clear()
            interviews.data.clear()

    app = FastAPI(lifespan=lifespan)
    results, interviews = ExpiringStore(), ExpiringStore()
    app.state.results, app.state.interviews = results, interviews

    @app.get('/api/health')
    async def health():
        available = [m.health() for m in app.state.models]
        return {'status': 'ready', 'busy': app.state.active, 'models': available,
                'learnedReady': any(m['ready'] for m in available),
                'allLearnedReady': len(available)==2 and all(m['ready'] for m in available),
                'baselines': ['chrom', 'pos'], 'candidatesOnly': ['BiPulseFormer', 'RhythmFormer', 'FactorizePhys', 'PhysMamba'],
                'privacy': 'ROI frames stay in local process memory; results expire after 30 minutes.'}

    @app.post('/api/measurement/demo')
    async def demo():
        # Explicit synthetic provenance, never accepts client-supplied physiological values.
        result = {'mode': 'demo', 'hr': 72, 'rr': 15, 'quality': 'good', 'durationMs': 60000,
                  'fps': 30, 'hrReason': '가상 데이터', 'rrReason': '가상 데이터'}
        result['resultId'] = uuid.uuid4().hex
        results.put(result['resultId'], result)
        return result

    @app.post('/api/consultation/start')
    async def start_interview(body: StartInterview):
        if body.provider not in ('rules', 'remote', 'local'):
            raise HTTPException(400, '지원하지 않는 문진 방식입니다.')
        if body.provider == 'remote' and not body.consent:
            raise HTTPException(400, '측정 요약과 답변의 외부 전송 동의가 필요합니다.')
        interview = Interview(results.get(body.resultId), body.provider, body.consent)
        interviews.put(interview.id, interview)
        return interview.view()

    @app.post('/api/consultation/answer')
    async def answer_interview(body: AnswerInterview):
        interview = interviews.get(body.consultationId)
        async with interview.lock:
            try:
                interview.answer(body.questionId, body.optionId, body.note)
            except ValueError as exc:
                raise HTTPException(409, str(exc)) from exc
            return await interview.summary() if interview.done else interview.view()

    @app.websocket('/api/measurement')
    async def measurement(ws: WebSocket):
        await ws.accept()
        if app.state.active:
            await ws.send_json({'type': 'error', 'message': '다른 측정이 진행 중입니다.'})
            await ws.close(code=1013)
            return
        app.state.active = True
        session, alive, running, pending = None, True, None, None
        final_submitted = False
        pipeline = pipeline_factory(app.state.models)
        send_lock = asyncio.Lock()
        connected = time.monotonic()

        async def send(message):
            async with send_lock:
                if alive:
                    await ws.send_json(message)

        async def execute(job):
            nonlocal pending
            while job is not None and alive:
                try:
                    result = await asyncio.to_thread(pipeline.run, job)
                    if alive and session and job['revision'] == session.revision and session.phase != 'timeout' and result['durationMs'] >= HR_PREVIEW_MS:
                        if job['final']:
                            result['resultId'] = uuid.uuid4().hex
                            results.put(result['resultId'], result)
                        await send({'type': 'analysis', 'sessionId': session.id, 'revision': job['revision'],
                                    'result': result, 'final': job['final']})
                except Exception as exc:
                    await send({'type': 'error', 'message': f'추론 처리 오류: {type(exc).__name__}'})
                job, pending = pending, None

        def submit(job):
            nonlocal running, pending
            if job is None:
                return
            if running is None or running.done():
                running = asyncio.create_task(execute(job))
            else:
                # There is exactly one pending snapshot. A final job cannot be displaced.
                if pending is None or not pending['final']:
                    pending = job

        try:
            await send({'type': 'connected', 'protocol': 1})
            while alive:
                if time.monotonic()-connected > 150:
                    await send({'type': 'error', 'message': '측정 연결 시간이 초과되었습니다.'})
                    break
                try:
                    message = await asyncio.wait_for(ws.receive(), timeout=1)
                except asyncio.TimeoutError:
                    # A dead camera must not leave the session alive indefinitely.
                    if session and session.clock_skew_ms is not None and session.phase in ('preparing', 'collecting'):
                        now = time.monotonic()*1000-session.clock_skew_ms
                        old = session.revision
                        session.tick(now)
                        if old != session.revision:
                            pending = None
                        await send({'type': 'state', 'sessionId': session.id, 'state': session.state(now)})
                    continue
                if message['type'] == 'websocket.disconnect':
                    break
                if message.get('text') is not None:
                    if len(message['text']) > 4096:
                        raise ValueError('Oversize control message')
                    control = json.loads(message['text'])
                    if control.get('type') == 'start' and session is None:
                        t = control.get('t')
                        if not isinstance(t, (int, float)) or not math.isfinite(t) or t < 0:
                            raise ValueError('Invalid start time')
                        rr_fps = [m.spec.min_fps for m in app.state.models
                                  if m.model is not None and 'rr' in m.spec.metrics]
                        session = Measurement(float(t), rr_min_fps=min(rr_fps) if rr_fps else None)
                        session.clock_skew_ms = time.monotonic()*1000-t
                        await send({'type': 'started', 'sessionId': session.id, 'revision': 0})
                    elif control.get('type') == 'cancel':
                        break
                    else:
                        raise ValueError('Invalid control message')
                    continue
                if session is None:
                    raise ValueError('Start a session before sending frames')
                header, pixels = decode_frame(message.get('bytes') or b'')
                if header.get('sessionId') != session.id:
                    raise ValueError('Wrong measurement session')
                if header['revision'] != session.revision:
                    await send({'type': 'state', 'sessionId': session.id, 'state': session.state(session.last or session.started)})
                    continue
                old = session.revision
                session.transit_ms = max(0, time.monotonic()*1000-session.clock_skew_ms-header['t'])
                session.feed(header, pixels)
                if old != session.revision:
                    pending = None
                state = session.state(header['t'])
                await send({'type': 'state', 'sessionId': session.id, 'state': state})
                if session.phase == 'timeout':
                    await send({'type': 'timeout', 'reason': session.reason})
                    break
                if not final_submitted:
                    final_submitted = session.phase == 'complete'
                    submit(session.job(final=final_submitted))
        except (WebSocketDisconnect, RuntimeError):
            pass
        except (ValueError, KeyError, TypeError, json.JSONDecodeError) as exc:
            await send({'type': 'error', 'message': '잘못된 측정 메시지: '+str(exc)[:150]})
        finally:
            alive, pending = False, None
            if running:
                # A cancelled asyncio task cannot stop a native torch call. Keep the
                # single-device lease until that call finishes; no overlapping runs.
                with suppress(Exception):
                    await running
            if session:
                session.samples.clear()
            app.state.active = False
            with suppress(Exception):
                await ws.close()
    return app

app = create_app()
