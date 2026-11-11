import math
from collections import Counter
from .feature_contract import FORBIDDEN_MODEL_COLUMNS
from .runtime import records, quote
from .window_definitions import START, END, DAY

INPUTS=('vehicle_profile.parquet','risk_events.parquet','trajectory_daily.parquet','imu_daily.parquet','vehicle_day.parquet')

def validate_inputs(con, cleaned, expected_vehicles=500):
    names=dict(zip(INPUTS,('profile','risk_events','trajectory','imu','vehicle_day')))
    result={}
    for filename,table in names.items():
        path=cleaned/filename
        if not path.is_file():
            raise FileNotFoundError(path)
        con.execute(f'CREATE OR REPLACE TEMP VIEW {table} AS SELECT * FROM read_parquet({quote(path)})')
        summary=records(con,f'SELECT count(*) row_count, count(DISTINCT gpsno) vehicles, count_if(gpsno IS NULL) null_ids FROM {table}')[0]
        assert summary['vehicles']==expected_vehicles and summary['null_ids']==0,(table,summary)
        if table=='profile':
            assert summary['row_count']==expected_vehicles
        else:
            assert not con.execute(f'SELECT gpsno FROM {table} EXCEPT SELECT gpsno FROM profile').fetchall(),table
            assert con.execute(f"SELECT count(*) FROM {table} WHERE event_date IS NULL OR event_date < DATE '{START}' OR event_date > DATE '{END}'").fetchone()[0]==0
        if table in ('trajectory','imu','vehicle_day'):
            dup=con.execute(f'SELECT count(*) FROM (SELECT gpsno,event_date FROM {table} GROUP BY ALL HAVING count(*)>1)').fetchone()[0]
            assert dup==0,(table,'duplicate day key')
        result[table]=summary
    assert con.execute('SELECT count(*) FROM risk_events WHERE NOT known_event_code OR known_event_code IS NULL').fetchone()[0]==0
    assert con.execute('SELECT count(*) FROM risk_events WHERE event_time IS NULL OR CAST(event_time AS DATE) IS DISTINCT FROM event_date').fetchone()[0]==0
    return result

def validate_outputs(con, train, full, registry, core, windows, split_rows, profiles):
    ids={r['gpsno'] for r in profiles}
    assert len(full)==len(ids) and {r['gpsno'] for r in full}==ids
    assert len({(r['gpsno'],r['window_id']) for r in train})==len(train)
    assert len(train)==len(windows)*len(ids)
    assert all(r['label'] in (0,1) for r in train)
    assert all(r['feature_end']<r['label_start']<=r['label_end']<=END for r in train)
    assert all((r['label_end']-r['label_start']).days+1==r['label_horizon_days'] for r in train)
    assert all((r['feature_end']-r['feature_start']).days+1==r['feature_window_days'] for r in train+full)
    for w in windows:
        assert {r['gpsno'] for r in train if r['window_id']==w.id}==ids
    feature_names=list(registry.entries)
    assert not (set(core)&FORBIDDEN_MODEL_COLUMNS)
    assert all(set(feature_names).issubset(r) for r in train+full)
    assert all(registry.entries[c]['eligibility']=='candidate' for c in core)
    column_report={}
    for name,definition in registry.entries.items():
        available=[r[name] for r in train if r[name] is not None]
        final=[r[name] for r in full if r[name] is not None]
        if definition['dtype']=='DOUBLE':
            assert all(math.isfinite(v) for v in available+final),name
        if definition['unit'] in ('fraction','events/1000km','events/100h','events/day','log_ratio','km/day','hour/day'):
            assert definition['denominator'] and definition['numerator'],name
        column_report[name]=dict(train_missing_count=len(train)-len(available),
                                 final_missing_count=len(full)-len(final),
                                 train_unique_values=len(set(available)),
                                 train_min=min(available) if available else None,
                                 train_max=max(available) if available else None)
    for phase in ('model_selection','locked_test'):
        rows=[r for r in split_rows if r['phase']==phase]
        eval_row=next(r for r in rows if r['split_role']!='train')
        for r in rows:
            if r['split_role']=='train':
                assert r['label_end']<=eval_row['feature_end']
    valid=next(r for r in split_rows if r['split_role']=='validation')
    test=next(r for r in split_rows if r['split_role']=='test')
    assert valid['label_end']<test['label_start']
    # Independent SQL label reconstruction, rather than trusting the label builder.
    for w in windows:
        expected=dict(con.execute(f"SELECT gpsno, CAST(sum(CASE WHEN event_type=11803 THEN 1 ELSE 0 END)>=1 OR sum(CASE WHEN event_type=11804 THEN 1 ELSE 0 END)>=2 AS INTEGER) FROM risk_events WHERE event_time >= TIMESTAMP '{w.end+DAY}' AND event_time < TIMESTAMP '{w.end+(w.horizon+1)*DAY}' GROUP BY gpsno").fetchall())
        assert all(r['label']==expected.get(r['gpsno'],0) for r in train if r['window_id']==w.id)
    assert con.execute('SELECT sum(total_count) FROM risk_daily').fetchone()[0]==con.execute('SELECT count(*) FROM risk_events').fetchone()[0]
    return dict(status='passed', train_rows=len(train), final_rows=len(full),
                windows=len(windows), candidate_feature_count=len(feature_names), core_feature_count=len(core),
                checks={'500_vehicle_coverage':len(ids)==500,'unique_keys':True,'time_bounds':True,
                        'independent_label_reconstruction':True,'daily_event_reconciliation':True,
                        'finite_values':True,'rate_denominators_documented':True,'split_time_embargo':True,
                        'train_final_schema_alignment':True,'profile_snapshot_excluded_from_core':True},
                columns=column_report,
                policy='Candidate audit tables preserve rare/constant/long-window unavailable columns. Formal model matrices contain only train-selected columns, with no training-all-null, constant, duplicate or abs(correlation)>=0.995 columns.')
