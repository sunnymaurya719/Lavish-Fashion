from __future__ import annotations

import unittest
from unittest.mock import patch

import numpy as np

from train.train_model import build_training_corpus, combine_training_datasets


class TrainModelDatasetBlendTests(unittest.TestCase):
    def test_combine_training_datasets_preserves_sample_weights(self) -> None:
        synthetic_dataset = {
            "features": np.asarray([[1.0, 2.0], [3.0, 4.0]], dtype=np.float32),
            "targets": np.asarray([0.0, 1.0], dtype=np.float32),
            "sampleWeights": np.asarray([1.0, 1.0], dtype=np.float32),
            "featureOrder": ["a", "b"],
            "summary": {"source": "synthetic_bootstrap", "rows": 2},
        }
        external_dataset = {
            "features": np.asarray([[5.0, 6.0]], dtype=np.float32),
            "targets": np.asarray([-1.0], dtype=np.float32),
            "sampleWeights": np.asarray([0.35], dtype=np.float32),
            "featureOrder": ["a", "b"],
            "summary": {"source": "renttherunway", "rows": 1},
        }

        combined = combine_training_datasets(synthetic_dataset, external_dataset)

        self.assertEqual(combined["features"].shape, (3, 2))
        self.assertEqual(combined["targets"].shape, (3,))
        self.assertEqual(combined["sampleWeights"].shape, (3,))
        self.assertListEqual(combined["summary"]["sources"], [synthetic_dataset["summary"], external_dataset["summary"]])
        np.testing.assert_allclose(combined["sampleWeights"], np.asarray([1.0, 1.0, 0.35], dtype=np.float32))

    @patch("train.train_model.load_rent_the_runway_training_dataset")
    @patch("train.train_model.build_training_dataset")
    def test_build_training_corpus_assigns_external_row_weight(self, mock_build_training_dataset, mock_load_rtr_dataset) -> None:
        mock_build_training_dataset.return_value = {
            "features": np.asarray([[1.0, 2.0], [3.0, 4.0]], dtype=np.float32),
            "targets": np.asarray([0.0, 1.0], dtype=np.float32),
            "featureOrder": ["a", "b"],
            "summary": {"source": "synthetic_bootstrap", "rows": 2},
        }
        mock_load_rtr_dataset.return_value = {
            "features": np.asarray([[5.0, 6.0], [7.0, 8.0]], dtype=np.float32),
            "targets": np.asarray([-1.0, 0.5], dtype=np.float32),
            "featureOrder": ["a", "b"],
            "summary": {"source": "renttherunway", "rows": 2},
        }

        dataset = build_training_corpus(
            rows=200,
            seed=17,
            external_source="renttherunway",
            external_max_reviews=1000,
            external_min_item_reviews=8,
            external_row_weight=0.35,
        )

        self.assertEqual(dataset["features"].shape, (4, 2))
        self.assertAlmostEqual(float(dataset["sampleWeights"][0]), 1.0, places=4)
        self.assertAlmostEqual(float(dataset["sampleWeights"][1]), 1.0, places=4)
        self.assertAlmostEqual(float(dataset["sampleWeights"][2]), 0.35, places=4)
        self.assertAlmostEqual(float(dataset["sampleWeights"][3]), 0.35, places=4)
        self.assertEqual(dataset["summary"]["sources"][1]["source"], "renttherunway")


if __name__ == "__main__":
    unittest.main()
