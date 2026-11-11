"""Run from repository root: python -m src.features.pipeline"""
import argparse
import csv
from datetime import datetime
import json
import os
from pathlib import Path
import time
from .runtime import ROOT, duckdb, quote, write_json, write_csv, write_parquet, digest
from .feature_contract import Registry, META_TYPES, VERSION, SEED
from .window_definitions import training_windows, splits
from .build_risk_daily import build_risk_daily, short_warning_counts
from .build_labels import build_labels
from .build_window_features import Sources, build_window_features
from .build_full_features import build_full_features
from .validate_features import INPUTS, validate_inputs, validate_outputs
from .fold_transforms import FoldFeatureSelector

def log(msg):
    print(f'[{datetime.now():%H:%M:%S}] {msg}',flush=True)

def run(cleaned, output, overwrite=False):
    start=time.time()
    output=output.resolve()
    allowed=(ROOT/'outputs'/'features').resolve()
    if output!=allowed and allowed not in output.parents:
        raise ValueError('Output must be inside outputs/features (A-owned area)')
    output.mkdir(parents=True,exist_ok=True)
    if (output/'feature_quality.json').exists() and not overwrite:
        raise FileExistsError('Completed output exists. Use --overwrite for an intentional reproducible rebuild.')
    run_id=datetime.now().strftime('%Y%m%d_%H%M%S')
    run_dir=ROOT/'runs'/'member_a'/run_id
    run_dir.mkdir(parents=True)
    stage=output/('_staging_'+run_id)
    stage.mkdir()
    con=duckdb.connect()
    con.execute("SET memory_limit='2GB'")
    con.execute('SET threads=2')
    log('Check cleaned inputs and fingerprint read-only sources')
    fingerprints={name:digest(cleaned/name) for name in INPUTS}
    input_report=validate_inputs(con,cleaned)
    windows=training_windows()
    split_rows=splits(windows)
    config=dict(version=VERSION,seed=SEED,cleaned_dir=str(cleaned),output_dir=str(output),
                windows=[w.metadata() for w in windows],inputs_sha256=fingerprints,
                duckdb_version=duckdb.__version__,core_limit=100,correlation_limit=.995,
                source_code_sha256={p.name:digest(p) for p in sorted(Path(__file__).parent.glob('*.py'))})
    write_json(run_dir/'run_config.json',config)
    log('Build dense risk-event daily table')
    build_risk_daily(con,stage/'risk_event_daily.parquet')
    sources=Sources(con)
    registry=Registry()
    train=[]
    label_summaries=[]
    for i,w in enumerate(windows,1):
        log(f'Build {i}/{len(windows)}: {w.id}')
        rows=build_window_features(sources,w,registry,short_warning_counts(con,w))
        labels=build_labels(con,w)
        for row in rows:
            row.update(labels[row['gpsno']])
        train.extend(rows)
        positive=sum(r['label'] for r in rows)
        label_summaries.append(dict(**w.metadata(),rows=len(rows),positive=positive,
                                    negative=len(rows)-positive,positive_rate=positive/len(rows),
                                    accident_positive=sum(r['accident_label'] for r in rows),
                                    near_miss_positive=sum(r['near_miss_label'] for r in rows)))
    log('Build final 61-day candidate features, including aligned last-14-day columns')
    full=build_full_features(con,sources,registry)
    fit_ids={r['window_id'] for r in split_rows if r['phase']=='model_selection' and r['split_role']=='train'}
    fit_rows=[r for r in train if r['window_id'] in fit_ids]
    groups=('exposure','quality','trajectory','event_group','event_type','clustering','imu','recent','trend')
    grouped={g:[n for n,d in registry.entries.items() if d['recommended_candidate'] and d['eligibility']=='candidate' and d['feature_group']==g] for g in groups}
    # Round-robin is fixed before looking at values or labels. This prevents
    # a 100-column cap from excluding later feature families such as trends.
    candidates=[grouped[g][i] for i in range(max(map(len,grouped.values()))) for g in groups if i<len(grouped[g])]
    selector=FoldFeatureSelector().fit(fit_rows,candidates)
    for name in candidates:
        registry.entries[name]['enabled_v1']=name in selector.columns
        registry.entries[name]['selection_reason']=selector.reasons[name]
    core=selector.columns
    assert core and len(core)<=100
    log(f'Core feature selection from first training window only: {len(core)} of {len(candidates)}')
    quality=validate_outputs(con,train,full,registry,core,windows,split_rows,sources.profiles)
    # Real-data prefix invariance: remove all future source-day records and recompute.
    from copy import copy
    prefix=copy(sources)
    w=next(w for w in windows if w.id in fit_ids)
    prefix.daily={table:{g:{d:r for d,r in days.items() if d<=w.end} for g,days in groups.items()}
                  for table,groups in sources.daily.items()}
    repeated=build_window_features(prefix,w,Registry(),short_warning_counts(con,w))
    initial={r['gpsno']:r for r in fit_rows}
    assert all(all(r[name]==initial[r['gpsno']][name] for name in registry.entries) for r in repeated)
    quality['checks']['real_data_prefix_invariance']=True
    # Same fixed14 definition at different enclosing history lengths.
    from .window_definitions import Window, END, DAY
    aligned=build_window_features(sources,Window(END-13*DAY,END,0,'aligned_probe'),Registry())
    full_by_id={r['gpsno']:r for r in full}
    assert all(all(r[name]==full_by_id[r['gpsno']][name] for name in core) for r in aligned)
    quality['checks']['final14_matches_independent14_window']=True
    quality['inputs']=input_report
    quality['core_feature_groups']={g:sum(registry.entries[n]['feature_group']==g for n in core) for g in groups}
    quality['core_training_window_ids']=sorted(fit_ids)
    quality['warnings']=[
        'Main 21->40 sample is diagnostic; no earlier complete 14+14 training sample exists by June 21.',
        '14-day probability is not a calibrated 40-day probability; B must document horizon transfer.',
        'Profile summary ends July 31; excluded from early backtests to prevent future leakage.',
        'IMU daily means/stds are equal-weight summaries across observed days; valid per-axis sample counts unavailable.',
        'Absence of recorded risk events defines the provided label, not verified accident-free surveillance.',
        'Calendar gaps do not imply stopped driving; no missing trajectory or IMU values filled with zero.',
        'Candidate audit columns may be constant/all-null in individual windows. Use core_model_features.json for modelling.',
        'Rolling rows share vehicles and some labels; never randomly split or interpret them as independent vehicles.',
    ]
    types={**META_TYPES,**{n:d['dtype'] for n,d in registry.entries.items()}}
    train_types={**types,'label':'INTEGER','accident_label':'INTEGER','near_miss_label':'INTEGER'}
    log('Write candidate Parquet tables, strict core model matrices and documentation')
    write_parquet(con,stage/'train_windows.parquet',train,train_types)
    write_parquet(con,stage/'full_61d_features.parquet',full,types)
    core_types={**META_TYPES,**{n:types[n] for n in core}}
    def project(rows,names):
        return [{n:r[n] for n in names} for r in rows]
    write_parquet(con,stage/'train_model_core.parquet',project(train,{**core_types,'label':'INTEGER'}),{**core_types,'label':'INTEGER'})
    write_parquet(con,stage/'forecast_model_core.parquet',project(full,core_types),core_types)
    write_csv(stage/'feature_dictionary.csv',list(registry.entries.values()))
    write_csv(stage/'split_manifest.csv',split_rows)
    write_json(stage/'core_model_features.json',dict(version=VERSION,columns=core,fit_window_ids=sorted(fit_ids),
               excluded_columns=selector.reasons,forbidden='gpsno, all date/window metadata, all label columns',
               missing_policy='Keep NULL. Imputer/scaler/shrinkage must fit inside each B training fold.'))
    main=next(r for r in label_summaries if r['window_role']=='main_40d')
    assert main['positive']==55,'Main label differs from QA-corrected independent count'
    write_json(stage/'label_report.json',dict(windows=label_summaries,main_positive_check=main['positive'],
               definition='count(11803)>=1 OR count(11804)>=2; QA 2026-09-23; half-open timestamps',
               local_test='2026-07-18..2026-07-31; feature cutoff 2026-07-17',
               validation='2026-07-01..2026-07-14; feature cutoff 2026-06-30',
               final_forecast='2026-08-01..2026-09-09 (40 days); labels unavailable',
               main_40d_limitation=quality['warnings'][0]))
    # Verify exported types/keys and NULL preservation using the re-read artifacts.
    for filename,expected in [('train_windows.parquet',len(train)),('full_61d_features.parquet',len(full)),
                              ('train_model_core.parquet',len(train)),('forecast_model_core.parquet',len(full))]:
        assert con.execute(f'SELECT count(*) FROM read_parquet({quote(stage/filename)})').fetchone()[0]==expected
        columns=[d[0] for d in con.execute(f'SELECT * FROM read_parquet({quote(stage/filename)}) LIMIT 0').description]
        assert all(c in columns for c in core)
    after={name:digest(cleaned/name) for name in INPUTS}
    assert after==fingerprints,'Cleaned input changed during run'
    quality['checks']['cleaned_inputs_sha256_unchanged']=True
    quality['checks']['exported_parquet_readback']=True
    quality['elapsed_seconds']=round(time.time()-start,2)
    quality['output_files']={p.name:p.stat().st_size for p in stage.iterdir() if p.is_file()}
    write_json(stage/'feature_quality.json',quality)
    (stage/'IMPLEMENTATION.md').write_text((Path(__file__).parent/'README.md').read_text(encoding='utf-8'),encoding='utf-8')
    for p in stage.iterdir():
        os.replace(p,output/p.name)
    stage.rmdir()
    write_json(run_dir/'run_result.json',dict(status='passed',elapsed_seconds=quality['elapsed_seconds'],
               train_rows=len(train),final_rows=len(full),core_features=core,
               output_sha256={p.name:digest(p) for p in output.iterdir() if p.is_file()}))
    log(f'PASS: train={len(train)}, final={len(full)}, core={len(core)}; output={output}')
    return quality

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--cleaned-dir',type=Path,default=ROOT/'data'/'processed'/'cleaned')
    parser.add_argument('--output-dir',type=Path,default=ROOT/'outputs'/'features')
    parser.add_argument('--overwrite',action='store_true')
    args=parser.parse_args()
    run(args.cleaned_dir.resolve(),args.output_dir,args.overwrite)

if __name__=='__main__':
    main()
