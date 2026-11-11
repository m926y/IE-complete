import unittest

import numpy as np
import pandas as pd

from src.scoring.calculate_scores import score_frames
from src.scoring.event_taxonomy import DIMENSION_LABELS
from src.scoring.validate_scores import validate_score_frame


def synthetic_frames(vehicle_count=500):
    ids = [f"V{index:04d}" for index in range(vehicle_count)]
    index = np.arange(vehicle_count)
    profile = pd.DataFrame({
        "gpsno": ids,
        "energy_type": np.where(index % 3 == 0, "柴油", "电力"),
    })
    trajectory = pd.DataFrame({
        "gpsno": ids,
        "trajectory_days": 61,
        "trajectory_source_rows": 10000,
        "valid_speed_rows": 9990,
        "invalid_speed_rows": 10,
        "valid_coordinate_rows": 9980,
        "invalid_coordinate_rows": 20,
        "distance_km": 1000 + index,
        "run_time_hours": 100 + index / 10,
    })
    imu = pd.DataFrame({
        "gpsno": ids,
        "imu_days": 50,
        "imu_source_rows": 5000,
        "missing_ems_speed_rows": 100,
        "missing_gps_speed_rows": 50,
        "accel_norm_outlier_rows": index % 7,
        "gyro_norm_gt20_rows": index % 13,
        "ems_gps_abs_diff_mean": (index % 20) / 2,
    })
    risk_rows = []
    for vehicle_index, gpsno in enumerate(ids):
        for dimension_index, dimension in enumerate(key for key in DIMENSION_LABELS if key != "imu_evidence"):
            count = (vehicle_index * (dimension_index + 1)) % 17
            risk_rows.append({
                "gpsno": gpsno,
                "dimension": dimension,
                "event_count": count,
                "risk_event_days": min(count, 10),
                "decayed_severity_count": float(count * (dimension_index + 1)),
            })
    return profile, trajectory, imu, pd.DataFrame(risk_rows)


class ScorePipelineTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        frames = synthetic_frames()
        cls.details, cls.weights, cls.calibration = score_frames(*frames)

    def test_end_to_end_contract(self):
        details = self.details
        self.assertEqual(len(details), 500)
        self.assertEqual(details.gpsno.nunique(), 500)
        self.assertTrue(details.safety_score.between(0, 100).all())
        self.assertEqual(details.risk_level.value_counts().to_dict(), {"B": 200, "C": 150, "A": 100, "D": 50})
        self.assertTrue(details[["top_reason_1", "top_reason_2", "top_reason_3"]].ne("").all().all())

    def test_static_validation_passes(self):
        report = validate_score_frame(self.details, self.weights, self.calibration)
        self.assertEqual(report["overall_static_status"], "pass")
        self.assertEqual(report["future_validation"]["status"], "not_run_missing_a_label_interface")

    def test_missing_imu_does_not_create_risk_penalty(self):
        profile, trajectory, imu, risk = synthetic_frames()
        missing_id = profile.loc[250, "gpsno"]
        details, _, _ = score_frames(profile, trajectory, imu[imu.gpsno != missing_id], risk)
        row = details[details.gpsno == missing_id].iloc[0]
        self.assertTrue(np.isnan(row.imu_evidence_penalty))
        self.assertEqual(row.imu_evidence_contribution, 0)
        self.assertLess(row.confidence_score, details[details.gpsno != missing_id].confidence_score.median())

    def test_future_labels_enable_monotonic_check(self):
        labels = self.details.risk_level.map({"A": 0, "B": 0, "C": 1, "D": 1})
        report = validate_score_frame(self.details, self.weights, self.calibration, labels)
        self.assertEqual(report["future_validation"]["status"], "pass")


if __name__ == "__main__":
    unittest.main()
