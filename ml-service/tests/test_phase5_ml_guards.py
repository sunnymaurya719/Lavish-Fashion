"""Tests for ml-service hardening: image MIME whitelist, NaN/Inf rejection,
and request body size guard."""
from __future__ import annotations

import base64
from importlib import reload

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError


def _png_bytes() -> bytes:
    # Minimal 1x1 PNG.
    return base64.b64decode(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII="
    )


def _data_url(mime: str, payload: bytes) -> str:
    return f"data:{mime};base64,{base64.b64encode(payload).decode('ascii')}"


# ---------- 1. Image MIME whitelist ----------

class TestImageMimeWhitelist:
    def test_rejects_unsupported_mime_type(self, monkeypatch):
        monkeypatch.setenv("ML_ALLOWED_IMAGE_MIME_TYPES", "image/jpeg,image/png,image/webp")
        from app.core import config as config_module
        reload(config_module)
        from app.utils import image_utils
        reload(image_utils)

        with pytest.raises(ValueError, match="unsupported format"):
            image_utils.decode_data_url_image(_data_url("image/svg+xml", b"<svg/>"))

    def test_accepts_png(self, monkeypatch):
        monkeypatch.setenv("ML_ALLOWED_IMAGE_MIME_TYPES", "image/jpeg,image/png,image/webp")
        from app.core import config as config_module
        reload(config_module)
        from app.utils import image_utils
        reload(image_utils)

        mime, decoded = image_utils.decode_data_url_image(_data_url("image/png", _png_bytes()))
        assert mime == "image/png"
        assert len(decoded) > 0


# ---------- 2. NaN / Inf rejection on float fields ----------

class TestNanInfGuards:
    def test_user_metrics_rejects_nan_height(self):
        from app.schemas.request_models import UserMetricsInput

        with pytest.raises(ValidationError):
            UserMetricsInput(heightCm=float("nan"), weightKg=65)

    def test_user_metrics_rejects_inf_weight(self):
        from app.schemas.request_models import UserMetricsInput

        with pytest.raises(ValidationError):
            UserMetricsInput(heightCm=170, weightKg=float("inf"))

    def test_landmark_rejects_nan(self):
        from app.schemas.request_models import LandmarkInput

        with pytest.raises(ValidationError):
            LandmarkInput(x=float("nan"), y=0.5)

    def test_body_features_rejects_inf(self):
        from app.schemas.request_models import BodyFeaturesInput

        with pytest.raises(ValidationError):
            BodyFeaturesInput(shoulderRatio=float("inf"))

    def test_realistic_values_accepted(self):
        from app.schemas.request_models import UserMetricsInput

        result = UserMetricsInput(heightCm=170, weightKg=65)
        assert result.heightCm == 170


# ---------- 3. Request body size guard middleware ----------

class TestBodySizeGuard:
    def test_rejects_oversized_content_length(self, monkeypatch):
        monkeypatch.setenv("ML_MAX_REQUEST_BODY_BYTES", "1024")
        from app.core import config as config_module
        reload(config_module)
        from app import main as main_module
        reload(main_module)

        client = TestClient(main_module.app)
        response = client.post(
            "/recommend-size",
            content=b"x" * 2048,
            headers={"content-type": "application/json", "content-length": "2048"},
        )
        assert response.status_code == 413
        body = response.json()
        assert "exceeds the maximum allowed size" in body["error"]["message"]

    def test_allows_undersized_request(self, monkeypatch):
        monkeypatch.setenv("ML_MAX_REQUEST_BODY_BYTES", "10000")
        from app.core import config as config_module
        reload(config_module)
        from app import main as main_module
        reload(main_module)

        client = TestClient(main_module.app)
        # A garbage-but-small body should fail validation (422) — NOT body-size (413).
        response = client.post(
            "/recommend-size",
            json={"hello": "world"},
            headers={"x-ml-service-secret": "dummy"},
        )
        assert response.status_code != 413
