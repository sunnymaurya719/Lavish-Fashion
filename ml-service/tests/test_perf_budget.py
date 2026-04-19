"""T4 — Performance budget tests.

Asserts p95 latency budgets for the hot paths:
  * /recommend-size with the model loaded   :  p95 ≤ 80ms
  * /analyze-body landmark branch           :  p95 ≤ 30ms

These budgets match SLOs in ``ML_SERVICE_DEEP_DIVE.md`` §19. Set
``SKIP_PERF=1`` in the environment to skip on slow CI runners.
"""

from __future__ import annotations

import os
import statistics
import time
import unittest
from pathlib import Path

from app.schemas.request_models import AnalyzeBodyRequest, RecommendationRequest
from app.services.body_analysis import analyze_body_request
from app.services.model_service import ModelService
from app.services.recommendation_service import RecommendationService

MODEL_PATH = Path(__file__).resolve().parents[1] / "app" / "models" / "size_recommender.joblib"

RECOMMEND_BUDGET_MS = float(os.environ.get("PERF_RECOMMEND_BUDGET_MS", "80"))
ANALYZE_BUDGET_MS = float(os.environ.get("PERF_ANALYZE_BUDGET_MS", "30"))
ITERATIONS = int(os.environ.get("PERF_ITERATIONS", "200"))
WARMUP = int(os.environ.get("PERF_WARMUP", "20"))


RECOMMEND_PAYLOAD = {
    "mode": "manual",
    "product": {
        "id": "perf-shirt-001",
        "category": "Men",
        "sizes": ["S", "M", "L", "XL"],
        "sizeScale": "alpha",
        "fitProfileSummary": {"ready": True, "measurementTemplate": "topwear"},
        "fitProfile": {
            "measurementTemplate": "topwear",
            "fitBias": "true_to_size",
            "stretchScore": 0.35,
            "sizeMeasurements": [
                {"size": "S", "chest": 95, "shoulder": 42, "garmentLength": 68},
                {"size": "M", "chest": 101, "shoulder": 44, "garmentLength": 70},
                {"size": "L", "chest": 107, "shoulder": 46, "garmentLength": 72},
                {"size": "XL", "chest": 113, "shoulder": 48, "garmentLength": 74},
            ],
        },
    },
    "userMetrics": {"heightCm": 178, "weightKg": 74, "preferredFit": "regular"},
}


def _synthetic_landmarks() -> list[dict[str, float]]:
    """33 BlazePose-style landmarks with shoulders/hips populated."""
    landmarks: list[dict[str, float]] = []
    for idx in range(33):
        landmarks.append({"x": 0.5, "y": 0.5, "z": 0.0, "visibility": 0.9})
    landmarks[11] = {"x": 0.42, "y": 0.30, "z": 0.0, "visibility": 0.95}
    landmarks[12] = {"x": 0.58, "y": 0.30, "z": 0.0, "visibility": 0.95}
    landmarks[23] = {"x": 0.45, "y": 0.62, "z": 0.0, "visibility": 0.92}
    landmarks[24] = {"x": 0.55, "y": 0.62, "z": 0.0, "visibility": 0.92}
    return landmarks


ANALYZE_PAYLOAD = {"heightCm": 176, "landmarks": _synthetic_landmarks()}


def _percentile(samples: list[float], pct: float) -> float:
    if not samples:
        return 0.0
    ordered = sorted(samples)
    k = max(0, min(len(ordered) - 1, int(round((pct / 100.0) * (len(ordered) - 1)))))
    return ordered[k]


def _measure(callable_, iterations: int, warmup: int) -> dict[str, float]:
    for _ in range(warmup):
        callable_()
    samples_ms: list[float] = []
    for _ in range(iterations):
        start = time.perf_counter()
        callable_()
        samples_ms.append((time.perf_counter() - start) * 1000.0)
    return {
        "p50": _percentile(samples_ms, 50),
        "p95": _percentile(samples_ms, 95),
        "p99": _percentile(samples_ms, 99),
        "mean": statistics.fmean(samples_ms),
        "max": max(samples_ms),
        "n": float(len(samples_ms)),
    }


@unittest.skipIf(os.environ.get("SKIP_PERF") == "1", "SKIP_PERF=1 set")
class PerformanceBudgetTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        if not MODEL_PATH.is_file():
            raise unittest.SkipTest(f"Model artifact missing at {MODEL_PATH}")
        cls.model_service = ModelService(artifact_path=MODEL_PATH, base_model_version="xgb-fit-v1")
        if not cls.model_service.load_model():
            raise unittest.SkipTest("Model artifact failed to load")
        cls.recommendation_service = RecommendationService(cls.model_service)
        cls.recommend_request = RecommendationRequest.model_validate(RECOMMEND_PAYLOAD)
        cls.analyze_request = AnalyzeBodyRequest.model_validate(ANALYZE_PAYLOAD)

    def test_recommend_size_p95_within_budget(self) -> None:
        stats = _measure(
            lambda: self.recommendation_service.recommend_size(self.recommend_request),
            iterations=ITERATIONS,
            warmup=WARMUP,
        )
        self.addDetail("recommend_size", stats)
        self.assertLessEqual(
            stats["p95"],
            RECOMMEND_BUDGET_MS,
            f"recommend_size p95={stats['p95']:.2f}ms exceeds budget "
            f"{RECOMMEND_BUDGET_MS}ms (mean={stats['mean']:.2f}ms, p99={stats['p99']:.2f}ms)",
        )

    def test_analyze_body_landmarks_p95_within_budget(self) -> None:
        stats = _measure(
            lambda: analyze_body_request(self.analyze_request),
            iterations=ITERATIONS,
            warmup=WARMUP,
        )
        self.addDetail("analyze_body_landmarks", stats)
        self.assertLessEqual(
            stats["p95"],
            ANALYZE_BUDGET_MS,
            f"analyze_body p95={stats['p95']:.2f}ms exceeds budget "
            f"{ANALYZE_BUDGET_MS}ms (mean={stats['mean']:.2f}ms, p99={stats['p99']:.2f}ms)",
        )

    # unittest doesn't have a native "details" hook; just print under -v.
    def addDetail(self, name: str, stats: dict[str, float]) -> None:
        if os.environ.get("PERF_VERBOSE") == "1" or os.environ.get("UNITTEST_VERBOSE") == "1":
            print(
                f"\n[perf] {name}: n={int(stats['n'])} "
                f"p50={stats['p50']:.2f}ms p95={stats['p95']:.2f}ms "
                f"p99={stats['p99']:.2f}ms mean={stats['mean']:.2f}ms max={stats['max']:.2f}ms"
            )


if __name__ == "__main__":
    unittest.main()
