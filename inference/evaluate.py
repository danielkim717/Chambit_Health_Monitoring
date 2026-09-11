"""Evaluate synchronized attempts, including failed attempts in coverage.

CSV columns: participant,attempt,condition,reference_hr,hr,reference_rr,rr
Blank estimates are failures, never excluded from the coverage denominator.
"""
import argparse
import csv
import json
import math
from pathlib import Path
import numpy as np

def evaluate(rows):
    report={'attempts':len(rows),'participants':len({r['participant'] for r in rows})}
    for metric,target in [('hr',5),('rr',3)]:
        paired=[]
        valid=0
        for row in rows:
            value=row.get(metric,'')
            reference=row.get('reference_'+metric,'')
            if value!='' and math.isfinite(float(value)):
                valid+=1
                if reference!='' and math.isfinite(float(reference)):
                    paired.append((float(reference),float(value)))
        errors=np.array([a-b for a,b in paired])
        coverage=valid/len(rows) if rows else 0
        report[metric]={'valid':valid,'paired':len(paired),'coverage':coverage,
                       'rejectionRate':1-coverage if rows else None,
                       'mae':float(np.mean(abs(errors))) if len(errors) else None,
                       'rmse':float(np.sqrt(np.mean(errors**2))) if len(errors) else None,
                       'developmentTarget':target,
                       'targetMet':bool(len(errors) and np.mean(abs(errors))<=target and coverage>=.8)}
    return report

def main():
    parser=argparse.ArgumentParser();parser.add_argument('csv',type=Path)
    args=parser.parse_args()
    with args.csv.open(encoding='utf-8-sig',newline='') as file:rows=list(csv.DictReader(file))
    print(json.dumps(evaluate(rows),ensure_ascii=False,indent=2))

if __name__=='__main__':main()
