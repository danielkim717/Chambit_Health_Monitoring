"""Numerical physiology evidence. Scores are engineering SQI, not probabilities."""
import numpy as np
from scipy import signal

BANDS = {'hr': (.7, 3.), 'rr': (.1, .5)}

def bandpass(x, fs, band):
    x = signal.detrend(np.asarray(x, dtype=float))
    return signal.sosfiltfilt(signal.butter(2, band, fs=fs, btype='bandpass', output='sos'), x)

def candidate(model, metric, wave, fs, start, end, family=None, *, include_diagnostics=False):
    base = {'id': f'{model}:{metric}', 'model': model, 'metric': metric,
            'family': family or model, 'startMs': start, 'endMs': end,
            'value': None, 'quality': 0., 'status': 'insufficient', 'reason': '주기성이 부족합니다.',
            'features': {}, 'checks': {}, 'rejectionCodes': [], 'wave': [], 'sampleRate': float(fs)}
    wave = np.asarray(wave, dtype=float)
    minimum_seconds = 20 if metric == 'hr' else 35
    finite = bool(np.isfinite(wave).all())
    base['checks'] = {'duration': {'passed': len(wave) >= fs * minimum_seconds,
                                  'actualSeconds': len(wave)/fs, 'minimumSeconds': minimum_seconds},
                      'finite': {'passed': finite},
                      'variation': {'passed': finite and bool(np.std(wave) >= 1e-8)}}
    base['rejectionCodes'] = [key for key, check in base['checks'].items() if not check['passed']]
    if include_diagnostics:
        base['signalDiagnostics'] = {
            'sampleRate': float(fs), 'startMs': start, 'endMs': end,
            'inputWave': wave.tolist() if finite else [], 'filteredWave': [],
            'filter': {'kind': 'linear_detrend_butterworth_sosfiltfilt', 'order': 2,
                       'bandHz': list(BANDS[metric]), 'trimEachSideSeconds': 2},
            'note': 'Diagnostic signal only; a spectral peak is not an accepted vital sign.'}
    if base['rejectionCodes']:
        return base
    # Discard filter edges; retain the represented acquisition interval in metadata.
    x = bandpass(wave, fs, BANDS[metric])
    trim = int(fs * 2)
    x = x[trim:-trim]
    if include_diagnostics:
        base['signalDiagnostics'].update(filteredWave=x.tolist(),
                                         filteredStartMs=start+trim/fs*1000)
    if np.std(x) < 1e-8:
        base['rejectionCodes'] = ['filtered_variation']
        base['checks']['filtered_variation'] = {'passed': False}
        return base
    f, power = signal.periodogram(x, fs=fs, window='hann', nfft=max(8192, len(x)))
    mask = (f >= BANDS[metric][0]) & (f <= BANDS[metric][1])
    inband = power[mask]
    peak = np.argmax(inband)
    freq = f[mask][peak]
    width = max(.035, 1.5*fs/len(x))
    concentration = float(power[np.abs(f-freq) <= width].sum() / max(power.sum(), 1e-12))
    lag = int(round(fs/freq))
    periodicity = float(np.corrcoef(x[lag:], x[:-lag])[0, 1]) if lag < len(x)//2 else 0.
    if not np.isfinite(periodicity):
        periodicity = 0.
    normalized = inband / max(inband.sum(), 1e-12)
    entropy = float(-np.sum(normalized * np.log(normalized+1e-12)) / np.log(len(normalized)))
    ratio = float(power[mask].sum() / max(power.sum(), 1e-12))
    snr = float(10*np.log10(max(concentration, 1e-6)/max(1-concentration, 1e-6)))
    quality = float(np.clip(.5*concentration + .4*max(0, periodicity) + .1*(1-entropy), 0, 1))
    base.update(features={'concentration': concentration, 'periodicity': periodicity,
                          'spectralEntropy': entropy, 'inBandEnergy': ratio, 'snrDb': snr,
                          'spectralPeakHz': float(freq), 'spectralPeakRate': float(freq*60)},
                quality=quality, wave=x[-int(fs*8)::max(1, int(fs/15))].tolist())
    # The edge of a search band is not evidence that the true rate is in range.
    base['checks'].update({
        'concentration': {'passed': concentration >= .45, 'actual': concentration, 'minimum': .45},
        'periodicity': {'passed': periodicity >= .4, 'actual': periodicity, 'minimum': .4},
        'bandInterior': {'passed': bool(BANDS[metric][0]+.005 < freq < BANDS[metric][1]-.005),
                         'actualHz': float(freq), 'exclusiveMinimumHz': BANDS[metric][0]+.005,
                         'exclusiveMaximumHz': BANDS[metric][1]-.005}})
    base['rejectionCodes'] = [key for key, check in base['checks'].items() if not check['passed']]
    if not base['rejectionCodes']:
        base.update(value=float(freq*60), status='valid', reason='')
    return base

def chrom(rgb, fs):
    c = rgb / np.maximum(rgb.mean(axis=0), 1e-6) - 1
    x = bandpass(3*c[:, 0]-2*c[:, 1], fs, BANDS['hr'])
    y = bandpass(1.5*c[:, 0]+c[:, 1]-1.5*c[:, 2], fs, BANDS['hr'])
    return x - np.std(x)/max(np.std(y), 1e-8)*y

def pos(rgb, fs):
    length = int(1.6*fs)
    out, count = np.zeros(len(rgb)), np.zeros(len(rgb))
    for end in range(length, len(rgb)+1):
        start = end-length
        normalized = rgb[start:end]/np.maximum(rgb[start:end].mean(axis=0), 1e-6)
        s = normalized @ np.array([[0, 1, -1], [-2, 1, 1]]).T
        p = s[:, 0] + np.std(s[:, 0])/max(np.std(s[:, 1]), 1e-8)*s[:, 1]
        out[start:end] += p-p.mean()
        count[start:end] += 1
    return out/np.maximum(count, 1)

def derived_respiration(pulse, fs, start, end):
    hr = candidate('chrom', 'hr', pulse, fs, start, end)
    if hr['value'] is None:
        return None
    peaks, _ = signal.find_peaks(pulse, distance=fs*60/hr['value']*.65, prominence=np.std(pulse)*.2)
    if len(peaks) < 15:
        return None
    intervals, amplitudes = np.diff(peaks)/fs, pulse[peaks[1:]]
    if np.std(intervals)/max(intervals.mean(), 1e-6) < .005 or np.std(amplitudes)/max(abs(amplitudes.mean()), 1e-6) < .015:
        return None
    times = peaks[1:]/fs
    grid = np.arange(times[0], times[-1], .25)
    results = [candidate('chrom_riv', 'rr', np.interp(grid, times, v), 4, start, end, family='chrom')
               for v in [intervals, amplitudes]]
    if any(x['value'] is None for x in results) or abs(results[0]['value']-results[1]['value']) > 3:
        return None
    # One dependent candidate, not two votes.
    result = results[0]
    result['value'] = sum(x['value'] for x in results)/2
    result['quality'] = min(x['quality'] for x in results)
    result['reason'] = '맥파 간격·진폭으로 유도한 보조 호흡 후보'
    return result

def fuse(candidates, metric, proposal=None):
    unit = 'bpm' if metric == 'hr' else 'breaths/min'
    result = {'value': None, 'unit': unit, 'status': 'insufficient', 'reason': '유효한 후보가 없습니다.',
              'quality': None, 'sources': [], 'window': None}
    valid = [c for c in candidates if c['metric'] == metric and c['status'] == 'valid'
             and c['value'] is not None and np.isfinite(c['value'])]
    audit = {'quality': [{'id': c['id'], 'features': c['features']} for c in candidates if c['metric']==metric],
             'debate': [], 'clusters': [], 'action': 'reject', 'selected': []}
    if not valid:
        return result, audit
    # Restrict to one common acquisition interval, never combine different windows.
    latest = max((c['endMs'], c['startMs']) for c in valid)
    valid = [c for c in valid if (c['endMs'], c['startMs']) == latest]
    # Different derivations from one parent waveform provide at most one candidate.
    unique = {}
    for c in valid:
        if c['family'] not in unique or c['quality'] > unique[c['family']]['quality']:
            unique[c['family']] = c
    valid = sorted(unique.values(), key=lambda c: (c['value'], c['id']))
    tolerance = 5 if metric == 'hr' else 3
    clusters = []
    for c in valid:
        if not clusters or c['value']-clusters[-1][0]['value'] > tolerance:
            clusters.append([])
        clusters[-1].append(c)
    ranked = sorted(clusters, key=lambda group: (-max(c['quality'] for c in group), group[0]['id']))
    audit['clusters'] = [[c['id'] for c in g] for g in ranked]
    if metric == 'hr':
        for i, a in enumerate(ranked):
            for b in ranked[i+1:]:
                ratio = max(a[0]['value'], b[0]['value']) / min(a[0]['value'], b[0]['value'])
                if abs(ratio-2) < .1:
                    audit['debate'].append({'kind': 'harmonic', 'candidates': [a[0]['id'], b[0]['id']]})
    selected = ranked[0]
    if len(ranked) > 1:
        audit['debate'].append({'kind': 'disagreement'})
        if max(c['quality'] for c in ranked[0])-max(c['quality'] for c in ranked[1]) < .1:
            result.update(status='conflict', reason='모델 후보가 일치하지 않아 재측정이 필요합니다.')
            return result, audit
    audit['action'] = 'deterministic'
    if proposal is not None:
        # Proposed numbers/weights cannot bypass the deterministic winner or SQI.
        ids = proposal.get('selected') if isinstance(proposal, dict) else None
        expected = {c['id'] for c in selected}
        executable = isinstance(ids, list) and all(isinstance(x, str) for x in ids)
        executable = executable and len(ids)==len(set(ids)) and set(ids)==expected
        audit['action'] = 'accept' if executable else 'repair'
    weights = np.array([max(c['quality'], .01) for c in selected])
    result.update(value=float(np.average([c['value'] for c in selected], weights=weights)),
                  status='valid', reason='', quality=float(weights.max()),
                  sources=[c['model'] for c in selected],
                  window={'startMs': latest[1], 'endMs': latest[0]})
    audit['selected'] = [c['id'] for c in selected]
    return result, audit
