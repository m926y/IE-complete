import unittest

from src.scoring.event_taxonomy import DIMENSION_LABELS, EVENT_TAXONOMY, dimension_for
from src.scoring.scoring_rules import default_rules_frame, validate_rules


class EventTaxonomyTest(unittest.TestCase):
    def test_all_24_codes_are_unique_and_mapped(self):
        self.assertEqual(len(EVENT_TAXONOMY), 24)
        mapped = {dimension for _, dimension in EVENT_TAXONOMY.values()} | {"imu_evidence"}
        self.assertEqual(mapped, set(DIMENSION_LABELS))

    def test_rules_cover_taxonomy(self):
        rules = default_rules_frame()
        validate_rules(rules)
        self.assertEqual(set(rules.event_type), set(EVENT_TAXONOMY))
        self.assertTrue((rules.half_life_days == 14).all())

    def test_unknown_event_fails(self):
        with self.assertRaises(KeyError):
            dimension_for(99999)


if __name__ == "__main__":
    unittest.main()
