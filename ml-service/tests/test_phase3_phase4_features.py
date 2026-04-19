"""Phase 3 + Phase 4 acceptance tests.

Covers:
* M3 — isotonic calibration (offline fit + runtime apply).
* M4 — NaN sentinel for missing measurements when ``ML_FEATURE_NAN_MISSING``.
* M7 — shadow-model loading + score-delta telemetry.
* M8 — canary tolerance refusal on reload.
* A1 — ``/v1/`` route aliases.
* A2 — typed ``AnalyzeBodyMeta`` envelope.
* A4 — ``Idempotency-Key`` replay safety + conflict detection.
* B3 — multi-frame fusion via ``frames`` array.
* B4 — landmark visibility quality gate.
* B5 — JPEG EXIF orientation parsing.
* G-Priv-2 — ``POST /forget`` privacy purge.
"""

from __future__ import annotations

import base64
import io
import json
import math
import os
import struct
import tempfile
import unittest
from importlib import reload
from pathlib import Path

import joblib


SECRET = "phase-three-secret-value-32-chars"
ADMIN_SECRET = "phase-three-admin-secret-32chars!"


VALID_RECOMMEND_PAYLOAD = {
    "mode": "manual",
    "product": {
        "id": "shirt-v1-1",
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


SAMPLE_PNG_BYTES = bytes.fromhex(
    "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da6360"
    "60000000000400010000000000000000000049454e44ae426082"
)
SAMPLE_PNG_DATA_URL = "data:image/png;base64," + base64.b64encode(SAMPLE_PNG_BYTES).decode("ascii")


def _build_app(env_overrides: dict[str, str]):
    cleared = {key: os.environ.pop(key, None) for key in list(os.environ) if key.startswith("ML_")}
    try:
        os.environ.update(env_overrides)
        from app.core import config as config_module
        reload(config_module)
        from app.core import metrics as metrics_module
        reload(metrics_module)
        from app.core import rate_limit as rate_limit_module
        reload(rate_limit_module)
        from app.core import idempotency as idempotency_module
        reload(idempotency_module)
        from app.schemas import request_models as request_models_module
        reload(request_models_module)
        from app.schemas import response_models as response_models_module
        reload(response_models_module)
        from app.services import calibration as calibration_module
        reload(calibration_module)
        from app.services import model_service as model_service_module
        reload(model_service_module)
        model_service_module.model_service.load_model()
        from app.services import feedback_service as feedback_service_module
        reload(feedback_service_module)
        from app.services import recommendation_service as recommendation_service_module
        reload(recommendation_service_module)
        from app.utils import image_utils as image_utils_module
        reload(image_utils_module)
        from app.services import body_analysis as body_analysis_module
        reload(body_analysis_module)
        from app.api import routes as routes_module
        reload(routes_module)
        from app import main as main_module
        reload(main_module)
        return (
            main_module.app,
            rate_limit_module.rate_limiter,
            calibration_module.calibration_service,
            model_service_module.model_service,
            routes_module.recommendation_service,
            routes_module.idempotency_cache,
            feedback_service_module.feedback_service,
        )
    finally:
        for key, value in cleared.items():
            if value is not None:
                os.environ.setdefault(key, value)


def tearDownModule() -> None:  # noqa: N802 - unittest hook
    for key in [k for k in os.environ if k.startswith("ML_")]:
        os.environ.pop(key, None)
    for module_name in (
        "app.core.config",
        "app.core.metrics",
        "app.core.rate_limit",
        "app.core.idempotency",
        "app.schemas.request_models",
        "app.schemas.response_models",
        "app.services.calibration",
        "app.services.model_service",
        "app.services.feedback_service",
        "app.services.recommendation_service",
        "app.utils.image_utils",
        "app.services.body_analysis",
        "app.api.routes",
        "app.main",
    ):
        import importlib
        try:
            module = importlib.import_module(module_name)
            importlib.reload(module)
        except Exception:
            pass


class IsotonicCalibrationTests(unittest.TestCase):
    def test_pava_produces_monotone_decreasing_curve(self) -> None:
        from app.services.calibration import IsotonicCalibrator

        # Lower |fitScore| → higher correctness probability.
        observations = [
            (0.1, 1), (0.2, 1), (0.3, 1), (0.4, 0),
            (0.6, 1), (0.8, 0), (1.2, 0), (1.6, 0),
            (2.0, 0), (2.5, 0),
        ]
        calibrator = IsotonicCalibrator.fit(observations, monotone="decreasing")
        self.assertTrue(calibrator.is_fitted)
        # Monotone non-increasing.
        for index in range(1, len(calibrator.probabilities)):
            self.assertLessEqual(calibrator.probabilities[index], calibrator.probabilities[index - 1] + 1e-9)
        # Boundary values.
        self.assertAlmostEqual(calibrator.apply(0.0), calibrator.probabilities[0])
        self.assertAlmostEqual(calibrator.apply(5.0), calibrator.probabilities[-1])
        # Monotone apply between boundary values.
        self.assertGreater(calibrator.apply(0.2), calibrator.apply(2.0))

    def test_calibration_service_round_trips_via_disk(self) -> None:
        from app.services.calibration import IsotonicCalibrator, CalibrationService

        calibrator = IsotonicCalibrator(
            thresholds=[0.0, 0.5, 1.5, 3.0],
            probabilities=[0.95, 0.7, 0.4, 0.1],
        )
        with tempfile.TemporaryDirectory() as tmpdir:
            artifact_path = Path(tmpdir) / "calibration.json"
            calibrator.save(artifact_path)
            service = CalibrationService()
            self.assertTrue(service.load(artifact_path))
            self.assertTrue(service.loaded)
            self.assertAlmostEqual(service.calibrate(0.0), 0.95)
            self.assertLess(service.calibrate(2.0), service.calibrate(0.5))


class FeatureNanMissingTests(unittest.TestCase):
    def setUp(self) -> None:
        os.environ["ML_FEATURE_NAN_MISSING"] = "true"
        from app.core import config as config_module
        reload(config_module)
        from app.services import feature_builder as feature_builder_module
        reload(feature_builder_module)
        self.feature_builder = feature_builder_module

    def tearDown(self) -> None:
        os.environ.pop("ML_FEATURE_NAN_MISSING", None)
        from app.core import config as config_module
        reload(config_module)
        from app.services import feature_builder as feature_builder_module
        reload(feature_builder_module)

    def test_missing_measurement_emits_nan_when_flag_enabled(self) -> None:
        from app.schemas.request_models import (
            ProductFitProfile,
            SizeMeasurement,
            UserMetricsInput,
        )

        size_entry = SizeMeasurement(size="M", chest=None, waist=None, shoulder=44)
        # Build a minimal candidate via build_feature_map directly.
        from app.services.feature_builder import build_candidate_feature_map, estimate_body_profile

        body_profile = estimate_body_profile(
            height_cm=178,
            weight_kg=74,
            category="Men",
            preferred_fit="regular",
            body_features=None,
        )
        feature_map = build_candidate_feature_map(
            size_entry=size_entry,
            measurement_template="topwear",
            fit_bias="true_to_size",
            stretch_score=0.35,
            user_metrics=UserMetricsInput(heightCm=178, weightKg=74),
            estimated_body_profile=body_profile,
            body_features=None,
        )
        chest_delta = feature_map.get("chestDelta")
        self.assertIsNotNone(chest_delta)
        self.assertTrue(math.isnan(chest_delta))


class V1AliasAndIdempotencyTests(unittest.TestCase):
    def setUp(self) -> None:
        (
            self.app,
            self.rate_limiter,
            self.calibration,
            self.model_service,
            self.recommendation_service,
            self.idempotency_cache,
            _feedback,
        ) = _build_app(
            {
                "ML_SERVICE_SHARED_SECRET": SECRET,
                "ML_ADMIN_SECRET": ADMIN_SECRET,
                "ML_RATE_LIMIT_HEALTH_PER_MINUTE": "0",
                "ML_RATE_LIMIT_RECOMMEND_PER_MINUTE": "0",
                "ML_RATE_LIMIT_ANALYZE_PER_MINUTE": "0",
                "ML_RATE_LIMIT_ADMIN_PER_MINUTE": "0",
                "ML_RATE_LIMIT_FEEDBACK_PER_MINUTE": "0",
                "ML_IDEMPOTENCY_CACHE_SIZE": "32",
                "ML_IDEMPOTENCY_CACHE_TTL_SECONDS": "60",
                "ML_ENABLE_V1_ALIASES": "true",
            }
        )
        from fastapi.testclient import TestClient
        self.client = TestClient(self.app)

    def tearDown(self) -> None:
        self.client.close()
        self.rate_limiter.reset()

    def _auth(self) -> dict[str, str]:
        return {"x-ml-service-secret": SECRET}

    def test_v1_alias_returns_same_payload_as_unversioned(self) -> None:
        original = self.client.post(
            "/recommend-size", json=VALID_RECOMMEND_PAYLOAD, headers=self._auth()
        )
        aliased = self.client.post(
            "/v1/recommend-size", json=VALID_RECOMMEND_PAYLOAD, headers=self._auth()
        )
        self.assertEqual(original.status_code, 200, original.text)
        self.assertEqual(aliased.status_code, 200, aliased.text)
        self.assertEqual(
            original.json()["recommendation"]["size"],
            aliased.json()["recommendation"]["size"],
        )

    def test_idempotency_replay_returns_cached_response(self) -> None:
        headers = {**self._auth(), "Idempotency-Key": "request-abc"}
        first = self.client.post("/recommend-size", json=VALID_RECOMMEND_PAYLOAD, headers=headers)
        second = self.client.post("/recommend-size", json=VALID_RECOMMEND_PAYLOAD, headers=headers)
        self.assertEqual(first.status_code, 200, first.text)
        self.assertEqual(second.status_code, 200, second.text)
        self.assertEqual(first.json(), second.json())
        self.assertEqual(second.headers.get("x-idempotency-cache"), "hit")

    def test_idempotency_conflict_when_payload_differs(self) -> None:
        headers = {**self._auth(), "Idempotency-Key": "conflict-key-1"}
        self.client.post("/recommend-size", json=VALID_RECOMMEND_PAYLOAD, headers=headers)
        mutated = json.loads(json.dumps(VALID_RECOMMEND_PAYLOAD))
        mutated["userMetrics"]["heightCm"] = 165
        response = self.client.post("/recommend-size", json=mutated, headers=headers)
        self.assertEqual(response.status_code, 409, response.text)


class AnalyzeBodyMetaTests(unittest.TestCase):
    def setUp(self) -> None:
        (
            self.app,
            self.rate_limiter,
            *_rest,
        ) = _build_app(
            {
                "ML_SERVICE_SHARED_SECRET": SECRET,
                "ML_RATE_LIMIT_HEALTH_PER_MINUTE": "0",
                "ML_RATE_LIMIT_ANALYZE_PER_MINUTE": "0",
            }
        )
        from fastapi.testclient import TestClient
        self.client = TestClient(self.app)

    def tearDown(self) -> None:
        self.client.close()
        self.rate_limiter.reset()

    def _auth(self) -> dict[str, str]:
        return {"x-ml-service-secret": SECRET}

    def test_landmark_meta_envelope_is_typed(self) -> None:
        landmarks = [{"x": 0.5, "y": 0.5, "visibility": 0.92} for _ in range(33)]
        landmarks[11] = {"x": 0.35, "y": 0.28, "visibility": 0.96}
        landmarks[12] = {"x": 0.65, "y": 0.28, "visibility": 0.95}
        landmarks[23] = {"x": 0.40, "y": 0.68, "visibility": 0.93}
        landmarks[24] = {"x": 0.60, "y": 0.68, "visibility": 0.93}
        response = self.client.post(
            "/analyze-body",
            json={"heightCm": 176, "landmarks": landmarks},
            headers=self._auth(),
        )
        self.assertEqual(response.status_code, 200, response.text)
        body = response.json()
        self.assertEqual(body["meta"]["source"], "landmarks")
        self.assertEqual(body["meta"]["landmarkCount"], 33)
        self.assertGreater(body["meta"]["landmarkAvgVisibility"], 0.85)
        self.assertEqual(body["meta"]["frameCount"], 0)

    def test_low_visibility_landmarks_rejected_with_reason(self) -> None:
        landmarks = [{"x": 0.5, "y": 0.5, "visibility": 0.1} for _ in range(33)]
        landmarks[11] = {"x": 0.35, "y": 0.28, "visibility": 0.05}
        landmarks[12] = {"x": 0.65, "y": 0.28, "visibility": 0.05}
        landmarks[23] = {"x": 0.40, "y": 0.68, "visibility": 0.05}
        landmarks[24] = {"x": 0.60, "y": 0.68, "visibility": 0.05}
        response = self.client.post(
            "/analyze-body",
            json={"heightCm": 176, "landmarks": landmarks},
            headers=self._auth(),
        )
        self.assertEqual(response.status_code, 422, response.text)
        body = response.json()
        # FastAPI wraps detail into {"detail": ...}; our errorHandler middleware then
        # repackages with {"error": {...}}; check both shapes.
        if "detail" in body:
            self.assertEqual(body["detail"].get("reason"), "low_visibility")
        else:
            self.assertEqual(body["error"]["detail"]["reason"], "low_visibility")

    def test_multi_frame_fusion_returns_frame_metadata(self) -> None:
        response = self.client.post(
            "/analyze-body",
            json={
                "heightCm": 168,
                "frames": [SAMPLE_PNG_DATA_URL, SAMPLE_PNG_DATA_URL, SAMPLE_PNG_DATA_URL],
            },
            headers=self._auth(),
        )
        self.assertEqual(response.status_code, 200, response.text)
        meta = response.json()["meta"]
        self.assertEqual(meta["source"], "frames_fused")
        self.assertEqual(meta["frameCount"], 3)
        self.assertGreater(meta["frameAgreement"], 0.5)


class ExifOrientationTests(unittest.TestCase):
    def test_jpeg_with_orientation_tag_swaps_dimensions(self) -> None:
        # Construct a minimal JPEG with EXIF Orientation=6 (rotated 90° CW). The
        # SOF0 segment encodes height=200 width=400. After applying orientation
        # the parsed dimensions should be (200, 400).
        soi = b"\xff\xd8"
        # APP1 segment with EXIF marker, TIFF header (II), 1 IFD entry: Orientation=6
        exif_payload = b"Exif\x00\x00"
        tiff_header = b"II" + struct.pack("<H", 0x002A) + struct.pack("<I", 8)
        # 1 IFD entry, then 4-byte next-IFD offset
        ifd = struct.pack("<H", 1)
        ifd += struct.pack("<HHII", 0x0112, 3, 1, 6)  # tag, type=SHORT, count=1, value=6
        ifd += struct.pack("<I", 0)
        exif_segment_body = exif_payload + tiff_header + ifd
        app1_segment_length = len(exif_segment_body) + 2  # length includes itself
        app1 = b"\xff\xe1" + struct.pack(">H", app1_segment_length) + exif_segment_body

        # SOF0 segment: marker(2) length(2)=11, precision(1)=8, height(2)=200, width(2)=400, components(1)=3, then 3*3 bytes
        sof0_body = b"\x08" + struct.pack(">H", 200) + struct.pack(">H", 400) + b"\x03" + b"\x01\x22\x00\x02\x11\x01\x03\x11\x01"
        sof0 = b"\xff\xc0" + struct.pack(">H", len(sof0_body) + 2) + sof0_body

        eoi = b"\xff\xd9"
        jpeg_bytes = soi + app1 + sof0 + eoi

        from app.utils.image_utils import _read_jpeg_exif_orientation, get_image_dimensions
        self.assertEqual(_read_jpeg_exif_orientation(jpeg_bytes), 6)
        width, height = get_image_dimensions(jpeg_bytes)
        # Original SOF0 was 400x200; orientation=6 should swap to 200x400.
        self.assertEqual((width, height), (200, 400))


class ShadowAndCanaryTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmpdir = tempfile.TemporaryDirectory()
        # Build a synthetic shadow artifact by copying the production one.
        primary_path = Path("app/models/size_recommender.joblib").resolve()
        if not primary_path.is_file():
            self.skipTest("Primary model artifact missing; cannot exercise shadow mode.")
        shadow_path = Path(self.tmpdir.name) / "shadow.joblib"
        shadow_payload = joblib.load(primary_path)
        joblib.dump(shadow_payload, shadow_path)
        self.shadow_path = shadow_path
        (
            self.app,
            self.rate_limiter,
            _calibration,
            self.model_service,
            self.recommendation_service,
            _idempotency,
            _feedback,
        ) = _build_app(
            {
                "ML_SERVICE_SHARED_SECRET": SECRET,
                "ML_ADMIN_SECRET": ADMIN_SECRET,
                "ML_RATE_LIMIT_RECOMMEND_PER_MINUTE": "0",
                "ML_RATE_LIMIT_HEALTH_PER_MINUTE": "0",
                "ML_RATE_LIMIT_ADMIN_PER_MINUTE": "0",
                "ML_SHADOW_MODEL_PATH": str(shadow_path),
                "ML_CANARY_MAX_SCORE_DELTA": "1.0",
            }
        )
        from fastapi.testclient import TestClient
        self.client = TestClient(self.app)

    def tearDown(self) -> None:
        self.client.close()
        self.rate_limiter.reset()
        self.tmpdir.cleanup()

    def test_shadow_loaded_surfaces_in_version(self) -> None:
        response = self.client.get("/version")
        self.assertEqual(response.status_code, 200, response.text)
        body = response.json()
        self.assertTrue(body["shadowLoaded"])
        self.assertTrue(body["shadowSha256"])

    def test_recommendation_runs_with_shadow_without_breaking_response(self) -> None:
        response = self.client.post(
            "/recommend-size",
            json=VALID_RECOMMEND_PAYLOAD,
            headers={"x-ml-service-secret": SECRET},
        )
        self.assertEqual(response.status_code, 200, response.text)
        body = response.json()
        self.assertIn(body["recommendation"]["size"], ["S", "M", "L", "XL"])

    def test_canary_baseline_captured_after_load(self) -> None:
        # Internal invariant: baseline should be a non-empty list of floats.
        baseline = getattr(self.model_service, "_canary_baseline", None)
        self.assertIsNotNone(baseline)
        self.assertGreater(len(baseline), 0)


class ForgetEndpointTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tempdir = tempfile.TemporaryDirectory()
        self.feedback_path = Path(self.tempdir.name) / "feedback.jsonl"
        # Pre-populate with two records, one for the user being forgotten.
        self.feedback_path.write_text(
            json.dumps({"userId": "user-1", "feedback": "perfect"}) + "\n"
            + json.dumps({"userId": "user-2", "feedback": "too_small"}) + "\n",
            encoding="utf-8",
        )
        (
            self.app,
            self.rate_limiter,
            _calibration,
            _model_service,
            self.recommendation_service,
            _idempotency,
            self.feedback_service,
        ) = _build_app(
            {
                "ML_SERVICE_SHARED_SECRET": SECRET,
                "ML_ADMIN_SECRET": ADMIN_SECRET,
                "ML_FEEDBACK_LOG_PATH": str(self.feedback_path),
                "ML_RATE_LIMIT_HEALTH_PER_MINUTE": "0",
                "ML_RATE_LIMIT_ADMIN_PER_MINUTE": "0",
            }
        )
        from fastapi.testclient import TestClient
        self.client = TestClient(self.app)

    def tearDown(self) -> None:
        self.client.close()
        self.rate_limiter.reset()
        self.tempdir.cleanup()

    def test_forget_removes_matching_feedback(self) -> None:
        response = self.client.post(
            "/v1/forget",
            json={"userId": "user-1", "reason": "gdpr"},
            headers={"x-ml-admin-secret": ADMIN_SECRET},
        )
        self.assertEqual(response.status_code, 200, response.text)
        body = response.json()
        self.assertEqual(body["userId"], "user-1")
        self.assertEqual(body["feedbackRecordsRemoved"], 1)
        remaining = self.feedback_path.read_text(encoding="utf-8").splitlines()
        self.assertEqual(len(remaining), 1)
        self.assertIn("user-2", remaining[0])

    def test_forget_requires_admin_secret(self) -> None:
        response = self.client.post(
            "/v1/forget",
            json={"userId": "user-1"},
            headers={"x-ml-service-secret": SECRET},
        )
        self.assertEqual(response.status_code, 401)


if __name__ == "__main__":
    unittest.main()
