import unittest

import numpy as np
import pandas as pd

from src.scoring.score_core import DIMS
from src.scoring.evidence_score import evidence_increment, attach_triage
from src.scoring.exposure_adjustment import monotone_percentile_penalty


class EvidenceScoreTests(unittest.TestCase):
    def test_zero_event_counterfactual_and_monotonic_increment(self):
        frozen = {"weights": {d: 1 / len(DIMS) for d in DIMS},
                  "reference": {d: {"tau": 2., "mu": 1., "rates": [0., .5, 1., 2.]}
                                for d in DIMS if d != "imu_evidence"}}
        base = 1 / len(DIMS) * monotone_percentile_penalty(
            [2. / 4.], reference_rate=[0., .5, 1., 2.]).iloc[0]
        raw = pd.DataFrame({"gpsno": ["a", "b"]})
        for dim in DIMS:
            raw[dim + "_contribution"] = [base, base + 2.] if dim != "imu_evidence" else [0., 1.]
            raw[dim + "_penalty"] = [10., 20.]
            if dim != "imu_evidence":
                raw[dim + "_exposure"] = [2., 2.]
        got = evidence_increment(raw, frozen)
        for dim in DIMS[:-1]:
            self.assertAlmostEqual(got.at[0, dim + "_contribution"], 0.)
            self.assertAlmostEqual(got.at[1, dim + "_contribution"], 2.)
        self.assertTrue((got[[d + "_contribution" for d in DIMS]] >= 0).all().all())
        self.assertGreater(got.loc[1, [d + "_contribution" for d in DIMS]].sum(),
                           got.loc[0, [d + "_contribution" for d in DIMS]].sum())

    def test_cross_task_risk_stays_separate_from_safety_score(self):
        scores = pd.DataFrame({"gpsno": [str(i) for i in range(10)],
                               "risk_level": ["A"] * 10,
                               "confidence_level": ["high"] * 10,
                               "safety_score": [90.] * 10})
        forecast = pd.DataFrame({"gpsno": [str(i) for i in range(10)],
                                 "risk_prob": np.arange(10) / 10})
        got = attach_triage(scores, forecast)
        self.assertTrue((got.safety_score == 90).all())
        self.assertEqual(got.review_queue.value_counts().to_dict(),
                         {"routine": 8, "prediction_review": 2})


if __name__ == "__main__":
    unittest.main()
