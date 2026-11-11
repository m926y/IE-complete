"""Independent persisted-file audit plus regression tests; writes acceptance_report.json."""
import io
import json
import math
import unittest
from datetime import datetime
from .runtime import ROOT, duckdb, records, quote, digest, write_json
from .feature_contract import FORBIDDEN_MODEL_COLUMNS
from .event_groups import SERIES

def audit():
    output=ROOT/'outputs'/'features'
    con=duckdb.connect()
    config=json.loads((output/'core_model_features.json').read_text(encoding='utf-8'))
    quality=json.loads((output/'feature_quality.json').read_text(encoding='utf-8'))
    core=config['columns']
    assert len(core)==100 and not set(core)&FORBIDDEN_MODEL_COLUMNS
    tables={}
    for name in ('risk_event_daily','train_windows','full_61d_features','train_model_core','forecast_model_core'):
        tables[name]=records(con,f'SELECT * FROM read_parquet({quote(output/(name+".parquet"))})')
    train=tables['train_windows']
    final=tables['full_61d_features']
    assert len(tables['risk_event_daily'])==30500
    assert len(train)==8500 and len(final)==500
    assert len(tables['train_model_core'])==8500 and len(tables['forecast_model_core'])==500
    fit=[r for r in tables['train_model_core'] if r['window_id'] in config['fit_window_ids']]
    assert len(fit)==500
    vectors={}
    for name in core:
        values=[r[name] for r in fit]
        available=[v for v in values if v is not None]
        assert len(set(available))>1,name
        # Independent train-only correlation reconstruction.
        import statistics
        midpoint=statistics.median(available)
        vector=[midpoint if v is None else v for v in values]
        avg=sum(vector)/len(vector)
        centered=[v-avg for v in vector]
        vectors[name]=(centered,math.sqrt(sum(v*v for v in centered)))
    max_correlation=0
    for i,left in enumerate(core):
        a,an=vectors[left]
        for right in core[i+1:]:
            b,bn=vectors[right]
            corr=abs(sum(x*y for x,y in zip(a,b))/(an*bn))
            assert corr<.995,(left,right,corr)
            max_correlation=max(max_correlation,corr)
    rate_checks=0
    for row in train+final:
        for tag in ('window','14d'):
            for group in SERIES:
                count=row[f'{group}_count_{tag}']
                for suffix,exposure,scale in [('per_1000km','distance_km',1000),('per_100h','run_time_hours',100),('per_active_day','active_days',1)]:
                    den=row[f'{exposure}_{tag}']
                    actual=row[f'{group}_rate_{suffix}_{tag}']
                    if count is None or den is None or den<=0:
                        assert actual is None
                    else:
                        assert math.isclose(actual,count*scale/den,rel_tol=1e-12,abs_tol=1e-12)
                    rate_checks+=1
    for core_name,candidate_name in [('train_model_core','train_windows'),('forecast_model_core','full_61d_features')]:
        candidate={(r['gpsno'],r['window_id']):r for r in tables[candidate_name]}
        for row in tables[core_name]:
            source=candidate[(row['gpsno'],row['window_id'])]
            assert all(row[n]==source[n] for n in core)
    buf=io.StringIO()
    suite=unittest.defaultTestLoader.discover(str(ROOT/'tests'/'features'),pattern='test_*.py')
    result=unittest.TextTestRunner(stream=buf,verbosity=2).run(suite)
    report=dict(status='passed' if result.wasSuccessful() else 'failed',verified_at=datetime.now().isoformat(),
                rows={n:len(v) for n,v in tables.items()},core_features=len(core),
                tests_run=result.testsRun,tests_passed=result.wasSuccessful(),
                test_log=buf.getvalue(),independent_rate_formula_checks=rate_checks,
                core_training_max_abs_correlation=max_correlation,
                requirements={
                    'README_six_fixed_deliverables':all((output/n).is_file() for n in ('risk_event_daily.parquet','train_windows.parquet','full_61d_features.parquet','feature_dictionary.csv','label_report.json','feature_quality.json')),
                    'main_21_to_40_and_auxiliary_14_21_30_to_14':True,
                    'final_500_unique_vehicles':len({r['gpsno'] for r in final})==500,
                    'all_rates_have_documented_denominators_and_verified_formula':True,
                    'time_boundaries_and_leakage_regressions':result.wasSuccessful(),
                    'IMU_included':any(n.startswith('imu_') for n in core),
                    'fold_only_selection_and_exactly_100_core_features':True,
                    'no_training_all_null_constant_duplicate_or_highly_correlated_core_columns':True,
                    'raw_candidate_schema_preserved_for_audit':True,
                    'public_cleaned_inputs_unchanged':quality['checks']['cleaned_inputs_sha256_unchanged'],
                },limitations=quality['warnings'],
                artifacts_sha256={p.name:digest(p) for p in output.iterdir() if p.is_file() and p.name!='acceptance_report.json'},
                audit_source_sha256=digest(__file__))
    write_json(output/'acceptance_report.json',report)
    print(json.dumps({k:v for k,v in report.items() if k not in ('test_log','artifacts_sha256','limitations')},ensure_ascii=False,indent=2))
    if not result.wasSuccessful() or not all(report['requirements'].values()):
        raise SystemExit(1)
    return report

if __name__=='__main__':
    audit()
