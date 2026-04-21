"""Tests for the offline isotonic calibration trainer."""

from __future__ import annotations

import json
import sys
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from app.services.calibration import IsotonicCalibrator  # noqa: E402
from train.train_calibration import (  # noqa: E402
    CLOSENESS_COEFFICIENT,
    CLOSENESS_DENOMINATOR,
    CONFIDENCE_FLOOR,
    collect_observations,
    confidence_to_score_proxy,
    train_calibration_artifact,
)


def _record(*, confidence: float, feedback: str, selected: str = "M", recommended: str = "M") -> dict:
    return {
        "userId": "u1",
        "productId": "p1",
        "orderId": "o1",
        "selectedSize": selected,
        "recommendedSize": recommended,
        "feedback": feedback,
        "confidence": confidence,
        # Mark records as model-backed so the heuristic-loop filter keeps them.
        "predictionSource": "xgboost_regressor",
    }


class ConfidenceInverseTests(unittest.TestCase):
    def test_confidence_floor_maps_to_max_score(self):
        self.assertAlmostEqual(
            confidence_to_score_proxy(CONFIDENCE_FLOOR), CLOSENESS_DENOMINATOR
        )

    def test_full_closeness_maps_to_zero_score(self):
        self.assertAlmostEqual(
            confidence_to_score_proxy(CONFIDENCE_FLOOR + CLOSENESS_COEFFICIENT), 0.0
        )

    def test_clipped_below_floor(self):
        self.assertEqual(confidence_to_score_proxy(0.1), CLOSENESS_DENOMINATOR)


class CollectObservationsTests(unittest.TestCase):
    def test_skips_records_without_confidence_or_bad_label(self):
        records = [
            _record(confidence=0.9, feedback="perfect"),
            {
                "feedback": "perfect",
                "selectedSize": "M",
                "recommendedSize": "M",
                "predictionSource": "xgboost_regressor",
            },
            _record(confidence=0.5, feedback="bogus"),
            _record(confidence=0.4, feedback="too_small", selected="L", recommended="M"),
        ]
        observations, counts = collect_observations(records)
        self.assertEqual(counts["records"], 4)
        self.assertEqual(counts["used"], 2)
        self.assertEqual(counts["skipped_no_confidence"], 1)
        self.assertEqual(counts["skipped_bad_label"], 1)
        # First entry: perfect + matching size -> label 1
        self.assertEqual(observations[0][1], 1.0)
        # Second entry: too_small -> label 0
        self.assertEqual(observations[1][1], 0.0)


class TrainCalibrationArtifactTests(unittest.TestCase):
    def test_writes_loadable_artifact_with_summary(self):
        with TemporaryDirectory() as tmp:
            tmp_path = Path(tmp)
            feedback_path = tmp_path / "feedback.jsonl"
            output_path = tmp_path / "calibration.json"

            # Synthesize a monotone signal: high confidence -> mostly correct,
            # low confidence -> mostly wrong. 60 rows (>= default min 50).
            lines = []
            for index in range(30):
                lines.append(json.dumps(_record(confidence=0.9, feedback="perfect")))
                lines.append(
                    json.dumps(
                        _record(
                            confidence=0.45,
                            feedback="too_small",
                            selected="L",
                            recommended="M",
                        )
                    )
                )
            feedback_path.write_text("\n".join(lines) + "\n", encoding="utf-8")

            summary = train_calibration_artifact(feedback_path, output_path, min_observations=10)

            self.assertEqual(summary["recordsScanned"], 60)
            self.assertEqual(summary["observationsUsed"], 60)
            self.assertGreaterEqual(summary["gridPoints"], 2)
            self.assertTrue(output_path.is_file())

            calibrator = IsotonicCalibrator.load(output_path)
            self.assertTrue(calibrator.is_fitted)
            # Confidence ~0.9 -> small score proxy -> high P(correct).
            high_conf_score = confidence_to_score_proxy(0.9)
            low_conf_score = confidence_to_score_proxy(0.45)
            self.assertGreater(
                calibrator.apply(high_conf_score),
                calibrator.apply(low_conf_score),
            )

    def test_raises_when_below_min_observations(self):
        with TemporaryDirectory() as tmp:
            tmp_path = Path(tmp)
            feedback_path = tmp_path / "feedback.jsonl"
            output_path = tmp_path / "calibration.json"
            feedback_path.write_text(
                json.dumps(_record(confidence=0.9, feedback="perfect")) + "\n",
                encoding="utf-8",
            )
            with self.assertRaises(ValueError):
                train_calibration_artifact(feedback_path, output_path, min_observations=10)


if __name__ == "__main__":
    unittest.main()
