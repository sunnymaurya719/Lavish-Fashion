"""Improvement 1: break heuristic-feedback loop in calibration trainer.

Verifies ``collect_observations`` excludes feedback whose original
recommendation came from a heuristic engine, so the isotonic calibrator
is never trained on its own fallback output.
"""
from __future__ import annotations

from train.train_calibration import (
    HEURISTIC_PREDICTION_SOURCES,
    MODEL_BACKED_PREDICTION_SOURCES,
    _is_model_backed_record,
    collect_observations,
)


def _record(*, prediction_source=None, model_version=None, confidence=0.7,
            verdict="perfect", selected="M", recommended="M"):
    rec = {
        "feedback": verdict,
        "selectedSize": selected,
        "recommendedSize": recommended,
        "confidence": confidence,
    }
    if prediction_source is not None:
        rec["predictionSource"] = prediction_source
    if model_version is not None:
        rec["modelVersion"] = model_version
    return rec


class TestEngineClassification:
    def test_xgboost_source_is_model_backed(self):
        assert _is_model_backed_record(_record(prediction_source="xgboost_regressor"))

    def test_heuristic_sources_are_not_model_backed(self):
        for source in HEURISTIC_PREDICTION_SOURCES:
            assert not _is_model_backed_record(_record(prediction_source=source)), source

    def test_falls_back_to_model_version_when_source_missing(self):
        assert _is_model_backed_record(_record(model_version="xgb-fit-v1"))
        assert not _is_model_backed_record(_record(model_version="rule-engine-v1"))
        assert not _is_model_backed_record(_record(model_version="ml-fallback:xgb-fit-v1"))

    def test_no_signal_excluded(self):
        # No predictionSource AND no modelVersion -> conservative exclusion.
        assert not _is_model_backed_record(_record())

    def test_unknown_explicit_source_excluded(self):
        assert not _is_model_backed_record(_record(prediction_source="experimental_v9"))

    def test_constants_disjoint(self):
        assert MODEL_BACKED_PREDICTION_SOURCES.isdisjoint(HEURISTIC_PREDICTION_SOURCES)


class TestCollectObservationsFiltersHeuristicFeedback:
    def test_heuristic_feedback_skipped(self):
        records = [
            _record(prediction_source="xgboost_regressor", confidence=0.8),
            _record(prediction_source="heuristic_fallback", confidence=0.6),
            _record(prediction_source="rule_engine", confidence=0.5),
            _record(prediction_source="xgboost_regressor", confidence=0.7,
                    verdict="too_small", selected="L", recommended="M"),
        ]

        observations, counts = collect_observations(iter(records))

        assert counts["records"] == 4
        assert counts["skipped_heuristic_source"] == 2
        assert counts["used"] == 2
        assert len(observations) == 2

    def test_legacy_records_without_prediction_source_use_model_version(self):
        records = [
            _record(model_version="xgb-fit-v1", confidence=0.8),
            _record(model_version="rule-engine-v1", confidence=0.6),
            _record(model_version="", confidence=0.5),
        ]

        _, counts = collect_observations(iter(records))

        assert counts["used"] == 1
        assert counts["skipped_heuristic_source"] == 2
