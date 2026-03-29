from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np
import xgboost as xgb


@dataclass
class GradientBoostedFitArtifact:
    booster: xgb.Booster
    feature_order: tuple[str, ...]
    metadata: dict[str, object] = field(default_factory=dict)

    def predict(self, feature_rows) -> np.ndarray:
        prediction_input = np.asarray(feature_rows, dtype=float)
        matrix = xgb.DMatrix(prediction_input, feature_names=list(self.feature_order))
        return self.booster.predict(matrix)
