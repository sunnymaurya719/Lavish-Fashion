from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace

import numpy as np

from train.build_dataset import build_training_dataset
from train.train_model import (
    _build_index_split,
    _capture_reproducibility_metadata,
    _compute_segment_metrics,
    combine_training_datasets,
    publish_to_registry,
    save_model_artifact,
    train_size_model,
)


class GroupSplitTests(unittest.TestCase):
    def test_random_split_when_no_groups_provided(self) -> None:
        train_idx, val_idx = _build_index_split(100, seed=7)
        self.assertEqual(len(train_idx) + len(val_idx), 100)
        self.assertTrue(set(train_idx).isdisjoint(set(val_idx)))

    def test_group_split_keeps_groups_disjoint(self) -> None:
        group_ids = [f"item-{index // 5}" for index in range(120)]
        train_idx, val_idx = _build_index_split(120, seed=11, group_ids=group_ids)
        train_groups = {group_ids[i] for i in train_idx.tolist()}
        val_groups = {group_ids[i] for i in val_idx.tolist()}
        self.assertTrue(train_groups.isdisjoint(val_groups))
        self.assertGreater(len(train_idx), 0)
        self.assertGreater(len(val_idx), 0)


class SegmentMetricsTests(unittest.TestCase):
    def test_segment_metrics_filter_small_buckets(self) -> None:
        targets = np.zeros(40, dtype=np.float32)
        predictions = np.zeros(40, dtype=np.float32)
        segments = [("Men", "true_to_size", "regular")] * 30 + [("Women", "runs_small", "slim")] * 10
        result = _compute_segment_metrics(targets, predictions, segments, min_rows=15)
        self.assertIn("Men|true_to_size|regular", result)
        self.assertNotIn("Women|runs_small|slim", result)
        self.assertEqual(result["Men|true_to_size|regular"]["rowCount"], 30)


class CombineDatasetsTests(unittest.TestCase):
    def test_combine_propagates_groups_and_segments(self) -> None:
        first = {
            "features": np.asarray([[1.0, 2.0], [3.0, 4.0]], dtype=np.float32),
            "targets": np.asarray([0.0, 1.0], dtype=np.float32),
            "featureOrder": ["a", "b"],
            "groupIds": ["g1", "g2"],
            "segments": [("Men", "true_to_size", "regular"), ("Men", "true_to_size", "regular")],
            "summary": {"source": "synthetic"},
        }
        second = {
            "features": np.asarray([[5.0, 6.0]], dtype=np.float32),
            "targets": np.asarray([-1.0], dtype=np.float32),
            "featureOrder": ["a", "b"],
            "groupIds": ["g3"],
            "segments": [("Women", "runs_small", "slim")],
            "summary": {"source": "renttherunway"},
        }
        combined = combine_training_datasets(first, second)
        self.assertEqual(combined["groupIds"], ["g1", "g2", "g3"])
        self.assertEqual(
            combined["segments"],
            [
                ("Men", "true_to_size", "regular"),
                ("Men", "true_to_size", "regular"),
                ("Women", "runs_small", "slim"),
            ],
        )


class ReproducibilityMetadataTests(unittest.TestCase):
    def test_metadata_is_deterministic_for_same_inputs(self) -> None:
        features = np.arange(20, dtype=np.float32).reshape(10, 2)
        targets = np.linspace(-1, 1, 10, dtype=np.float32)
        first = _capture_reproducibility_metadata(features, targets)
        second = _capture_reproducibility_metadata(features, targets)
        self.assertEqual(first["datasetSha256"], second["datasetSha256"])
        self.assertIn("pythonVersion", first)


class EndToEndTrainingTests(unittest.TestCase):
    def test_train_then_publish_to_registry(self) -> None:
        dataset = build_training_dataset(row_target=300, seed=23)
        # Sanity: dataset emits the new fields.
        self.assertEqual(len(dataset["groupIds"]), len(dataset["targets"]))
        self.assertEqual(len(dataset["segments"]), len(dataset["targets"]))

        artifact_payload, metadata = train_size_model(
            dataset,
            seed=23,
            num_boost_round=20,
            model_version="phase2-test",
        )

        self.assertEqual(metadata["splitStrategy"], "group")
        self.assertGreater(metadata["uniqueGroupCount"], 1)
        self.assertIn("reproducibility", metadata)
        self.assertIn("datasetSha256", metadata["reproducibility"])

        with tempfile.TemporaryDirectory() as tmpdir:
            artifact_path, metadata_path = save_model_artifact(
                artifact_payload, Path(tmpdir) / "model.joblib"
            )
            self.assertTrue(artifact_path.exists())
            self.assertTrue(metadata_path.exists())

            registry_dir = Path(tmpdir) / "registry"
            destination = publish_to_registry(
                artifact_path,
                metadata_path,
                registry_dir=registry_dir,
                metadata=metadata,
            )
            self.assertIsNotNone(destination)
            self.assertTrue((destination / "model.joblib").exists())
            self.assertTrue((destination / "metadata.json").exists())
            manifest = (destination / "MANIFEST.sha256").read_text(encoding="utf-8")
            self.assertIn("model.joblib", manifest)
            self.assertIn("metadata.json", manifest)

            latest_pointer = registry_dir / "phase2-test" / "LATEST"
            self.assertTrue(latest_pointer.exists())
            self.assertTrue(latest_pointer.read_text(encoding="utf-8").strip())

            # Metadata persisted to disk should mirror in-memory metadata.
            stored_metadata = json.loads((destination / "metadata.json").read_text(encoding="utf-8"))
            self.assertEqual(stored_metadata["modelVersion"], "phase2-test")


if __name__ == "__main__":
    unittest.main()
