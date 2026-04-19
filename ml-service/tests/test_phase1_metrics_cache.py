from __future__ import annotations

import os
import unittest
from importlib import reload


VALID_RECOMMEND_PAYLOAD = {
    "mode": "manual",
    "product": {
        "id": "shirt-int-1",
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
    "userMetrics": {
        "heightCm": 178,
        "weightKg": 74,
        "preferredFit": "regular",
    },
}


def _build_app(env_overrides: dict[str, str]):
    cleared_env = {key: os.environ.pop(key, None) for key in list(os.environ) if key.startswith("ML_")}
    try:
        os.environ.update(env_overrides)
        from app.core import config as config_module

        reload(config_module)
        from app.core import metrics as metrics_module

        reload(metrics_module)
        from app.core import rate_limit as rate_limit_module

        reload(rate_limit_module)
        from app.services import model_service as model_service_module

        reload(model_service_module)
        model_service_module.model_service.load_model()
        from app.services import recommendation_service as recommendation_service_module

        reload(recommendation_service_module)
        from app.services import body_analysis as body_analysis_module

        reload(body_analysis_module)
        from app.utils import image_utils as image_utils_module

        reload(image_utils_module)
        from app.schemas import request_models as request_models_module

        reload(request_models_module)
        from app.api import routes as routes_module

        reload(routes_module)
        from app import main as main_module

        reload(main_module)
        return (
            main_module.app,
            model_service_module.model_service,
            rate_limit_module.rate_limiter,
            metrics_module.metrics,
            routes_module.recommendation_service,
        )
    finally:
        for key, value in cleared_env.items():
            if value is not None:
                os.environ.setdefault(key, value)


def _reset_to_defaults() -> None:
    for key in [k for k in os.environ if k.startswith("ML_")]:
        os.environ.pop(key, None)
    from app.core import config as config_module

    reload(config_module)
    from app.core import metrics as metrics_module

    reload(metrics_module)
    from app.services import model_service as model_service_module

    reload(model_service_module)
    from app.services import recommendation_service as recommendation_service_module

    reload(recommendation_service_module)
    from app.api import routes as routes_module

    reload(routes_module)


def tearDownModule() -> None:  # noqa: N802 - unittest hook
    _reset_to_defaults()


class MetricsEndpointTests(unittest.TestCase):
    def setUp(self) -> None:
        self.app, self.model_service, self.rate_limiter, self.metrics, self.recommendation_service = _build_app(
            {
                "ML_SERVICE_SHARED_SECRET": "phase-1-secret-value-32-chars-or-more",
                "ML_METRICS_ENABLED": "true",
                "ML_METRICS_REQUIRE_SECRET": "false",
                "ML_RATE_LIMIT_HEALTH_PER_MINUTE": "0",
                "ML_RATE_LIMIT_RECOMMEND_PER_MINUTE": "0",
                "ML_RATE_LIMIT_ANALYZE_PER_MINUTE": "0",
                "ML_RATE_LIMIT_ADMIN_PER_MINUTE": "0",
                "ML_RECOMMENDATION_CACHE_SIZE": "32",
                "ML_RECOMMENDATION_CACHE_TTL_SECONDS": "60",
            }
        )
        from fastapi.testclient import TestClient

        self.client = TestClient(self.app)
        self.secret_headers = {"x-ml-service-secret": "phase-1-secret-value-32-chars-or-more"}

    def tearDown(self) -> None:
        self.client.close()
        self.rate_limiter.reset()

    def test_metrics_endpoint_returns_prometheus_text(self) -> None:
        # Trigger a couple of requests so counters have non-zero values.
        self.client.get("/health")
        self.client.post("/recommend-size", json=VALID_RECOMMEND_PAYLOAD, headers=self.secret_headers)

        response = self.client.get("/metrics")
        self.assertEqual(response.status_code, 200)
        self.assertIn("text/plain", response.headers["content-type"])
        body = response.text
        self.assertIn("# TYPE ml_requests_total counter", body)
        self.assertIn('ml_requests_total{route="/health"', body)
        self.assertIn("# TYPE ml_request_duration_seconds histogram", body)
        self.assertIn("ml_recommendation_cache_total", body)
        self.assertIn("ml_predictions_total", body)
        self.assertIn("ml_process_uptime_seconds", body)

    def test_metrics_endpoint_can_be_disabled(self) -> None:
        disabled_app, _, limiter, _, _ = _build_app(
            {
                "ML_SERVICE_SHARED_SECRET": "phase-1-secret-value-32-chars-or-more",
                "ML_METRICS_ENABLED": "false",
                "ML_RATE_LIMIT_HEALTH_PER_MINUTE": "0",
                "ML_RATE_LIMIT_RECOMMEND_PER_MINUTE": "0",
                "ML_RATE_LIMIT_ANALYZE_PER_MINUTE": "0",
                "ML_RATE_LIMIT_ADMIN_PER_MINUTE": "0",
            }
        )
        from fastapi.testclient import TestClient

        try:
            with TestClient(disabled_app) as client:
                response = client.get("/metrics")
                self.assertEqual(response.status_code, 404)
        finally:
            limiter.reset()

    def test_recommendation_cache_returns_identical_response(self) -> None:
        first = self.client.post(
            "/recommend-size", json=VALID_RECOMMEND_PAYLOAD, headers=self.secret_headers
        )
        second = self.client.post(
            "/recommend-size", json=VALID_RECOMMEND_PAYLOAD, headers=self.secret_headers
        )
        self.assertEqual(first.status_code, 200)
        self.assertEqual(second.status_code, 200)
        self.assertEqual(first.json(), second.json())
        # Cache should now have at least one entry.
        self.assertGreaterEqual(len(self.recommendation_service.cache), 1)
        # Metrics should record a hit on the second call.
        metrics_body = self.client.get("/metrics").text
        self.assertIn('ml_recommendation_cache_total{result="hit"}', metrics_body)
        self.assertIn('ml_recommendation_cache_total{result="store"}', metrics_body)

    def test_cache_disabled_when_size_zero(self) -> None:
        disabled_app, _, limiter, _, recommendation_service = _build_app(
            {
                "ML_SERVICE_SHARED_SECRET": "phase-1-secret-value-32-chars-or-more",
                "ML_RECOMMENDATION_CACHE_SIZE": "0",
                "ML_RATE_LIMIT_HEALTH_PER_MINUTE": "0",
                "ML_RATE_LIMIT_RECOMMEND_PER_MINUTE": "0",
                "ML_RATE_LIMIT_ANALYZE_PER_MINUTE": "0",
                "ML_RATE_LIMIT_ADMIN_PER_MINUTE": "0",
            }
        )
        self.assertFalse(recommendation_service.cache.enabled)
        from fastapi.testclient import TestClient

        try:
            with TestClient(disabled_app) as client:
                response = client.post(
                    "/recommend-size",
                    json=VALID_RECOMMEND_PAYLOAD,
                    headers=self.secret_headers,
                )
                self.assertEqual(response.status_code, 200)
                self.assertEqual(len(recommendation_service.cache), 0)
        finally:
            limiter.reset()


class ModelPinningTests(unittest.TestCase):
    def test_sha256_mismatch_falls_back_to_heuristic(self) -> None:
        app, model_service, limiter, _, _ = _build_app(
            {
                "ML_SERVICE_SHARED_SECRET": "phase-1-secret-value-32-chars-or-more",
                "ML_EXPECTED_MODEL_SHA256": "0" * 64,
                "ML_WARM_UP_MODEL": "false",
                "ML_RATE_LIMIT_HEALTH_PER_MINUTE": "0",
                "ML_RATE_LIMIT_RECOMMEND_PER_MINUTE": "0",
                "ML_RATE_LIMIT_ANALYZE_PER_MINUTE": "0",
                "ML_RATE_LIMIT_ADMIN_PER_MINUTE": "0",
            }
        )
        try:
            from fastapi.testclient import TestClient

            with TestClient(app) as client:
                response = client.post(
                    "/recommend-size",
                    json=VALID_RECOMMEND_PAYLOAD,
                    headers={"x-ml-service-secret": "phase-1-secret-value-32-chars-or-more"},
                )
                self.assertEqual(response.status_code, 200)
                body = response.json()
                self.assertFalse(model_service.model_loaded)
                self.assertEqual(body["source"], "heuristic")
                self.assertEqual(body["meta"]["predictionSource"], "heuristic_fallback")
        finally:
            limiter.reset()

    def test_version_mismatch_falls_back_to_heuristic(self) -> None:
        app, model_service, limiter, _, _ = _build_app(
            {
                "ML_SERVICE_SHARED_SECRET": "phase-1-secret-value-32-chars-or-more",
                "ML_EXPECTED_MODEL_VERSION": "definitely-not-the-current-version",
                "ML_WARM_UP_MODEL": "false",
                "ML_RATE_LIMIT_HEALTH_PER_MINUTE": "0",
                "ML_RATE_LIMIT_RECOMMEND_PER_MINUTE": "0",
                "ML_RATE_LIMIT_ANALYZE_PER_MINUTE": "0",
                "ML_RATE_LIMIT_ADMIN_PER_MINUTE": "0",
            }
        )
        try:
            self.assertFalse(model_service.model_loaded)
            self.assertTrue(model_service.load_attempted)
        finally:
            limiter.reset()


if __name__ == "__main__":
    unittest.main()
