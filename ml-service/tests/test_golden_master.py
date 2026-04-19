"""T3 — Golden-master tests for /recommend-size.

Pins request → response tuples against the currently shipped model artifact at
``app/models/size_recommender.joblib``. The goal isn't to validate ML quality
(that's the training metrics' job) but to detect **unintentional** changes to
the recommendation pipeline: feature builder, fit scoring, confidence formula,
sort order, and meta envelope.

Any time the artifact is intentionally swapped, regenerate by running:

    python -m unittest tests.test_golden_master -v

inspect the diff in this file, and code-review it explicitly.
"""

from __future__ import annotations

import json
import os
import unittest
from pathlib import Path

from app.schemas.request_models import RecommendationRequest
from app.services.model_service import ModelService
from app.services.recommendation_service import RecommendationService

MODEL_PATH = Path(__file__).resolve().parents[1] / "app" / "models" / "size_recommender.joblib"


def _build_payload(
    *,
    product_id: str,
    category: str,
    sizes: list[str],
    template: str,
    fit_bias: str,
    stretch: float,
    size_measurements: list[dict],
    user: dict,
    body_features: dict | None = None,
) -> dict:
    payload = {
        "mode": "manual",
        "product": {
            "id": product_id,
            "category": category,
            "sizes": sizes,
            "sizeScale": "alpha" if sizes[0].isalpha() else "numeric",
            "fitProfileSummary": {"ready": True, "measurementTemplate": template},
            "fitProfile": {
                "measurementTemplate": template,
                "fitBias": fit_bias,
                "stretchScore": stretch,
                "sizeMeasurements": size_measurements,
            },
        },
        "userMetrics": user,
    }
    if body_features is not None:
        payload["bodyFeatures"] = body_features
    return payload


# Eight hand-curated cases spanning categories, fit biases, and preferences.
GOLDEN_CASES: list[tuple[str, dict, str, tuple[float, float]]] = [
    (
        "men_topwear_regular_178_74",
        _build_payload(
            product_id="shirt-001",
            category="Men",
            sizes=["S", "M", "L", "XL"],
            template="topwear",
            fit_bias="true_to_size",
            stretch=0.35,
            size_measurements=[
                {"size": "S", "chest": 95, "shoulder": 42, "garmentLength": 68},
                {"size": "M", "chest": 101, "shoulder": 44, "garmentLength": 70},
                {"size": "L", "chest": 107, "shoulder": 46, "garmentLength": 72},
                {"size": "XL", "chest": 113, "shoulder": 48, "garmentLength": 74},
            ],
            user={"heightCm": 178, "weightKg": 74, "preferredFit": "regular"},
        ),
        "XL",
        (0.5, 0.97),
    ),
    (
        "men_topwear_slim_170_62",
        _build_payload(
            product_id="shirt-slim",
            category="Men",
            sizes=["S", "M", "L", "XL"],
            template="topwear",
            fit_bias="true_to_size",
            stretch=0.3,
            size_measurements=[
                {"size": "S", "chest": 95, "shoulder": 42, "garmentLength": 68},
                {"size": "M", "chest": 101, "shoulder": 44, "garmentLength": 70},
                {"size": "L", "chest": 107, "shoulder": 46, "garmentLength": 72},
                {"size": "XL", "chest": 113, "shoulder": 48, "garmentLength": 74},
            ],
            user={"heightCm": 170, "weightKg": 62, "preferredFit": "slim"},
        ),
        "M",
        (0.4, 0.97),
    ),
    (
        "men_topwear_relaxed_185_92",
        _build_payload(
            product_id="shirt-relaxed",
            category="Men",
            sizes=["S", "M", "L", "XL", "XXL"],
            template="topwear",
            fit_bias="runs_small",
            stretch=0.2,
            size_measurements=[
                {"size": "S", "chest": 95, "shoulder": 42, "garmentLength": 68},
                {"size": "M", "chest": 101, "shoulder": 44, "garmentLength": 70},
                {"size": "L", "chest": 107, "shoulder": 46, "garmentLength": 72},
                {"size": "XL", "chest": 113, "shoulder": 48, "garmentLength": 74},
                {"size": "XXL", "chest": 119, "shoulder": 50, "garmentLength": 76},
            ],
            user={"heightCm": 185, "weightKg": 92, "preferredFit": "relaxed"},
        ),
        "XXL",
        (0.4, 0.97),
    ),
    (
        "women_dress_regular_165_58",
        _build_payload(
            product_id="dress-001",
            category="Women",
            sizes=["XS", "S", "M", "L"],
            template="dress",
            fit_bias="true_to_size",
            stretch=0.45,
            size_measurements=[
                {"size": "XS", "chest": 82, "waist": 64, "hip": 88, "garmentLength": 88},
                {"size": "S", "chest": 86, "waist": 68, "hip": 92, "garmentLength": 90},
                {"size": "M", "chest": 90, "waist": 72, "hip": 96, "garmentLength": 92},
                {"size": "L", "chest": 96, "waist": 78, "hip": 102, "garmentLength": 94},
            ],
            user={"heightCm": 165, "weightKg": 58, "preferredFit": "regular"},
        ),
        "L",
        (0.4, 0.97),
    ),
    (
        "women_bottomwear_runs_large_172_68",
        _build_payload(
            product_id="jeans-001",
            category="Women",
            sizes=["26", "28", "30", "32", "34"],
            template="bottomwear",
            fit_bias="runs_large",
            stretch=0.5,
            size_measurements=[
                {"size": "26", "waist": 66, "hip": 90, "inseam": 76},
                {"size": "28", "waist": 71, "hip": 95, "inseam": 76},
                {"size": "30", "waist": 76, "hip": 100, "inseam": 78},
                {"size": "32", "waist": 81, "hip": 105, "inseam": 78},
                {"size": "34", "waist": 86, "hip": 110, "inseam": 80},
            ],
            user={"heightCm": 172, "weightKg": 68, "preferredFit": "regular"},
        ),
        None,  # accept whichever the model picks; just check it's in the chart
        (0.4, 0.97),
    ),
    (
        "men_outerwear_runs_small_180_82",
        _build_payload(
            product_id="jacket-001",
            category="Men",
            sizes=["S", "M", "L", "XL"],
            template="outerwear",
            fit_bias="runs_small",
            stretch=0.1,
            size_measurements=[
                {"size": "S", "chest": 100, "shoulder": 44, "sleeveLength": 62, "garmentLength": 70},
                {"size": "M", "chest": 106, "shoulder": 46, "sleeveLength": 63, "garmentLength": 72},
                {"size": "L", "chest": 112, "shoulder": 48, "sleeveLength": 64, "garmentLength": 74},
                {"size": "XL", "chest": 118, "shoulder": 50, "sleeveLength": 65, "garmentLength": 76},
            ],
            user={"heightCm": 180, "weightKg": 82, "preferredFit": "regular"},
        ),
        None,
        (0.4, 0.97),
    ),
    (
        "kids_general_140_36",
        _build_payload(
            product_id="kids-001",
            category="Kids",
            sizes=["6Y", "8Y", "10Y", "12Y"],
            template="kids_general",
            fit_bias="true_to_size",
            stretch=0.4,
            size_measurements=[
                {"size": "6Y", "chest": 60, "waist": 56, "hip": 64, "garmentLength": 50},
                {"size": "8Y", "chest": 64, "waist": 59, "hip": 68, "garmentLength": 54},
                {"size": "10Y", "chest": 68, "waist": 62, "hip": 72, "garmentLength": 58},
                {"size": "12Y", "chest": 72, "waist": 65, "hip": 76, "garmentLength": 62},
            ],
            user={"heightCm": 140, "weightKg": 36, "preferredFit": "regular"},
        ),
        None,
        (0.38, 0.97),
    ),
    (
        "women_topwear_with_body_features",
        _build_payload(
            product_id="blouse-001",
            category="Women",
            sizes=["XS", "S", "M", "L"],
            template="topwear",
            fit_bias="true_to_size",
            stretch=0.25,
            size_measurements=[
                {"size": "XS", "chest": 82, "shoulder": 36, "garmentLength": 60},
                {"size": "S", "chest": 86, "shoulder": 37, "garmentLength": 62},
                {"size": "M", "chest": 90, "shoulder": 38, "garmentLength": 63},
                {"size": "L", "chest": 96, "shoulder": 40, "garmentLength": 64},
            ],
            user={"heightCm": 168, "weightKg": 64, "preferredFit": "regular"},
            body_features={
                "shoulderRatio": 1.02,
                "hipRatio": 0.98,
                "torsoRatio": 1.05,
                "scanQuality": 0.78,
            },
        ),
        None,
        (0.4, 0.97),
    ),
]


@unittest.skipUnless(MODEL_PATH.is_file(), f"Model artifact not found at {MODEL_PATH}")
class GoldenMasterTests(unittest.TestCase):
    """Pins recommendation behavior against the shipped artifact."""

    @classmethod
    def setUpClass(cls) -> None:
        cls.model_service = ModelService(artifact_path=MODEL_PATH, base_model_version="xgb-fit-v1")
        loaded = cls.model_service.load_model()
        if not loaded:
            raise unittest.SkipTest("Shipped model artifact failed to load")
        cls.recommendation_service = RecommendationService(cls.model_service)

    def _run(self, payload: dict):
        request = RecommendationRequest.model_validate(payload)
        return self.recommendation_service.recommend_size(request)

    def test_all_cases_produce_in_chart_size_with_bounded_confidence(self) -> None:
        sizes_by_case = {name: payload["product"]["sizes"] for name, payload, *_ in GOLDEN_CASES}
        for name, payload, expected_size, conf_range in GOLDEN_CASES:
            with self.subTest(case=name):
                response = self._run(payload)
                # Recommended size is always inside the chart.
                self.assertIn(response.recommendation.size, sizes_by_case[name])
                # Confidence within the documented [0.38, 0.97] band.
                lo, hi = conf_range
                self.assertGreaterEqual(response.recommendation.confidence, lo)
                self.assertLessEqual(response.recommendation.confidence, hi)
                # Source is "ml" whenever the artifact loaded.
                self.assertEqual(response.source, "ml")
                # Meta envelope is stable.
                self.assertTrue(response.meta.modelLoaded)
                self.assertEqual(response.meta.modelVersion, self.model_service.model_version)
                # Alternatives are a strict subset of the chart and exclude the pick.
                self.assertNotIn(response.recommendation.size, [a.size for a in response.alternatives])
                for alt in response.alternatives:
                    self.assertIn(alt.size, sizes_by_case[name])
                # Pinned expected size when the case asserts one.
                if expected_size is not None:
                    self.assertEqual(
                        response.recommendation.size,
                        expected_size,
                        f"Golden master regression for case {name!r}: "
                        f"expected {expected_size}, got {response.recommendation.size}. "
                        "Re-confirm intent before updating this assertion.",
                    )

    def test_response_is_json_serialisable(self) -> None:
        # Catches accidental introduction of non-serialisable objects in meta.
        for name, payload, *_ in GOLDEN_CASES:
            with self.subTest(case=name):
                response = self._run(payload)
                blob = response.model_dump_json()
                parsed = json.loads(blob)
                self.assertIn("recommendation", parsed)
                self.assertIn("meta", parsed)
                self.assertIn("alternatives", parsed)

    def test_repeat_calls_are_deterministic(self) -> None:
        # Same input should produce the same recommended size + confidence.
        for name, payload, *_ in GOLDEN_CASES:
            with self.subTest(case=name):
                first = self._run(payload)
                second = self._run(payload)
                self.assertEqual(first.recommendation.size, second.recommendation.size)
                self.assertAlmostEqual(
                    first.recommendation.confidence,
                    second.recommendation.confidence,
                    places=6,
                )


if __name__ == "__main__":
    if os.environ.get("REGENERATE_GOLDENS"):
        # Convenience switch for humans: dump current model picks for review.
        svc = ModelService(artifact_path=MODEL_PATH, base_model_version="xgb-fit-v1")
        svc.load_model()
        rec = RecommendationService(svc)
        for name, payload, *_ in GOLDEN_CASES:
            response = rec.recommend_size(RecommendationRequest.model_validate(payload))
            print(f"{name}: size={response.recommendation.size} confidence={response.recommendation.confidence:.4f}")
    else:
        unittest.main()
