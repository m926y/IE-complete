import unittest

from src.prediction.forecast_v2 import stable_columns


class ForecastFeatureTests(unittest.TestCase):
    def test_stable_branch_excludes_shifted_channels(self):
        core = ["imu_accel_14d", "evt_11401_count", "road_risk_14d",
                "risk_count_14d", "distance_km_14d", "active_days_14d"]
        selected = stable_columns(core)
        self.assertIn("distance_km_14d", selected)
        self.assertIn("active_days_14d", selected)
        self.assertNotIn("imu_accel_14d", selected)
        self.assertNotIn("evt_11401_count", selected)
        self.assertNotIn("road_risk_14d", selected)
        self.assertNotIn("risk_count_14d", selected)
        self.assertEqual(selected[-3:], ["non_target_burst", "cross_family_days_rate",
                                         "road_other_rate_1000km"])


if __name__ == "__main__":
    unittest.main()
