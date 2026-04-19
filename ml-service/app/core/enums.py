from __future__ import annotations

from enum import Enum


class PredictionSource(str, Enum):
    """Stable wire values reported in the recommendation response meta.

    The string values are part of the public contract with the Node gateway and
    must not be changed without coordinating a version bump.
    """

    MODEL = "xgboost_regressor"
    HEURISTIC = "heuristic_fallback"
    MODEL_LENGTH_MISMATCH = "model_length_mismatch"
    MODEL_ERROR = "model_error"

    @property
    def is_model(self) -> bool:
        return self is PredictionSource.MODEL
