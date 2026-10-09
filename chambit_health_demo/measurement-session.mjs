// 파일 역할: 브라우저 측정 상태 전환
// 연결과 사용: 준비·수집·시간 초과 등 시각 기반 상태를 관리합니다. 최종 측정 결과는 서버 응답을 따릅니다.
// 파일 안내: docs/FILE_GUIDE.md
import { CONFIG } from './measurement-config.mjs';

// A deterministic state machine; all times are monotonic milliseconds.
export class MeasurementSession {
  constructor(startedAt, config = CONFIG) {
    this.config = config;
    this.startedAt = startedAt;
    this.phase = 'preparing';
    this.samples = [];
    this.stableAt = null;
    this.lastGoodAt = null;
    this.lastFrameAt = null;
    this.invalidAt = null;
    this.collectionAt = null;
    this.reason = '얼굴을 정면으로 맞추고 조명을 확인해 주세요.';
    this.revision = 0;
  }
  reset(reason) {
    this.phase = 'preparing';
    this.samples = [];
    this.stableAt = this.collectionAt = this.lastGoodAt = null;
    this.reason = reason;
    this.revision++;
  }
  tick(now) {
    if (!['preparing', 'collecting'].includes(this.phase)) return this.snapshot(now);
    if (now - this.startedAt >= this.config.maxAttemptMs) {
      this.phase = 'timeout';
      this.samples = [];
      this.reason = '120초 내에 연속 측정을 완료하지 못했습니다. 조명과 자세를 확인하고 다시 측정해 주세요.';
    } else if (this.lastGoodAt !== null && now - this.lastGoodAt >= this.config.maxGapMs) {
      this.reset(this.invalidAt !== null ? this.reason : '영상 수신이 끊겨 준비부터 다시 시작합니다.');
    }
    return this.snapshot(now);
  }
  feed(sample) {
    const { t, rgb, reason } = sample;
    if (!Number.isFinite(t) || (this.lastFrameAt !== null && t <= this.lastFrameAt)) return this.snapshot(t);
    this.tick(t);
    if (!['preparing', 'collecting'].includes(this.phase)) return this.snapshot(t);
    this.lastFrameAt = t;
    if (!rgb || rgb.length !== 3 || !rgb.every(Number.isFinite)) {
      this.invalidAt ??= t;
      this.reason = reason || '얼굴과 촬영 조건을 확인해 주세요.';
      if (this.phase === 'preparing') this.stableAt = null;
      if (t - this.invalidAt >= this.config.maxGapMs) this.reset(this.reason);
      return this.snapshot(t);
    }
    if (this.invalidAt !== null && t - this.invalidAt >= this.config.maxGapMs) this.reset(this.reason);
    this.invalidAt = null;
    this.lastGoodAt = t;
    this.stableAt ??= t;
    if (this.phase === 'preparing' && t - this.stableAt >= this.config.prepareMs) {
      this.phase = 'collecting';
      this.collectionAt = t;
    }
    if (this.phase === 'collecting') {
      this.samples.push({ t, rgb });
      if (t - this.collectionAt >= this.config.collectMs) this.phase = 'complete';
    }
    this.reason = this.phase === 'preparing' ? '얼굴을 움직이지 말고 편안하게 호흡해 주세요.' : '말하거나 움직이지 말고 자연스럽게 호흡해 주세요.';
    return this.snapshot(t);
  }
  cancel() { this.phase = 'cancelled'; this.samples = []; this.revision++; }
  snapshot(now) {
    const collectedMs = this.collectionAt === null || this.lastGoodAt === null ? 0 : Math.min(this.config.collectMs, this.lastGoodAt - this.collectionAt);
    return {
      phase: this.phase, reason: this.reason, revision: this.revision,
      preparedMs: this.stableAt === null ? 0 : Math.min(this.config.prepareMs, Math.max(0, (this.lastGoodAt ?? now) - this.stableAt)),
      collectedMs, elapsedMs: Math.max(0, now - this.startedAt),
      fps: collectedMs > 0 ? (this.samples.length - 1) * 1000 / collectedMs : 0,
    };
  }
}
