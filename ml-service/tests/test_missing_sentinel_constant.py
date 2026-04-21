"""Improvement 2: NaN sentinel constant — verifies the centralised
missing-measurement sentinel resolves correctly in both modes."""
from __future__ import annotations

import math
from importlib import reload


def _reload_feature_builder():
    from app.core import config as config_module
    reload(config_module)
    from app.services import feature_builder
    reload(feature_builder)
    return feature_builder


def test_legacy_sentinel_is_minus_six_default(monkeypatch):
    monkeypatch.delenv("ML_FEATURE_NAN_MISSING", raising=False)
    feature_builder = _reload_feature_builder()

    assert feature_builder.LEGACY_MISSING_SENTINEL == -6.0
    assert math.isnan(feature_builder.NATIVE_MISSING_SENTINEL)
    assert feature_builder.get_missing_measurement_sentinel() == -6.0


def test_native_sentinel_is_nan_when_flag_enabled(monkeypatch):
    monkeypatch.setenv("ML_FEATURE_NAN_MISSING", "true")
    feature_builder = _reload_feature_builder()

    sentinel = feature_builder.get_missing_measurement_sentinel()
    assert math.isnan(sentinel)


def test_sentinel_used_in_feature_map(monkeypatch):
    """Smoke check: feature builder emits the sentinel for missing measurements."""
    monkeypatch.delenv("ML_FEATURE_NAN_MISSING", raising=False)
    feature_builder = _reload_feature_builder()

    # Build minimal inputs without importing pydantic schemas — feature_builder
    # treats inputs structurally (getattr-based).
    class _SizeEntry:
        size = "M"
        # Intentionally omit chest/waist/etc. to trigger the missing branch.

    class _UserMetrics:
        heightCm = 170
        weightKg = 65
        preferredFit = "regular"

    class _BodyFeatures:
        scanQuality = 0
        shoulderRatio = 1
        hipRatio = 1
        torsoRatio = 1

    feature_map = feature_builder.build_candidate_feature_map(
        size_entry=_SizeEntry(),
        user_metrics=_UserMetrics(),
        body_features=_BodyFeatures(),
        measurement_template="topwear",
        fit_bias="true_to_size",
        stretch_score=0.25,
        estimated_body_profile={
            "chest": 90,
            "waist": 75,
            "hip": 90,
            "shoulder": 42,
            "sleeveLength": 60,
            "inseam": 75,
            "garmentLength": 70,
            "bmi": 22,
        },
    )

    # All measurement deltas should equal the active sentinel.
    sentinel = feature_builder.get_missing_measurement_sentinel()
    for field in feature_builder.MEASUREMENT_FIELDS:
        assert feature_map[f"{field}Delta"] == sentinel
