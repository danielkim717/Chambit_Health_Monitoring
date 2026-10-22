// 파일 역할: 브라우저 신호 분석 보조 함수
// 연결과 사용: 보간·CHROM·필터·주기 후보 계산과 합성 신호 테스트에 사용합니다. 현재 최종값의 주 경로는 Python 서버입니다.
// 파일 안내: docs/FILE_GUIDE.md
import { CONFIG } from './measurement-config.mjs';

const mean = a => a.reduce((s, x) => s + x, 0) / a.length;
const sd = a => { const m = mean(a); return Math.sqrt(mean(a.map(x => (x - m) ** 2))); };
const median = a => { const s = [...a].sort((x,y) => x-y); return s[Math.floor(s.length / 2)]; };
function detrend(a) {
  const m = mean(a), mid = (a.length - 1) / 2;
  let num = 0, den = 0;
  for (let i = 0; i < a.length; i++) { num += (i-mid) * (a[i]-m); den += (i-mid)**2; }
  return a.map((x,i) => x - m - (den ? num/den : 0) * (i-mid));
}
export function interpolate(times, values, grid) {
  let j = 0;
  return grid.map(t => {
    while (j < times.length-2 && times[j+1] < t) j++;
    const f = Math.max(0, Math.min(1, (t-times[j]) / (times[j+1]-times[j])));
    return values[j] + f * (values[j+1]-values[j]);
  });
}
function biquad(a, fs, cutoff, highpass) {
  const w = 2 * Math.PI * cutoff / fs, c = Math.cos(w), alpha = Math.sin(w) / Math.SQRT2;
  const a0 = 1+alpha, a1 = -2*c/a0, a2 = (1-alpha)/a0;
  const b0 = (highpass ? 1+c : 1-c)/2/a0, b1 = (highpass ? -(1+c) : 1-c)/a0;
  let x1=0, x2=0, y1=0, y2=0;
  return a.map(x => { const y=b0*x+b1*x1+b0*x2-a1*y1-a2*y2; x2=x1; x1=x; y2=y1; y1=y; return y; });
}
export function bandpass(a, fs, low, high) {
  // Reflected padding and forward/backward Butterworth sections avoid phase shifts.
  const n = Math.min(a.length-1, Math.ceil(fs * 3));
  let padded = [...a.slice(1,n+1).reverse().map(x=>2*a[0]-x), ...a, ...a.slice(-n-1,-1).reverse().map(x=>2*a.at(-1)-x)];
  for (let pass=0; pass<2; pass++) padded = biquad(biquad(padded,fs,low,true),fs,high,false).reverse();
  return padded.slice(n,n+a.length);
}
export function chrom(rgb, fs) {
  // CHROM's two chrominance projections, normalized per analysis window.
  const channels = [0,1,2].map(c => { const v=rgb.map(r=>r[c]); const m=mean(v); return v.map(x=>x/m-1); });
  const x=channels[0].map((r,i)=>3*r-2*channels[1][i]);
  const y=channels[0].map((r,i)=>1.5*r+channels[1][i]-1.5*channels[2][i]);
  const xf=bandpass(detrend(x),fs,...CONFIG.heartBand), yf=bandpass(detrend(y),fs,...CONFIG.heartBand);
  const alpha=sd(xf)/Math.max(sd(yf),1e-12);
  return xf.map((v,i)=>v-alpha*yf[i]);
}
function spectrum(a, fs, low, high, step=0.005) {
  const values=detrend(a).map((x,i)=>x*(0.5-0.5*Math.cos(2*Math.PI*i/(a.length-1))));
  const out=[];
  for(let f=low; f<=high+step/2; f+=step) {
    const coefficient=2*Math.cos(2*Math.PI*f/fs);
    let s1=0,s2=0;
    for(const x of values){const s=x+coefficient*s1-s2;s2=s1;s1=s;}
    out.push({f,p:Math.max(0,s1*s1+s2*s2-coefficient*s1*s2)});
  }
  return out;
}
function periodicRate(a, fs, band) {
  if (a.length < fs*10 || sd(a)<1e-8) return null;
  const powers=spectrum(a,fs,Math.max(0.04,band[0]-0.1),Math.min(fs*0.49,band[1]+0.15));
  const peak=powers.reduce((p,x)=>x.p>p.p?x:p);
  if (peak.f<band[0]-0.003 || peak.f>band[1]+0.003) return null;
  const width=Math.max(0.035,1.5*fs/a.length);
  const concentration=powers.filter(x=>Math.abs(x.f-peak.f)<=width).reduce((s,x)=>s+x.p,0)/powers.reduce((s,x)=>s+x.p,0);
  const centered=detrend(a), lag=Math.round(fs/peak.f);
  let cross=0,p1=0,p2=0;
  for(let i=lag;i<centered.length;i++){cross+=centered[i]*centered[i-lag];p1+=centered[i]**2;p2+=centered[i-lag]**2;}
  const correlation=cross/Math.sqrt(p1*p2);
  return concentration>=0.45 && correlation>=0.4 ? {value:peak.f*60,concentration,correlation} : null;
}
export function analyzePulse(pulse, fs) {
  const trim=Math.ceil(fs*2), p=pulse.slice(trim,-trim);
  const hr=periodicRate(p,fs,CONFIG.heartBand);
  const output={hr:hr?.value ?? null, rr:null, hrReason:hr?'':'심박 주기성이 부족합니다.', rrReason:'호흡 변동 신호가 부족합니다.'};
  if (!hr) return output;
  const minDistance=fs*60/hr.value*0.65, peaks=[];
  for(let i=1;i<p.length-1;i++) {
    if(p[i]>0 && p[i]>p[i-1] && p[i]>=p[i+1]) {
      if(peaks.length && i-peaks.at(-1)<minDistance){if(p[i]>p[peaks.at(-1)]) peaks[peaks.length-1]=i;}
      else peaks.push(i);
    }
  }
  if(peaks.length<12) return output;
  const times=peaks.map(i=>(i+Math.max(-0.5,Math.min(0.5,0.5*(p[i-1]-p[i+1])/(p[i-1]-2*p[i]+p[i+1]))))/fs);
  const intervals=[], amplitudes=[], rivTimes=[];
  for(let k=1;k<peaks.length;k++) {
    const dt=times[k]-times[k-1];
    const trough=Math.min(...p.slice(peaks[k-1],peaks[k]+1));
    intervals.push(dt); amplitudes.push((p[peaks[k-1]]+p[peaks[k]])/2-trough);
    rivTimes.push((times[k]+times[k-1])/2);
  }
  const typical=median(intervals);
  if(intervals.some(v=>v<typical*0.65 || v>typical*1.5)) {output.rrReason='박동 검출이 불안정합니다.';return output;}
  // Flat amplitudes/intervals are not evidence of respiration.
  if(sd(amplitudes)/mean(amplitudes)<0.015 || sd(intervals)/mean(intervals)<0.005) return output;
  const rivFs=4, grid=[];
  for(let t=rivTimes[0];t<=rivTimes.at(-1);t+=1/rivFs)grid.push(t);
  if(grid.length/rivFs<20) return output;
  const rates=[amplitudes,intervals].map(v=> {
    const r=interpolate(rivTimes,v,grid);
    return periodicRate(bandpass(detrend(r),rivFs,0.07,0.65).slice(8,-8),rivFs,CONFIG.respirationBand);
  });
  if(rates.some(r=>!r)){output.rrReason='호흡 신호의 주기성이 부족합니다.';return output;}
  if(Math.abs(rates[0].value-rates[1].value)>CONFIG.respirationAgreement){output.rrReason='진폭·박동 간격의 호흡 추정이 일치하지 않습니다.';return output;}
  output.rr=(rates[0].value+rates[1].value)/2;output.rrReason='';
  return output;
}
export function analyzeSamples(samples, mode='real', minimumMs=20000) {
  const durationMs=samples.length>1?samples.at(-1).t-samples[0].t:0;
  const fps=durationMs>0?(samples.length-1)*1000/durationMs:0;
  const failed=reason=>({mode,hr:null,rr:null,hrReason:reason,rrReason:reason,quality:'insufficient',durationMs,fps,wave:[]});
  if(durationMs<minimumMs-1)return failed('분석에 필요한 수집 시간이 부족합니다.');
  if(fps<CONFIG.minFps)return failed('영상 처리 속도가 15fps 미만입니다.');
  if(samples.some((s,i)=>!Number.isFinite(s.t)||!s.rgb?.every(Number.isFinite)||(i && (s.t<=samples[i-1].t || s.t-samples[i-1].t>=CONFIG.maxGapMs))))return failed('영상 시각 또는 연속성이 올바르지 않습니다.');
  if([0,1,2].some(c=>sd(samples.map(s=>s.rgb[c]))<1e-6))return failed('색상 변화 신호가 없습니다.');
  const fs=Math.min(CONFIG.targetFps,fps), times=samples.map(s=>(s.t-samples[0].t)/1000);
  const grid=Array.from({length:Math.floor(durationMs/1000*fs)+1},(_,i)=>i/fs);
  const channels=[0,1,2].map(c=>interpolate(times,samples.map(s=>s.rgb[c]),grid));
  const pulse=chrom(grid.map((_,i)=>channels.map(c=>c[i])),fs);
  const result=analyzePulse(pulse,fs);
  const wave=pulse.slice(-Math.round(fs*8),-Math.round(fs));
  return {mode,...result,quality:result.hr===null?'insufficient':result.rr===null?'partial':'good',durationMs,fps,wave};
}
