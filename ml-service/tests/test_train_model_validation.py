from __future__ import annotations

import unittest

import numpy as np

from train.train_model import combine_training_datasets


class CombineDatasetsValidationTests(unittest.TestCase):
    def test_mismatched_feature_order_is_rejected(self) -> None:
        first = {
            "features": np.asarray([[1.0, 2.0]], dtype=np.float32),
            "targets": np.asarray([0.0], dtype=np.float32),
            "featureOrder": ["a", "b"],
            "summary": {"source": "synthetic_bootstrap", "rows": 1},
        }
        second = {
            "features": np.asarray([[3.0, 4.0]], dtype=np.float32),
            "targets": np.asarray([1.0], dtype=np.float32),
            "featureOrder": ["a", "c"],
            "summary": {"source": "renttherunway", "rows": 1},
        }
        with self.assertRaises(ValueError) as exc_ctx:
            combine_training_datasets(first, second)
        self.assertIn("featureOrder", str(exc_ctx.exception))

    def test_mismatched_feature_count_is_rejected(self) -> None:
        first = {
            "features": np.asarray([[1.0, 2.0]], dtype=np.float32),
            "targets": np.asarray([0.0], dtype=np.float32),
            "featureOrder": ["a", "b"],
            "summary": {"source": "synthetic_bootstrap", "rows": 1},
        }
        second = {
            "features": np.asarray([[3.0, 4.0, 5.0]], dtype=np.float32),
            "targets": np.asarray([1.0], dtype=np.float32),
            "featureOrder": ["a", "b"],
            "summary": {"source": "renttherunway", "rows": 1},
        }
        with self.assertRaises(ValueError) as exc_ctx:
            combine_training_datasets(first, second)
        self.assertIn("feature matrix shape", str(exc_ctx.exception))


if __name__ == "__main__":
    unittest.main()
