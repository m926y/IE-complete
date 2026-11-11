import unittest

import numpy as np
import pandas as pd

from src.scoring.calibrate_weights import binary_auc, calibrate_weights
from src.scoring.scoring_rules import DEFAULT_WEIGHTS, validate_weights


class ScoringRulesTest(unittest.TestCase):
    def test_repository_initial_weights_satisfy_constraints(self):
        validate_weights(DEFAULT_WEIGHTS)
        self.assertAlmostEqual(sum(DEFAULT_WEIGHTS.values()), 1.0)

    def test_missing_labels_do_not_fake_calibration(self):
        weights, report = calibrate_weights(None, None)
        self.assertEqual(weights, DEFAULT_WEIGHTS)
        self.assertEqual(report["status"], "initial_weights_missing_future_labels")

    def test_invalid_imu_weight_fails(self):
        bad = DEFAULT_WEIGHTS.copy()
        bad["imu_evidence"] = 0.11
        bad["management"] = 0.04
        with self.assertRaises(ValueError):
            validate_weights(bad)

    def test_auc_handles_ties(self):
        self.assertAlmostEqual(binary_auc([0, 0, 1, 1], [0, 0.5, 0.5, 1]), 0.875)

    def test_label_calibration_is_bounded_and_constrained(self):
        rows = 100
        labels = pd.Series([0] * 50 + [1] * 50)
        penalties = pd.DataFrame({
            f"{dimension}_penalty": (
                np.arange(rows) if dimension == "history" else np.tile(np.arange(10), 10)
            )
            for dimension in DEFAULT_WEIGHTS
        })
        weights, report = calibrate_weights(penalties, labels, max_change=0.05)
        validate_weights(weights)
        self.assertEqual(report["status"], "calibrated_with_future_labels")
        for dimension in weights:
            self.assertLessEqual(abs(weights[dimension] - DEFAULT_WEIGHTS[dimension]), 0.05 + 1e-9)


if __name__ == "__main__":
    unittest.main()
