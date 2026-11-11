"""Recompute from supplied preliminary parquet data, never scale severities as weights."""
import sys,json,math,copy,os
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/"var/model-python-packages"))
import pandas as pd
from scoring_source.scoring import enhanced,evidence_score
root=Path(__file__).resolve().parents[1]
enhanced.ROOT=Path(os.environ.get('SCORING_DATA_ROOT',str(root/'scoring-data')))
request=json.load(sys.stdin);config=request['config']
frozen=json.loads((root/'scripts/scoring_source/scoring_frozen.json').read_text(encoding='utf-8'))
for d,r in config['reference'].items():
 frozen['reference'][d]['tau']=r['tau'];frozen['reference'][d]['mu']=r['mu']
 frozen['reference'][d]['rates']=[v*r['rate_scale'] for v in frozen['reference'][d]['rates']]
source=enhanced.ScoreSource(config['window_days'],config['half_life_days'])
source.exposure_units=config.get('exposure_units')
source.rules=source.rules[source.rules.event_type.isin([f['code'] for f in config['factors']])].copy()
for f in config['factors']:
 mask=source.rules.event_type.eq(f['code'])
 for key,value in [('event_name',f['name']),('dimension',f['dimension']),('severity',f['severity']),('half_life_days',config['half_life_days'])]:source.rules.loc[mask,key]=value
history=[];final=None
for date in request['dates']:
 frame=evidence_score.score_at(source,date,frozen)
 history+=frame.to_dict('records');final=frame
ledger=evidence_score.event_ledger(final,request['dates'][-1],source).to_dict('records')
def clean(v):
 if isinstance(v,dict):return {str(k):clean(x) for k,x in v.items()}
 if isinstance(v,list):return [clean(x) for x in v]
 if isinstance(v,(pd.Timestamp,)):return v.isoformat()
 if hasattr(v,'item'):v=v.item()
 if isinstance(v,float) and not math.isfinite(v):return None
 return v
print(json.dumps(clean(dict(history=history,ledger=ledger)),ensure_ascii=False,allow_nan=False))
