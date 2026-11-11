import math
from collections import defaultdict
from copy import deepcopy
from datetime import date, datetime
from pathlib import Path
import tempfile
import unittest

from src.features.runtime import duckdb
from src.features.event_groups import CODES, EVENT_GROUPS
from src.features.window_definitions import Window, START, END, DAY, training_windows, splits
from src.features.feature_contract import Registry
from src.features.build_window_features import Sources, build_window_features, ratio, pooled_moments
from src.features.build_labels import build_labels
from src.features.build_risk_daily import build_risk_daily, short_warning_counts
from src.features.fold_transforms import ExposureShrinker, FoldFeatureSelector

def risk_row(day, count=0):
    row={'event_date':day,'total_count':count,'risk_group_nunique':int(count>0),
         'speed_sum':count*20 if count else None,'speed_valid_count':count,'risk_speed_max_kmh':20 if count else None}
    row.update({f'evt_{c}_count':count if c==41001 else 0 for c in CODES})
    row.update({f'hour_{h:02d}_count':count if h==3 else 0 for h in range(24)})
    return row

def trajectory_row(day, distance=100, hours=2):
    return dict(event_date=day,distance_km=distance,run_time_hours=hours,moving_rows=2,
                source_rows=3,valid_speed_rows=3,speed_mean_kmh=20,speed_std_kmh=5,
                speed_max_kmh=30,valid_coordinate_rows=3,invalid_coordinate_rows=0,large_distance_gap_rows=0)

def fixture():
    obj=Sources.__new__(Sources)
    obj.profiles=[{'gpsno':'001','energy_type':'柴油'}]
    obj.daily={n:defaultdict(dict) for n in ('risk_daily','trajectory','imu')}
    for i in range(14):
        day=START+i*DAY
        obj.daily['risk_daily']['001'][day]=risk_row(day,1 if i in (0,13) else 0)
    for day in (START,START+13*DAY):
        obj.daily['trajectory']['001'][day]=trajectory_row(day)
    return obj

def calculate(sources):
    return build_window_features(sources,Window(START,START+13*DAY),Registry())[0]

class FeatureTests(unittest.TestCase):
    def test_event_mapping(self):
        self.assertEqual(len(CODES),24)
        self.assertEqual(len(set(CODES)),24)
        self.assertEqual(EVENT_GROUPS['severe_history'],(11803,11804))

    def test_window_lengths_and_count(self):
        windows=training_windows()
        self.assertEqual(len(windows),17)
        self.assertEqual(len({w.id for w in windows}),17)
        main=windows[0]
        self.assertEqual((main.days,main.horizon),(21,40))
        self.assertEqual(main.end+40*DAY,END)
        self.assertTrue(all(w.start>=START and w.end+w.horizon*DAY<=END for w in windows))

    def test_split_availability_and_nonoverlap(self):
        rows=splits(training_windows())
        for phase in ('model_selection','locked_test'):
            subset=[r for r in rows if r['phase']==phase]
            ev=next(r for r in subset if r['split_role']!='train')
            for tr in subset:
                if tr['split_role']=='train':
                    self.assertLessEqual(tr['label_end'],ev['feature_end'])
        v=next(r for r in rows if r['split_role']=='validation')
        t=next(r for r in rows if r['split_role']=='test')
        self.assertLess(v['label_end'],t['label_start'])

    def test_manual_rates_and_decay(self):
        r=calculate(fixture())
        self.assertEqual(r['fatigue_count_14d'],2)
        self.assertAlmostEqual(r['fatigue_rate_per_1000km_14d'],10)
        self.assertAlmostEqual(r['fatigue_rate_per_100h_14d'],50)
        self.assertAlmostEqual(r['fatigue_decayed_count_14d'],1+2**(-13/14))
        self.assertEqual(r['fatigue_recency_days_14d'],0)
        self.assertEqual(r['risk_longest_run_14d'],1)
        self.assertEqual(r['fatigue_recent_count_7d'],1)

    def test_missing_history_and_insufficient_lookback(self):
        r=calculate(fixture())
        self.assertIsNone(r['evt_11803_recency_days_14d'])
        self.assertEqual(r['evt_11803_has_history_14d'],0)
        self.assertIsNone(r['fatigue_recent_count_30d'])

    def test_zero_and_missing_exposure(self):
        s=fixture()
        for r in s.daily['trajectory']['001'].values():
            r['distance_km']=0
            r['run_time_hours']=0
        r=calculate(s)
        self.assertIsNone(r['fatigue_rate_per_1000km_14d'])
        self.assertIsNone(r['fatigue_rate_per_100h_14d'])
        self.assertIsNone(ratio(0,0))
        self.assertIsNone(ratio(0,None))

    def test_missing_imu_not_safe_zero(self):
        r=calculate(fixture())
        self.assertEqual(r['imu_coverage_14d'],0)
        self.assertEqual(r['imu_missing_14d'],1)
        self.assertIsNone(r['imu_gyro_gt20_fraction_14d'])
        self.assertIsNone(r['imu_accel_norm_std_daily_mean_14d'])

    def test_future_sensor_mutations_do_not_change_features(self):
        s=fixture()
        before=calculate(s)
        day=date(2026,6,15)
        s.daily['risk_daily']['001'][day]=risk_row(day,100000)
        s.daily['trajectory']['001'][day]=trajectory_row(day,1e9,1e9)
        s.daily['imu']['001'][day]={'source_rows':100000,'unreadable_future_field':99}
        self.assertEqual(before,calculate(s))

    def test_pre_window_history_not_used(self):
        s=fixture()
        before=calculate(s)
        day=date(2026,5,31)
        s.daily['risk_daily']['001'][day]=risk_row(day,100000)
        self.assertEqual(before,calculate(s))

    def test_pooled_variance(self):
        # Points [0,2] and [10] => mean 4, variance 56/3.
        mu,sigma=pooled_moments([{'n':2,'mu':1,'sd':1},{'n':1,'mu':10,'sd':0}],'n','mu','sd')
        self.assertAlmostEqual(mu,4)
        self.assertAlmostEqual(sigma,math.sqrt(56/3))

    def test_selector_train_only(self):
        rows=[{'a':i,'duplicate':i*2,'constant':0,'empty':None,'b':i*i} for i in range(5)]
        fit=FoldFeatureSelector().fit(rows,['a','duplicate','constant','empty','b'])
        self.assertEqual(fit.columns,['a','b'])
        selected=fit.columns.copy()
        fit.transform([{'a':None,'b':1e9}])
        self.assertEqual(fit.columns,selected)

    def test_shrinkage_train_only(self):
        f=ExposureShrinker().fit([2,8],[1,3])
        self.assertEqual(f.mu,2.5)
        self.assertEqual(f.tau,2)
        self.assertAlmostEqual(f.transform([2],[1])[0],7/3)
        self.assertEqual(f.transform([0,None],[0,1]),[None,None])
        f.transform([9999],[1])
        self.assertEqual(f.mu,2.5)

class SQLTests(unittest.TestCase):
    def setUp(self):
        self.con=duckdb.connect()
        self.con.execute("CREATE TABLE profile(gpsno VARCHAR); INSERT INTO profile VALUES ('001'),('002')")
        self.con.execute('CREATE TABLE risk_events(gpsno VARCHAR,event_type INTEGER,event_time TIMESTAMP,event_date DATE,speed_kmh DOUBLE)')

    def tearDown(self):
        self.con.close()

    def add(self,code,ts,gps='001'):
        self.con.execute('INSERT INTO risk_events VALUES (?,?,?,CAST(? AS DATE),20)',[gps,code,ts,ts])

    def test_label_timestamp_boundaries(self):
        w=Window(START,date(2026,6,21),40)
        self.add(11803,'2026-06-21 23:59:59','001')
        self.add(11803,'2026-08-01 00:00:00','001')
        self.add(11804,'2026-06-22 00:00:00','002')
        self.add(11803,'2026-07-31 23:59:59','002')
        labels=build_labels(self.con,w)
        self.assertEqual(labels['001']['label'],0)
        self.assertEqual(labels['002'],dict(label=1,accident_label=1,near_miss_label=1))

    def test_daily_counts_dense_zero_and_codes(self):
        self.add(41001,'2026-06-01 03:00:00')
        self.add(41001,'2026-06-01 03:00:01')
        with tempfile.TemporaryDirectory() as tmp:
            build_risk_daily(self.con,Path(tmp)/'risk.parquet')
            self.assertEqual(self.con.execute('SELECT count(*) FROM risk_daily').fetchone()[0],122)
            self.assertEqual(self.con.execute('SELECT sum(total_count),sum(fatigue_count),sum(hour_03_count) FROM risk_daily').fetchone(),(2,2,2))

    def test_qa_requires_two_near_misses(self):
        w=Window(START,date(2026,6,21),40)
        self.add(11804,'2026-06-22 12:00:00')
        self.assertEqual(build_labels(self.con,w)['001']['label'],0)
        self.add(11804,'2026-06-22 12:01:00')
        self.assertEqual(build_labels(self.con,w)['001']['label'],1)

    def test_short_warning_cutoff_and_future_mutation(self):
        w=Window(START,date(2026,6,14))
        self.add(11804,'2026-06-14 23:59:00')
        self.add(41001,'2026-06-14 23:58:00')
        self.add(41001,'2026-06-14 23:59:30')
        before=short_warning_counts(self.con,w)
        self.add(41001,'2026-06-15 00:00:00')
        self.add(11803,'2026-06-15 00:01:00')
        self.assertEqual(before,{'001':(1,1)})
        self.assertEqual(before,short_warning_counts(self.con,w))

if __name__=='__main__':
    unittest.main()
