from __future__ import annotations

import json
import os
import tempfile
import unittest
from importlib import reload
from pathlib import Path


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

SECRET = "phase-2-secret-value-32-chars-or-more"


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
        from app.schemas import request_models as request_models_module

        reload(request_models_module)
        from app.schemas import response_models as response_models_module

        reload(response_models_module)
        from app.services import model_service as model_service_module

        reload(model_service_module)
        model_service_module.model_service.load_model()
        from app.services import feedback_service as feedback_service_module

        reload(feedback_service_module)
        from app.services import recommendation_service as recommendation_service_module

        reload(recommendation_service_module)
        from app.services import body_analysis as body_analysis_module

        reload(body_analysis_module)
        from app.utils import image_utils as image_utils_module

        reload(image_utils_module)
        from app.api import routes as routes_module

        reload(routes_module)
        from app import main as main_module

        reload(main_module)
        return (
            main_module.app,
            rate_limit_module.rate_limiter,
            feedback_service_module.feedback_service,
            routes_module.recommendation_service,
        )
    finally:
        for key, value in cleared_env.items():
            if value is not None:
                os.environ.setdefault(key, value)


def tearDownModule() -> None:  # noqa: N802 - unittest hook
    for key in [k for k in os.environ if k.startswith("ML_")]:
        os.environ.pop(key, None)
    from app.core import config as config_module

    reload(config_module)
    from app.core import metrics as metrics_module

    reload(metrics_module)
    from app.services import model_service as model_service_module

    reload(model_service_module)
    from app.services import feedback_service as feedback_service_module

    reload(feedback_service_module)
    from app.services import recommendation_service as recommendation_service_module

    reload(recommendation_service_module)
    from app.api import routes as routes_module

    reload(routes_module)


class FeedbackEndpointTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tempdir = tempfile.TemporaryDirectory()
        self.feedback_path = Path(self.tempdir.name) / "fit_feedback.jsonl"
        self.app, self.rate_limiter, self.feedback_service, _ = _build_app(
            {
                "ML_SERVICE_SHARED_SECRET": SECRET,
                "ML_FEEDBACK_LOG_PATH": str(self.feedback_path),
                "ML_RATE_LIMIT_HEALTH_PER_MINUTE": "0",
                "ML_RATE_LIMIT_RECOMMEND_PER_MINUTE": "0",
                "ML_RATE_LIMIT_ANALYZE_PER_MINUTE": "0",
                "ML_RATE_LIMIT_ADMIN_PER_MINUTE": "0",
                "ML_RATE_LIMIT_FEEDBACK_PER_MINUTE": "0",
            }
        )
        from fastapi.testclient import TestClient

        self.client = TestClient(self.app)
        self.headers = {"x-ml-service-secret": SECRET}

    def tearDown(self) -> None:
        self.client.close()
        self.rate_limiter.reset()
        self.tempdir.cleanup()

    def _payload(self, **overrides) -> dict:
        base = {
            "userId": "user-12345",
            "productId": "product-12345",
            "orderId": "order-12345",
            "selectedSize": "M",
            "recommendedSize": "L",
            "feedback": "too_small",
            "source": "manual",
            "confidence": 0.78,
            "modelVersion": "xgb-fit-test",
        }
        base.update(overrides)
        return base

    def test_feedback_requires_secret(self) -> None:
        response = self.client.post("/feedback", json=self._payload())
        self.assertEqual(response.status_code, 401)

    def test_feedback_persists_jsonl_record(self) -> None:
        response = self.client.post("/feedback", json=self._payload(), headers=self.headers)
        self.assertEqual(response.status_code, 200, response.text)
        body = response.json()
        self.assertTrue(body["accepted"])
        self.assertTrue(body["persisted"])
        self.assertTrue(self.feedback_path.exists())
        lines = self.feedback_path.read_text(encoding="utf-8").strip().splitlines()
        self.assertEqual(len(lines), 1)
        record = json.loads(lines[0])
        self.assertEqual(record["userId"], "user-12345")
        self.assertEqual(record["feedback"], "too_small")
        self.assertEqual(record["selectedSize"], "M")
        self.assertIn("receivedAt", record)
        self.assertIn("requestId", record)

    def test_feedback_rejects_invalid_verdict(self) -> None:
        response = self.client.post(
            "/feedback", json=self._payload(feedback="meh"), headers=self.headers
        )
        self.assertEqual(response.status_code, 422)

    def test_feedback_accepts_when_persistence_disabled(self) -> None:
        app, limiter, _, _ = _build_app(
            {
                "ML_SERVICE_SHARED_SECRET": SECRET,
                "ML_FEEDBACK_LOG_PATH": "",
                "ML_RATE_LIMIT_HEALTH_PER_MINUTE": "0",
                "ML_RATE_LIMIT_RECOMMEND_PER_MINUTE": "0",
                "ML_RATE_LIMIT_ANALYZE_PER_MINUTE": "0",
                "ML_RATE_LIMIT_ADMIN_PER_MINUTE": "0",
                "ML_RATE_LIMIT_FEEDBACK_PER_MINUTE": "0",
            }
        )
        from fastapi.testclient import TestClient

        try:
            with TestClient(app) as client:
                response = client.post("/feedback", json=self._payload(), headers=self.headers)
                self.assertEqual(response.status_code, 200)
                body = response.json()
                self.assertTrue(body["accepted"])
                self.assertFalse(body["persisted"])
        finally:
            limiter.reset()


class BatchRecommendationTests(unittest.TestCase):
    def setUp(self) -> None:
        self.app, self.rate_limiter, _, self.recommendation_service = _build_app(
            {
                "ML_SERVICE_SHARED_SECRET": SECRET,
                "ML_FEEDBACK_LOG_PATH": "",
                "ML_RATE_LIMIT_HEALTH_PER_MINUTE": "0",
                "ML_RATE_LIMIT_RECOMMEND_PER_MINUTE": "0",
                "ML_RATE_LIMIT_ANALYZE_PER_MINUTE": "0",
                "ML_RATE_LIMIT_ADMIN_PER_MINUTE": "0",
                "ML_RATE_LIMIT_FEEDBACK_PER_MINUTE": "0",
                "ML_RECOMMEND_BATCH_MAX_ITEMS": "4",
            }
        )
        from fastapi.testclient import TestClient

        self.client = TestClient(self.app)
        self.headers = {"x-ml-service-secret": SECRET}

    def tearDown(self) -> None:
        self.client.close()
        self.rate_limiter.reset()

    def test_batch_returns_per_item_results(self) -> None:
        invalid_request = {
            **VALID_RECOMMEND_PAYLOAD,
            "product": {
                **VALID_RECOMMEND_PAYLOAD["product"],
                "fitProfileSummary": {"ready": False, "measurementTemplate": "topwear"},
            },
        }
        response = self.client.post(
            "/recommend-size:batch",
            headers=self.headers,
            json={
                "items": [
                    {"key": "ok-1", "request": VALID_RECOMMEND_PAYLOAD},
                    {"key": "ok-2", "request": VALID_RECOMMEND_PAYLOAD},
                    {"key": "bad-1", "request": invalid_request},
                ]
            },
        )
        self.assertEqual(response.status_code, 200, response.text)
        body = response.json()
        self.assertEqual(body["count"], 3)
        self.assertEqual(body["successCount"], 2)
        self.assertEqual(body["failureCount"], 1)
        keys = {item["key"]: item for item in body["items"]}
        self.assertTrue(keys["ok-1"]["success"])
        self.assertTrue(keys["ok-2"]["success"])
        self.assertFalse(keys["bad-1"]["success"])
        self.assertEqual(keys["bad-1"]["statusCode"], 422)
        self.assertIsNotNone(keys["ok-1"]["response"])

    def test_batch_rejects_oversized_payload(self) -> None:
        items = [
            {"key": f"k-{index}", "request": VALID_RECOMMEND_PAYLOAD}
            for index in range(10)
        ]
        response = self.client.post(
            "/recommend-size:batch", headers=self.headers, json={"items": items}
        )
        self.assertEqual(response.status_code, 422)

    def test_batch_requires_at_least_one_item(self) -> None:
        response = self.client.post(
            "/recommend-size:batch", headers=self.headers, json={"items": []}
        )
        self.assertEqual(response.status_code, 422)


class VersionEndpointTests(unittest.TestCase):
    def setUp(self) -> None:
        self.app, self.rate_limiter, _, _ = _build_app(
            {
                "ML_SERVICE_SHARED_SECRET": SECRET,
                "ML_FEEDBACK_LOG_PATH": "",
                "ML_GIT_SHA": "deadbeefcafefeed",
                "ML_BUILD_LABEL": "phase-2-test-build",
                "ML_RATE_LIMIT_HEALTH_PER_MINUTE": "0",
                "ML_RATE_LIMIT_RECOMMEND_PER_MINUTE": "0",
                "ML_RATE_LIMIT_ANALYZE_PER_MINUTE": "0",
                "ML_RATE_LIMIT_ADMIN_PER_MINUTE": "0",
                "ML_RATE_LIMIT_FEEDBACK_PER_MINUTE": "0",
            }
        )
        from fastapi.testclient import TestClient

        self.client = TestClient(self.app)

    def tearDown(self) -> None:
        self.client.close()
        self.rate_limiter.reset()

    def test_version_returns_provenance(self) -> None:
        response = self.client.get("/version")
        self.assertEqual(response.status_code, 200, response.text)
        body = response.json()
        self.assertEqual(body["gitSha"], "deadbeefcafefeed")
        self.assertEqual(body["buildLabel"], "phase-2-test-build")
        self.assertIn("modelVersion", body)
        self.assertIn("modelLoaded", body)
        self.assertRegex(body["pythonVersion"], r"^\d+\.\d+\.\d+$")


if __name__ == "__main__":
    unittest.main()
