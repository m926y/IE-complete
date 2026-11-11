import unittest
from pathlib import Path
import tempfile
import numpy as np
import pandas as pd
from src.scoring.calculate_scores import collect_cleaned_frames,score_frames
from src.scoring.scoring_rules import default_rules_frame
from src.scoring.integrated import make_reference,aligned_labels
from tests.scoring.test_score_pipeline import synthetic_frames

class TemporalContractTests(unittest.TestCase):
    def test_reference_fitted_once_and_label_id_alignment(self):
        frames=synthetic_frames()
        details,weights,_=score_frames(*frames)
        reference=make_reference(details)
        repeated,_,_=score_frames(*frames,weights=weights,reference=reference)
        np.testing.assert_allclose(details.safety_score,repeated.safety_score,atol=1e-4)
        labels=pd.DataFrame({'gpsno':details.gpsno[::-1].values,'label':np.arange(500)%2})
        y=aligned_labels(details,labels)
        self.assertEqual(y.iloc[0],labels.set_index('gpsno').loc[details.gpsno.iloc[0],'label'])

    def test_future_sensor_rows_are_excluded(self):
        with tempfile.TemporaryDirectory() as temp:
            paths={k:Path(temp)/(k+'.parquet') for k in ['profile','trajectory','imu','risk']}
            pd.DataFrame({'gpsno':['a']}).to_parquet(paths['profile'])
            base={'gpsno':['a','a'],'event_date':pd.to_datetime(['2026-06-01','2026-07-31'])}
            trajectory=pd.DataFrame(base)
            for c in ['moving_rows','source_rows','valid_speed_rows','invalid_speed_rows','valid_coordinate_rows',
                      'invalid_coordinate_rows','distance_km','run_time_hours']:
                trajectory[c]=[1,99999]
            trajectory.to_parquet(paths['trajectory'])
            imu=pd.DataFrame(base)
            for c in ['source_rows','missing_ems_speed_rows','missing_gps_speed_rows',
                      'accel_norm_outlier_rows','gyro_norm_gt20_rows','ems_gps_abs_diff_mean']:
                imu[c]=[1,99999]
            imu.to_parquet(paths['imu'])
            pd.DataFrame({'gpsno':['a'],'event_type':[11803],
                          'event_time':pd.to_datetime(['2026-07-31'])}).to_parquet(paths['risk'])
            _,t,i,r,_=collect_cleaned_frames(paths,default_rules_frame(),'2026-06-21 23:59:59')
            self.assertEqual(t.distance_km.iloc[0],1)
            self.assertEqual(i.imu_source_rows.iloc[0],1)
            self.assertTrue(r.empty)
