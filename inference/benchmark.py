"""Synthetic ROI throughput benchmark. Not physiological accuracy evidence."""
import argparse
import json
from pathlib import Path
import time
import numpy as np
from .models import load_models
from .pipeline import Measurement, Pipeline

def main():
    parser=argparse.ArgumentParser();parser.add_argument('--output',type=Path,default=Path('inference/artifacts/benchmark.json'))
    args=parser.parse_args()
    models=load_models();pipeline=Pipeline(models);session=Measurement(0,prepare_ms=0)
    spatial=np.random.default_rng(12).normal(0,4,(128,128,3))
    records=[];started=time.perf_counter()
    for seq in range(1802):
        t=seq/30
        rgb=np.array([120,100,80])+np.array([.2,1,.1])*3*np.sin(2*np.pi*1.2*t)*(1+.2*np.sin(2*np.pi*.25*t))
        pixels=np.clip(spatial+rgb,0,255).astype(np.uint8)
        session.feed({'t':t*1000,'seq':seq,'rgb':rgb.tolist()},pixels)
        job=session.job(final=session.phase=='complete')
        if job:
            result=pipeline.run(job)
            records.append({'durationMs':result['durationMs'],**result['timing'],'rrDue':job['rrDue']})
        if session.phase=='complete':break
    times=[r['inferenceMs'] for r in records]
    report={'kind':'synthetic ROI throughput only; no camera or accuracy claim',
            'models':[m.health() for m in models],'jobs':records,
            'p50Ms':float(np.percentile(times,50)),'p95Ms':float(np.percentile(times,95)),
            'wallSeconds':time.perf_counter()-started}
    args.output.parent.mkdir(parents=True,exist_ok=True)
    args.output.write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
    print(json.dumps({k:report[k] for k in ['kind','p50Ms','p95Ms','wallSeconds']},indent=2))

if __name__=='__main__':main()
