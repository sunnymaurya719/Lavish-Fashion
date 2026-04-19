from __future__ import annotations

import asyncio
import hashlib
import logging
import threading
from pathlib import Path

import joblib

from app.core.config import settings
from app.core.metrics import metrics
from app.services.model_artifact import GradientBoostedFitArtifact


logger = logging.getLogger(__name__)


class PredictionLengthMismatchError(RuntimeError):
    """Raised when the model returns a different number of rows than requested."""


class PredictionExecutionError(RuntimeError):
    """Raised when the underlying booster fails to score a candidate batch."""


class ModelService:
    def __init__(self, artifact_path: Path | None = None, base_model_version: str | None = None) -> None:
        self._model = None
        self._artifact_path = Path(artifact_path or settings.model_path)
        self._base_model_version = str(base_model_version or settings.model_version).strip()
        self._model_version = self._base_model_version
        self._artifact_metadata: dict[str, object] = {}
        self._artifact_sha256: str = ""
        self._load_attempted = False
        self._reload_lock = asyncio.Lock()
        self._predict_lock = threading.Lock()
        self._shadow_model = None
        self._shadow_version: str = ""
        self._shadow_sha256: str = ""
        self._shadow_predict_lock = threading.Lock()
        self._canary_baseline: list[float] | None = None
        metrics.model_loaded.set(0)

    @property
    def model_loaded(self) -> bool:
        return self._model is not None

    @property
    def model_version(self) -> str:
        return self._model_version

    @property
    def artifact_metadata(self) -> dict[str, object]:
        return dict(self._artifact_metadata)

    @property
    def load_attempted(self) -> bool:
        return self._load_attempted

    @property
    def artifact_path(self) -> Path:
        return self._artifact_path

    @property
    def artifact_sha256(self) -> str:
        return self._artifact_sha256

    @property
    def shadow_loaded(self) -> bool:
        return self._shadow_model is not None

    @property
    def shadow_version(self) -> str:
        return self._shadow_version

    @property
    def shadow_sha256(self) -> str:
        return self._shadow_sha256

    def load_model(self) -> bool:
        self._model = None
        self._model_version = self._base_model_version
        self._artifact_metadata = {}
        self._artifact_sha256 = ""
        self._shadow_model = None
        self._shadow_version = ""
        self._shadow_sha256 = ""
        self._load_attempted = True
        metrics.model_loaded.set(0)

        if not self._artifact_path.is_file():
            logger.warning(
                "Model artifact not found; falling back to heuristic scoring",
                extra={"artifactPath": str(self._artifact_path)},
            )
            metrics.model_load_failures.inc(reason="missing_artifact")
            return False

        try:
            artifact_bytes = self._artifact_path.read_bytes()
            artifact_sha256 = hashlib.sha256(artifact_bytes).hexdigest()
            artifact_payload = joblib.load(self._artifact_path)
            metadata: dict[str, object] = {}

            if isinstance(artifact_payload, dict) and artifact_payload.get("model") is not None:
                model = artifact_payload["model"]
                metadata = dict(artifact_payload.get("metadata") or {})
            else:
                model = artifact_payload
                if isinstance(artifact_payload, GradientBoostedFitArtifact):
                    metadata = dict(artifact_payload.metadata or {})

            if not hasattr(model, "predict"):
                raise TypeError("Loaded artifact does not expose a predict method")

            resolved_version = (
                str(metadata.get("modelVersion") or "").strip()
                or f"{self._base_model_version}:{self._artifact_path.name}"
            )

            if not self._validate_artifact_pinning(resolved_version, artifact_sha256):
                metrics.model_load_failures.inc(reason="pinning_mismatch")
                return False

            if not self._canary_check(model):
                metrics.model_load_failures.inc(reason="canary_mismatch")
                return False

            self._model = model
            self._artifact_metadata = metadata
            self._artifact_sha256 = artifact_sha256
            self._model_version = resolved_version
            metrics.model_loaded.set(1)
            logger.info(
                "Loaded model artifact",
                extra={
                    "artifactPath": str(self._artifact_path),
                    "modelVersion": self._model_version,
                    "artifactSha256": self._artifact_sha256[:12],
                },
            )

            self._refresh_canary_baseline()
            self._load_shadow_model()

            if settings.warm_up_model:
                self._warm_up()

            return True
        except Exception as exc:  # pragma: no cover - defensive startup logging
            logger.warning(
                "Failed to load model artifact",
                extra={"artifactPath": str(self._artifact_path), "error": str(exc)},
                exc_info=True,
            )
            metrics.model_load_failures.inc(reason="load_error")
            self._model = None
            self._model_version = self._base_model_version
            self._artifact_metadata = {}
            self._artifact_sha256 = ""
            metrics.model_loaded.set(0)
            return False

    def _validate_artifact_pinning(self, resolved_version: str, artifact_sha256: str) -> bool:
        expected_version = (settings.expected_model_version or "").strip()
        expected_sha256 = (settings.expected_model_sha256 or "").strip().lower()

        if expected_version and expected_version != resolved_version:
            logger.error(
                "Model artifact version mismatch; refusing to load",
                extra={
                    "expectedModelVersion": expected_version,
                    "actualModelVersion": resolved_version,
                },
            )
            return False

        if expected_sha256 and expected_sha256 != artifact_sha256:
            logger.error(
                "Model artifact sha256 mismatch; refusing to load",
                extra={
                    "expectedSha256": expected_sha256,
                    "actualSha256": artifact_sha256,
                },
            )
            return False

        return True

    async def reload_model(self) -> bool:
        async with self._reload_lock:
            return await asyncio.to_thread(self.load_model)

    def predict_fit_scores(self, feature_rows: list[list[float]]) -> list[float]:
        if not self._model or not feature_rows:
            return []

        try:
            with self._predict_lock:
                predictions = self._model.predict(feature_rows)
        except Exception as exc:
            raise PredictionExecutionError(str(exc)) from exc

        if isinstance(predictions, (list, tuple)):
            normalized = [float(value) for value in predictions]
        elif hasattr(predictions, "tolist"):
            converted = predictions.tolist()
            normalized = (
                [float(value) for value in converted]
                if isinstance(converted, list)
                else [float(converted)]
            )
        else:
            normalized = [float(predictions)]

        if len(normalized) != len(feature_rows):
            raise PredictionLengthMismatchError(
                f"Model returned {len(normalized)} predictions for {len(feature_rows)} rows"
            )

        return normalized

    def _warm_up(self) -> None:
        try:
            from app.services.feature_builder import FEATURE_ORDER

            warm_rows = [[0.0 for _ in FEATURE_ORDER] for _ in range(2)]
            with self._predict_lock:
                self._model.predict(warm_rows)
            logger.info("Model warm-up succeeded", extra={"modelVersion": self._model_version})
        except Exception as exc:  # pragma: no cover - warm-up is best-effort
            logger.warning(
                "Model warm-up failed; first request may be slower",
                extra={"error": str(exc)},
            )

    # ------------------------------------------------------------------
    # M7 — shadow mode
    # ------------------------------------------------------------------
    def _load_shadow_model(self) -> None:
        shadow_path_str = (settings.shadow_model_path or "").strip()
        self._shadow_model = None
        self._shadow_version = ""
        self._shadow_sha256 = ""
        if not shadow_path_str:
            return
        shadow_path = Path(shadow_path_str)
        if not shadow_path.is_file():
            logger.warning(
                "Shadow model artifact not found; shadow mode disabled",
                extra={"shadowArtifactPath": shadow_path_str},
            )
            return
        try:
            shadow_bytes = shadow_path.read_bytes()
            shadow_sha256 = hashlib.sha256(shadow_bytes).hexdigest()
            shadow_payload = joblib.load(shadow_path)
            shadow_metadata: dict[str, object] = {}
            if isinstance(shadow_payload, dict) and shadow_payload.get("model") is not None:
                shadow_model = shadow_payload["model"]
                shadow_metadata = dict(shadow_payload.get("metadata") or {})
            else:
                shadow_model = shadow_payload
                if isinstance(shadow_payload, GradientBoostedFitArtifact):
                    shadow_metadata = dict(shadow_payload.metadata or {})
            if not hasattr(shadow_model, "predict"):
                raise TypeError("Shadow artifact does not expose a predict method")

            self._shadow_model = shadow_model
            self._shadow_sha256 = shadow_sha256
            self._shadow_version = (
                str(shadow_metadata.get("modelVersion") or "").strip()
                or f"shadow:{shadow_path.name}"
            )
            logger.info(
                "Loaded shadow model artifact",
                extra={
                    "shadowArtifactPath": shadow_path_str,
                    "shadowVersion": self._shadow_version,
                    "shadowSha256": self._shadow_sha256[:12],
                },
            )
        except Exception as exc:
            logger.warning(
                "Failed to load shadow model; shadow mode disabled",
                extra={"shadowArtifactPath": shadow_path_str, "error": str(exc)},
            )
            self._shadow_model = None
            self._shadow_version = ""
            self._shadow_sha256 = ""

    def predict_shadow_fit_scores(self, feature_rows: list[list[float]]) -> list[float]:
        if not self._shadow_model or not feature_rows:
            return []
        try:
            with self._shadow_predict_lock:
                predictions = self._shadow_model.predict(feature_rows)
        except Exception as exc:
            logger.warning(
                "Shadow prediction failed; ignoring shadow output",
                extra={"error": str(exc)},
            )
            metrics.shadow_predictions_total.inc(result="error")
            return []

        if isinstance(predictions, (list, tuple)):
            normalized = [float(value) for value in predictions]
        elif hasattr(predictions, "tolist"):
            converted = predictions.tolist()
            normalized = (
                [float(value) for value in converted]
                if isinstance(converted, list)
                else [float(converted)]
            )
        else:
            normalized = [float(predictions)]

        if len(normalized) != len(feature_rows):
            metrics.shadow_predictions_total.inc(result="length_mismatch")
            return []
        metrics.shadow_predictions_total.inc(result="ok")
        return normalized

    # ------------------------------------------------------------------
    # M8 — canary check
    # ------------------------------------------------------------------
    @staticmethod
    def _canary_feature_rows() -> list[list[float]]:
        from app.services.feature_builder import FEATURE_ORDER

        feature_count = len(FEATURE_ORDER)
        # Three deterministic synthetic rows: all-zero, all-+1, alternating.
        return [
            [0.0] * feature_count,
            [1.0] * feature_count,
            [(-1.0 if index % 2 == 0 else 1.0) for index in range(feature_count)],
        ]

    def _canary_check(self, candidate_model) -> bool:
        if self._canary_baseline is None or settings.canary_max_score_delta <= 0:
            return True
        try:
            rows = self._canary_feature_rows()
            with self._predict_lock:
                raw_predictions = candidate_model.predict(rows)
        except Exception as exc:
            logger.warning(
                "Canary prediction failed; refusing reload",
                extra={"error": str(exc)},
            )
            return False
        try:
            new_predictions = [float(value) for value in raw_predictions]
        except (TypeError, ValueError):
            try:
                new_predictions = [float(value) for value in raw_predictions.tolist()]
            except Exception:
                logger.warning("Canary prediction shape unrecognized; refusing reload")
                return False
        if len(new_predictions) != len(self._canary_baseline):
            logger.warning(
                "Canary prediction length mismatch",
                extra={
                    "baselineLength": len(self._canary_baseline),
                    "newLength": len(new_predictions),
                },
            )
            return False
        max_delta = max(
            abs(new - baseline)
            for new, baseline in zip(new_predictions, self._canary_baseline, strict=True)
        )
        if max_delta > settings.canary_max_score_delta:
            logger.warning(
                "Canary tolerance exceeded; refusing to load new artifact",
                extra={
                    "maxDelta": round(max_delta, 4),
                    "tolerance": settings.canary_max_score_delta,
                },
            )
            return False
        logger.info(
            "Canary check passed",
            extra={"maxDelta": round(max_delta, 4), "tolerance": settings.canary_max_score_delta},
        )
        return True

    def _refresh_canary_baseline(self) -> None:
        if self._model is None:
            self._canary_baseline = None
            return
        try:
            rows = self._canary_feature_rows()
            with self._predict_lock:
                raw_predictions = self._model.predict(rows)
            try:
                self._canary_baseline = [float(value) for value in raw_predictions]
            except (TypeError, ValueError):
                self._canary_baseline = [float(value) for value in raw_predictions.tolist()]
        except Exception as exc:
            logger.warning(
                "Failed to capture canary baseline",
                extra={"error": str(exc)},
            )
            self._canary_baseline = None


model_service = ModelService()
