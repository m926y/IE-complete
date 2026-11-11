import unittest
from src.delivery.validate import allowed_archive_name


class DeliveryTests(unittest.TestCase):
    def test_archive_rejects_data_and_traversal(self):
        for name in ['../secret.py', '/src/a.py', 'C:/src/a.py', 'src\\a.py',
                     'data/raw/risk.gz', 'outputs/predictor.joblib', 'docs/official.pdf']:
            self.assertFalse(allowed_archive_name(name), name)

    def test_archive_accepts_reproduction_sources(self):
        for name in ['src/reproduce_submission.py', 'tests/test_delivery.py',
                     'README.md', 'src/features/README.md', 'requirements-lock.txt', 'configs/submission/prediction_features.json']:
            self.assertTrue(allowed_archive_name(name), name)
