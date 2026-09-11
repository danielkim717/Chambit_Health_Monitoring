"""Offline real-model video benchmark. Not a camera or accuracy substitute.

The CLI uses OpenCV Haar for crop acquisition; browser uses MediaPipe landmarks.
It never saves input video. Pass --output explicitly to retain numerical evidence.
"""
import argparse
import json
from pathlib import Path
import time
import cv2
from .models import load_models
from .pipeline import Measurement, Pipeline

def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('video',type=Path)
    parser.add_argument('--output',type=Path)
    args=parser.parse_args()
    cap=cv2.VideoCapture(str(args.video));fps=cap.get(cv2.CAP_PROP_FPS)
    if not cap.isOpened() or fps<=0:raise RuntimeError('Cannot open timestamped video')
    detector=cv2.CascadeClassifier(cv2.data.haarcascades+'haarcascade_frontalface_default.xml')
    session=Measurement(0);pipeline=Pipeline(load_models());results=[];seq=0
    while True:
        ok,frame=cap.read()
        if not ok:break
        t=seq*1000/fps
        faces=detector.detectMultiScale(cv2.cvtColor(frame,cv2.COLOR_BGR2GRAY),1.1,5)
        rgb,pixels=None,None
        if len(faces)==1:
            x,y,w,h=map(int,faces[0])
            skin=frame[y+int(.2*h):y+int(.8*h),x+int(.2*w):x+int(.8*w)]
            rgb=cv2.cvtColor(skin,cv2.COLOR_BGR2RGB).mean(axis=(0,1)).tolist()
            side=min(int(max(w,h)*1.5),frame.shape[0],frame.shape[1])
            x=max(0,min(frame.shape[1]-side,x+w//2-side//2));y=max(0,min(frame.shape[0]-side,y+h//2-side//2))
            pixels=cv2.cvtColor(cv2.resize(frame[y:y+side,x:x+side],(128,128)),cv2.COLOR_BGR2RGB)
        session.feed({'t':t,'seq':seq,'rgb':rgb},pixels);seq+=1
        job=session.job(final=session.phase=='complete')
        if job:
            result=pipeline.run(job)
            if result['durationMs']>=30000:
                results.append(result)
                print(json.dumps({k:result[k] for k in ['durationMs','hr','rr','quality','timing']},ensure_ascii=False),flush=True)
        if session.phase in ('complete','timeout'):break
    cap.release()
    report={'source':str(args.video),'sourceFps':fps,'framesRead':seq,'phase':session.phase,
            'captureAdapter':'OpenCV Haar (not browser MediaPipe)','results':results}
    if args.output:
        args.output.parent.mkdir(parents=True,exist_ok=True)
        args.output.write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
    if session.phase!='complete':print('No complete 60-second segment; this is not a successful measurement.')

if __name__=='__main__':main()
