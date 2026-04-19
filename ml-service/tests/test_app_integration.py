from __future__ import annotations

import base64
import os
import unittest
from importlib import reload
from unittest.mock import patch


SAMPLE_PNG_BYTES = bytes.fromhex(
    "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da6360"
    "60000000000400010000000000000000000049454e44ae426082"
)
SAMPLE_PNG_DATA_URL = "data:image/png;base64," + base64.b64encode(SAMPLE_PNG_BYTES).decode("ascii")


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
    """Reload the app modules with a clean settings snapshot for each test class."""

    cleared_env = {key: os.environ.pop(key, None) for key in list(os.environ) if key.startswith("ML_")}
    try:
        os.environ.update(env_overrides)
        from app.core import config as config_module

        reload(config_module)
        from app.core import rate_limit as rate_limit_module

        reload(rate_limit_module)
        from app.services import model_service as model_service_module

        reload(model_service_module)
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
        return main_module.app, model_service_module.model_service, rate_limit_module.rate_limiter
    finally:
        for key, value in cleared_env.items():
            if value is not None:
                os.environ.setdefault(key, value)


def tearDownModule() -> None:  # noqa: N802 - unittest hook
    for key in [k for k in os.environ if k.startswith("ML_")]:
        os.environ.pop(key, None)
    from app.core import config as config_module

    reload(config_module)
    from app.services import model_service as model_service_module

    reload(model_service_module)
    from app.services import recommendation_service as recommendation_service_module

    reload(recommendation_service_module)
    from app.api import routes as routes_module

    reload(routes_module)


class HealthAndReadyTests(unittest.TestCase):
    def setUp(self) -> None:
        self.app, self.model_service, self.rate_limiter = _build_app(
            {
                "ML_SERVICE_SHARED_SECRET": "",
                "ML_RATE_LIMIT_HEALTH_PER_MINUTE": "0",
            }
        )
        from fastapi.testclient import TestClient

        self.client = TestClient(self.app)

    def tearDown(self) -> None:
        self.client.close()
        self.rate_limiter.reset()

    def test_health_is_public_and_returns_metadata(self) -> None:
        response = self.client.get("/health")
        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(body["status"], "ok")
        self.assertIn("modelLoaded", body)
        self.assertIn("modelVersion", body)
        self.assertIn("x-request-id", response.headers)

    def test_ready_returns_starting_until_load_attempted(self) -> None:
        self.model_service._load_attempted = False
        response = self.client.get("/ready")
        self.assertEqual(response.status_code, 503)
        self.assertEqual(response.json()["status"], "starting")

    def test_request_id_is_propagated_from_caller(self) -> None:
        response = self.client.get("/health", headers={"x-request-id": "trace-abc-123"})
        self.assertEqual(response.headers["x-request-id"], "trace-abc-123")


class SecuredRoutesTests(unittest.TestCase):
    secret = "integration-test-secret-value-32-chars-or-more"

    def setUp(self) -> None:
        self.app, self.model_service, self.rate_limiter = _build_app(
            {
                "ML_SERVICE_SHARED_SECRET": self.secret,
                "ML_RATE_LIMIT_HEALTH_PER_MINUTE": "0",
                "ML_RATE_LIMIT_RECOMMEND_PER_MINUTE": "0",
                "ML_RATE_LIMIT_ANALYZE_PER_MINUTE": "0",
                "ML_RATE_LIMIT_ADMIN_PER_MINUTE": "0",
            }
        )
        from fastapi.testclient import TestClient

        self.client = TestClient(self.app)

    def tearDown(self) -> None:
        self.client.close()
        self.rate_limiter.reset()

    def _auth_headers(self) -> dict[str, str]:
        return {"x-ml-service-secret": self.secret}

    def test_recommend_size_requires_secret(self) -> None:
        response = self.client.post("/recommend-size", json=VALID_RECOMMEND_PAYLOAD)
        self.assertEqual(response.status_code, 401)

    def test_recommend_size_returns_recommendation(self) -> None:
        response = self.client.post(
            "/recommend-size", json=VALID_RECOMMEND_PAYLOAD, headers=self._auth_headers()
        )
        self.assertEqual(response.status_code, 200, response.text)
        body = response.json()
        self.assertIn(body["recommendation"]["size"], {"S", "M", "L", "XL"})
        self.assertGreaterEqual(body["recommendation"]["confidence"], 0.38)
        self.assertLessEqual(body["recommendation"]["confidence"], 0.97)
        self.assertIn(body["meta"]["predictionSource"], {"xgboost_regressor", "heuristic_fallback"})

    def test_recommend_size_rejects_unready_fit_profile(self) -> None:
        payload = {
            **VALID_RECOMMEND_PAYLOAD,
            "product": {
                **VALID_RECOMMEND_PAYLOAD["product"],
                "fitProfileSummary": {"ready": False, "measurementTemplate": "topwear"},
            },
        }
        response = self.client.post(
            "/recommend-size", json=payload, headers=self._auth_headers()
        )
        self.assertEqual(response.status_code, 422)
        body = response.json()
        self.assertIn("error", body)
        self.assertEqual(body["error"]["status"], 422)
        self.assertIn("requestId", body["error"])

    def test_analyze_body_landmark_path(self) -> None:
        landmarks = [{"x": 0.5, "y": 0.5, "visibility": 0.9} for _ in range(33)]
        landmarks[11] = {"x": 0.35, "y": 0.28, "visibility": 0.96}
        landmarks[12] = {"x": 0.65, "y": 0.28, "visibility": 0.94}
        landmarks[23] = {"x": 0.4, "y": 0.68, "visibility": 0.9}
        landmarks[24] = {"x": 0.6, "y": 0.68, "visibility": 0.92}

        response = self.client.post(
            "/analyze-body",
            json={"heightCm": 176, "landmarks": landmarks},
            headers=self._auth_headers(),
        )
        self.assertEqual(response.status_code, 200, response.text)
        body = response.json()
        self.assertEqual(body["meta"]["source"], "landmarks")
        self.assertGreater(body["bodyFeatures"]["scanQuality"], 0.8)

    def test_analyze_body_image_path(self) -> None:
        response = self.client.post(
            "/analyze-body",
            json={"heightCm": 168, "imageBase64": SAMPLE_PNG_DATA_URL},
            headers=self._auth_headers(),
        )
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()["meta"]["source"], "image_heuristic")

    def test_analyze_body_rejects_oversized_landmarks_payload(self) -> None:
        landmarks = [{"x": 0.5, "y": 0.5, "visibility": 0.9} for _ in range(200)]
        response = self.client.post(
            "/analyze-body",
            json={"heightCm": 170, "landmarks": landmarks},
            headers=self._auth_headers(),
        )
        self.assertEqual(response.status_code, 422)

    def test_analyze_body_rejects_invalid_image(self) -> None:
        response = self.client.post(
            "/analyze-body",
            json={"heightCm": 170, "imageBase64": "data:image/png;base64,not-base64!!"},
            headers=self._auth_headers(),
        )
        self.assertEqual(response.status_code, 422)

    def test_recommend_timeout_returns_504(self) -> None:
        # Build a separate app with a tiny timeout so the slow handler is forced to abort.
        slow_app, _, slow_limiter = _build_app(
            {
                "ML_SERVICE_SHARED_SECRET": self.secret,
                "ML_RECOMMEND_TIMEOUT_SECONDS": "0.05",
                "ML_RATE_LIMIT_RECOMMEND_PER_MINUTE": "0",
                "ML_RATE_LIMIT_HEALTH_PER_MINUTE": "0",
                "ML_RATE_LIMIT_ANALYZE_PER_MINUTE": "0",
                "ML_RATE_LIMIT_ADMIN_PER_MINUTE": "0",
            }
        )
        from app.api import routes as routes_module
        from fastapi.testclient import TestClient

        def slow_recommend(_payload):
            import time

            time.sleep(0.5)
            raise AssertionError("should have timed out")

        try:
            with patch.object(
                routes_module.recommendation_service, "recommend_size", side_effect=slow_recommend
            ):
                with TestClient(slow_app) as client:
                    response = client.post(
                        "/recommend-size",
                        json=VALID_RECOMMEND_PAYLOAD,
                        headers=self._auth_headers(),
                    )
            self.assertEqual(response.status_code, 504)
        finally:
            slow_limiter.reset()


class AdminAndRateLimitTests(unittest.TestCase):
    secret = "integration-secret-very-long-enough-value"
    admin_secret = "admin-secret-very-long-enough-value"

    def setUp(self) -> None:
        self.app, self.model_service, self.rate_limiter = _build_app(
            {
                "ML_SERVICE_SHARED_SECRET": self.secret,
                "ML_ADMIN_SECRET": self.admin_secret,
                "ML_RATE_LIMIT_RECOMMEND_PER_MINUTE": "2",
                "ML_RATE_LIMIT_HEALTH_PER_MINUTE": "0",
                "ML_RATE_LIMIT_ANALYZE_PER_MINUTE": "0",
                "ML_RATE_LIMIT_ADMIN_PER_MINUTE": "0",
            }
        )
        from fastapi.testclient import TestClient

        self.client = TestClient(self.app)

    def tearDown(self) -> None:
        self.client.close()
        self.rate_limiter.reset()

    def test_rate_limit_blocks_after_threshold(self) -> None:
        headers = {"x-ml-service-secret": self.secret}
        first = self.client.post("/recommend-size", json=VALID_RECOMMEND_PAYLOAD, headers=headers)
        second = self.client.post("/recommend-size", json=VALID_RECOMMEND_PAYLOAD, headers=headers)
        third = self.client.post("/recommend-size", json=VALID_RECOMMEND_PAYLOAD, headers=headers)
        self.assertEqual(first.status_code, 200)
        self.assertEqual(second.status_code, 200)
        self.assertEqual(third.status_code, 429)

    def test_admin_reload_requires_admin_secret(self) -> None:
        bad = self.client.post("/admin/reload-model", headers={"x-ml-admin-secret": "wrong"})
        self.assertEqual(bad.status_code, 401)

        ok = self.client.post(
            "/admin/reload-model", headers={"x-ml-admin-secret": self.admin_secret}
        )
        self.assertEqual(ok.status_code, 200)
        body = ok.json()
        self.assertIn("modelLoaded", body)
        self.assertIn("modelVersion", body)


if __name__ == "__main__":
    unittest.main()
