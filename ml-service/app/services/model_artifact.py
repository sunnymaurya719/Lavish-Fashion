from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any


@dataclass
class GradientBoostedFitArtifact:
    booster: Any
    feature_order: tuple[str, ...]
    metadata: dict[str, object] = field(default_factory=dict)

    def predict(self, feature_rows):
        try:
            import xgboost as xgb
        except ImportError as exc:  # pragma: no cover - depends on deployment runtime
            raise RuntimeError("xgboost runtime is not installed") from exc

        matrix = xgb.DMatrix(feature_rows, feature_names=list(self.feature_order))
        return self.booster.predict(matrix)
