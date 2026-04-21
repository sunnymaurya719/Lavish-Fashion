"""Offline trainer for the recommendation isotonic calibration artifact.

Reads the runtime fit-feedback JSONL log, reconstructs the predicted
``|best_sort_score|`` axis from the persisted ``confidence`` value (the runtime
heuristic ``confidence = 0.38 + closeness * 0.44 + …`` with ``closeness =
clamp(1 - |best_sort_score| / 12, 0, 1)`` is invertible up to clipping), and
fits an :class:`IsotonicCalibrator` so the recommendation service can replace
the heuristic confidence with a calibrated probability of "perfect" fit.

Usage:

    python -m train.train_calibration \
        --feedback-path train/data/fit_feedback_runtime.jsonl \
        --output-path train/data/calibration.json
"""

from __future__ import annotations

import argparse
import json
import logging
import sys
from pathlib import Path
from typing import Iterable

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from app.services.calibration import IsotonicCalibrator  # noqa: E402


logger = logging.getLogger("train_calibration")

# Heuristic confidence floor/coefficient mirrored from
# ``recommendation_service`` so we can invert ``confidence -> closeness``.
CONFIDENCE_FLOOR = 0.38
CLOSENESS_COEFFICIENT = 0.44
CLOSENESS_DENOMINATOR = 12.0

# Engine classification — used to break the heuristic feedback loop.
# Only feedback whose original recommendation came from a real model should
# train the isotonic calibrator. Feedback whose confidence was emitted by a
# heuristic (rule-engine, ML internal fallback, model error) does not
# describe model behaviour and would bias the calibrator toward the heuristic.
MODEL_BACKED_PREDICTION_SOURCES: frozenset[str] = frozenset({
    "xgboost_regressor",
    "xgboost_classifier",
    "model_backed",
})
HEURISTIC_PREDICTION_SOURCES: frozenset[str] = frozenset({
    "heuristic_fallback",
    "model_length_mismatch",
    "model_error",
    "rule_engine",
})
_HEURISTIC_MODEL_VERSION_PREFIXES: tuple[str, ...] = ("rule-engine", "ml-fallback")


def _is_model_backed_record(record: dict[str, object]) -> bool:
    """Return True iff the record's original recommendation came from a model.

    Trusts ``predictionSource`` when present (preferred). Falls back to
    inspecting ``modelVersion`` for the well-known heuristic prefixes when
    ``predictionSource`` is missing on legacy records.
    """
    source_raw = str(record.get("predictionSource") or "").strip().lower()
    if source_raw:
        if source_raw in MODEL_BACKED_PREDICTION_SOURCES:
            return True
        if source_raw in HEURISTIC_PREDICTION_SOURCES:
            return False
        # Unknown explicit source — be conservative and exclude.
        return False

    model_version = str(record.get("modelVersion") or "").strip().lower()
    if not model_version:
        # No engine signal at all — exclude rather than assume model-backed.
        return False
    return not any(model_version.startswith(prefix) for prefix in _HEURISTIC_MODEL_VERSION_PREFIXES)


def confidence_to_score_proxy(confidence: float) -> float:
    """Invert the runtime heuristic confidence back to a ``|sortScore|`` proxy.

    The mapping is monotone-decreasing in ``|sortScore|`` so the inverse is
    monotone-decreasing in ``confidence``. Values outside ``[floor, floor +
    coeff]`` are clipped to the closeness window the runtime uses.
    """
    confidence = max(0.0, min(1.0, float(confidence)))
    closeness = (confidence - CONFIDENCE_FLOOR) / CLOSENESS_COEFFICIENT
    closeness = max(0.0, min(1.0, closeness))
    return CLOSENESS_DENOMINATOR * (1.0 - closeness)


def _iter_feedback_records(path: Path) -> Iterable[dict[str, object]]:
    with open(path, "r", encoding="utf-8", newline="") as handle:
        for raw_line in handle:
            line = raw_line.strip()
            if not line:
                continue
            try:
                yield json.loads(line)
            except json.JSONDecodeError:
                continue


def collect_observations(
    records: Iterable[dict[str, object]],
    *,
    perfect_label: str = "perfect",
) -> tuple[list[tuple[float, float]], dict[str, int]]:
    """Build ``(score_proxy, was_correct)`` pairs from feedback records.

    Records without a ``confidence`` value or with an unrecognised ``feedback``
    verdict are skipped. ``was_correct`` is ``1.0`` when the feedback verdict
    matches ``perfect_label`` AND the user's selected size equals the
    recommendation, else ``0.0``.

    Records whose original recommendation came from a heuristic engine are
    skipped — see ``_is_model_backed_record``. This breaks the feedback loop
    where heuristic-driven feedback would otherwise train the calibrator that
    overrides model-driven confidence.
    """
    observations: list[tuple[float, float]] = []
    counts = {
        "records": 0,
        "skipped_no_confidence": 0,
        "skipped_bad_label": 0,
        "skipped_heuristic_source": 0,
        "used": 0,
    }

    for record in records:
        counts["records"] += 1
        if not _is_model_backed_record(record):
            counts["skipped_heuristic_source"] += 1
            continue
        confidence = record.get("confidence")
        if confidence is None:
            counts["skipped_no_confidence"] += 1
            continue
        try:
            confidence_value = float(confidence)
        except (TypeError, ValueError):
            counts["skipped_no_confidence"] += 1
            continue

        verdict = str(record.get("feedback") or "").strip().lower()
        if verdict not in {"too_small", "perfect", "too_large"}:
            counts["skipped_bad_label"] += 1
            continue

        selected = str(record.get("selectedSize") or "").strip().lower()
        recommended = str(record.get("recommendedSize") or "").strip().lower()
        was_correct = 1.0 if (verdict == perfect_label and selected == recommended) else 0.0

        observations.append((confidence_to_score_proxy(confidence_value), was_correct))
        counts["used"] += 1

    return observations, counts


def train_calibration_artifact(
    feedback_path: Path,
    output_path: Path,
    *,
    min_observations: int = 50,
    max_grid_points: int = 64,
) -> dict[str, object]:
    """Read feedback JSONL, fit the calibrator, persist + return a summary."""
    feedback_path = Path(feedback_path)
    output_path = Path(output_path)

    if not feedback_path.is_file():
        raise FileNotFoundError(f"Feedback log not found: {feedback_path}")

    observations, counts = collect_observations(_iter_feedback_records(feedback_path))
    if len(observations) < min_observations:
        raise ValueError(
            f"Need at least {min_observations} usable feedback observations to fit calibration; "
            f"found {len(observations)} (records scanned: {counts['records']})."
        )

    calibrator = IsotonicCalibrator.fit(
        observations,
        monotone="decreasing",
        max_grid_points=max_grid_points,
    )
    if not calibrator.is_fitted:
        raise ValueError("Isotonic fit produced fewer than two grid points; refusing to save.")

    output_path.parent.mkdir(parents=True, exist_ok=True)
    calibrator.save(output_path)

    positive_count = int(sum(1 for _, label in observations if label > 0.5))
    summary = {
        "outputPath": str(output_path.resolve()),
        "feedbackPath": str(feedback_path.resolve()),
        "recordsScanned": counts["records"],
        "observationsUsed": counts["used"],
        "skippedNoConfidence": counts["skipped_no_confidence"],
        "skippedBadLabel": counts["skipped_bad_label"],
        "skippedHeuristicSource": counts["skipped_heuristic_source"],
        "positiveLabelRate": round(positive_count / len(observations), 4),
        "gridPoints": len(calibrator.thresholds),
        "monotone": calibrator.monotone,
    }
    return summary


def main() -> None:
    parser = argparse.ArgumentParser(description="Train the Lavish Fit isotonic calibration artifact.")
    parser.add_argument(
        "--feedback-path",
        type=Path,
        default=Path("train/data/fit_feedback_runtime.jsonl"),
        help="Path to the JSONL feedback log produced by FeedbackService.",
    )
    parser.add_argument(
        "--output-path",
        type=Path,
        default=Path("train/data/calibration.json"),
        help="Destination for the persisted IsotonicCalibrator JSON.",
    )
    parser.add_argument(
        "--min-observations",
        type=int,
        default=50,
        help="Minimum usable observations before a calibration artifact will be written.",
    )
    parser.add_argument(
        "--max-grid-points",
        type=int,
        default=64,
        help="Cap on the persisted isotonic grid size.",
    )
    args = parser.parse_args()

    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
    summary = train_calibration_artifact(
        args.feedback_path,
        args.output_path,
        min_observations=args.min_observations,
        max_grid_points=args.max_grid_points,
    )
    print(json.dumps(summary, indent=2))


if __name__ == "__main__":
    main()
