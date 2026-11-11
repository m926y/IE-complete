import unittest

import numpy as np

from src.scoring.exposure_adjustment import (
    decay_weight,
    empirical_bayes_rate,
    monotone_percentile_penalty,
)


class ExposureAdjustmentTest(unittest.TestCase):
    def test_decay_has_14_day_half_life(self):
        np.testing.assert_allclose(decay_weight([0, 14, 28]), [1.0, 0.5, 0.25])

    def test_empirical_bayes_prevents_zero_exposure_full_safety(self):
        rates, mean, tau = empirical_bayes_rate([0, 20, 0], [0, 10, 10], tau=5)
        self.assertEqual(mean, 1.0)
        self.assertEqual(tau, 5)
        self.assertGreater(rates[0], 0)
        self.assertLess(rates[1], 2)
        self.assertGreater(rates[2], 0)

    def test_percentile_is_monotone_and_missing_stays_missing(self):
        penalty = monotone_percentile_penalty([0.1, 0.2, np.nan], available=[True, True, False])
        self.assertLess(penalty.iloc[0], penalty.iloc[1])
        self.assertTrue(np.isnan(penalty.iloc[2]))

    def test_training_reference_is_used_without_refitting(self):
        penalty = monotone_percentile_penalty([1.5], reference_rate=[0, 1, 2, 3])
        self.assertAlmostEqual(penalty.iloc[0], 50.0)


if __name__ == "__main__":
    unittest.main()
