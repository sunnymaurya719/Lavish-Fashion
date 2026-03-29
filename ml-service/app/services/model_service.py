from __future__ import annotations

import logging
from pathlib import Path

import joblib
import numpy as np

from app.core.config import settings
from app.services.model_artifact import GradientBoostedFitArtifact


logger = logging.getLogger(__name__)


class ModelService:
    def __init__(self, artifact_path: Path | None = None, base_model_version: str | None = None) -> None:
        self._model = None
        self._artifact_path = Path(artifact_path or settings.model_path)
        self._base_model_version = str(base_model_version or settings.model_version).strip()
        self._model_version = self._base_model_version
        self._artifact_metadata: dict[str, object] = {}

    @property
    def model_loaded(self) -> bool:
        return self._model is not None

    @property
    def model_version(self) -> str:
        return self._model_version

    @property
    def artifact_metadata(self) -> dict[str, object]:
        return dict(self._artifact_metadata)

    def load_model(self) -> bool:
        self._model = None
        self._model_version = self._base_model_version
        self._artifact_metadata = {}

        if not self._artifact_path.is_file():
            logger.warning("Model artifact not found at %s. Falling back to heuristic scoring.", self._artifact_path)
            return False

        try:
            artifact_payload = joblib.load(self._artifact_path)
            metadata: dict[str, object] = {}

            if isinstance(artifact_payload, dict) and artifact_payload.get("model") is not None:
                self._model = artifact_payload["model"]
                metadata = dict(artifact_payload.get("metadata") or {})
            else:
                self._model = artifact_payload
                if isinstance(artifact_payload, GradientBoostedFitArtifact):
                    metadata = dict(artifact_payload.metadata or {})

            if not hasattr(self._model, "predict"):
                raise TypeError("Loaded artifact does not expose a predict method")

            self._artifact_metadata = metadata
            self._model_version = str(metadata.get("modelVersion") or "").strip() or f"{self._base_model_version}:{self._artifact_path.name}"
            logger.info("Loaded model artifact from %s", self._artifact_path)
            return True
        except Exception as exc:  # pragma: no cover - defensive startup logging
            logger.warning("Failed to load model artifact from %s: %s", self._artifact_path, exc)
            self._model = None
            self._model_version = self._base_model_version
            self._artifact_metadata = {}
            return False

    def predict_fit_scores(self, feature_rows: list[list[float]]) -> list[float] | None:
        if not self._model or not feature_rows:
            return None

        prediction_input = np.asarray(feature_rows, dtype=float)

        try:
            predictions = self._model.predict(prediction_input)
        except TypeError:
            predictions = self._model.predict(feature_rows)

        return [float(value) for value in np.asarray(predictions).reshape(-1)]


model_service = ModelService()
