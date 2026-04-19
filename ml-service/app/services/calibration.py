"""Isotonic calibration utility for recommendation confidence (M3).

The class is *fittable offline* (using accumulated `(predicted_abs_fit_score,
was_correct)` pairs from the feedback loop) and *applied at inference time* to
turn a hand-tuned ``confidence`` into a true probability that the recommended
size matches reality.

Persistence format is a tiny JSON document so the runtime never needs scikit-
learn or scipy. The only dependency is the stdlib.
"""

from __future__ import annotations

import json
import threading
from dataclasses import dataclass, field
from pathlib import Path
from typing import Iterable


def _isotonic_pava(values: list[float], weights: list[float]) -> list[float]:
    """Pool-adjacent-violators algorithm for monotone-increasing isotonic fit.

    Operates in-place style on a copy of ``values`` weighted by ``weights``.
    Returns the fitted values (same length as inputs) ordered by the original
    sequence. ``values`` and ``weights`` must already be sorted by the input
    feature ``x``. Implementation is O(n).
    """
    if len(values) != len(weights):
        raise ValueError("values and weights must have the same length")
    if not values:
        return []

    fitted = [float(v) for v in values]
    weight = [float(w) for w in weights]
    block_start: list[int] = [i for i in range(len(fitted))]

    index = 0
    while index < len(fitted) - 1:
        if fitted[index] <= fitted[index + 1]:
            index += 1
            continue

        # Merge the violating pair into one pooled block.
        pooled_weight = weight[index] + weight[index + 1]
        if pooled_weight <= 0:
            pooled_value = (fitted[index] + fitted[index + 1]) / 2
        else:
            pooled_value = (
                fitted[index] * weight[index] + fitted[index + 1] * weight[index + 1]
            ) / pooled_weight
        fitted[index] = pooled_value
        weight[index] = pooled_weight
        del fitted[index + 1]
        del weight[index + 1]
        del block_start[index + 1]

        if index > 0:
            index -= 1

    # Expand pooled blocks back to the original length.
    expanded = [0.0] * (block_start[-1] + 1) if block_start else []
    for block_index, start_index in enumerate(block_start):
        end_index = block_start[block_index + 1] if block_index + 1 < len(block_start) else len(expanded)
        for output_index in range(start_index, end_index):
            expanded[output_index] = fitted[block_index]
    return expanded


@dataclass
class IsotonicCalibrator:
    """Piecewise-constant monotone calibrator.

    ``thresholds`` is the sorted input grid (e.g. predicted ``|fitScore|``
    values). ``probabilities`` is the matching monotone-increasing output
    grid in ``[0, 1]``. ``apply()`` does a binary-search lookup with linear
    interpolation between adjacent grid points.
    """

    thresholds: list[float] = field(default_factory=list)
    probabilities: list[float] = field(default_factory=list)
    monotone: str = "decreasing"  # confidence drops as |fitScore| grows

    def __post_init__(self) -> None:
        if len(self.thresholds) != len(self.probabilities):
            raise ValueError("thresholds and probabilities must have the same length")
        for index in range(1, len(self.thresholds)):
            if self.thresholds[index] < self.thresholds[index - 1]:
                raise ValueError("thresholds must be non-decreasing")

    @property
    def is_fitted(self) -> bool:
        return len(self.thresholds) >= 2

    def apply(self, value: float) -> float:
        if not self.is_fitted:
            return float("nan")
        if value <= self.thresholds[0]:
            return float(self.probabilities[0])
        if value >= self.thresholds[-1]:
            return float(self.probabilities[-1])

        # Binary search for the bracketing interval.
        low_index, high_index = 0, len(self.thresholds) - 1
        while high_index - low_index > 1:
            mid_index = (low_index + high_index) // 2
            if self.thresholds[mid_index] <= value:
                low_index = mid_index
            else:
                high_index = mid_index

        left_x = self.thresholds[low_index]
        right_x = self.thresholds[high_index]
        left_y = self.probabilities[low_index]
        right_y = self.probabilities[high_index]
        if right_x == left_x:
            return float(left_y)
        ratio = (value - left_x) / (right_x - left_x)
        return float(left_y + ratio * (right_y - left_y))

    def to_dict(self) -> dict[str, object]:
        return {
            "thresholds": list(self.thresholds),
            "probabilities": list(self.probabilities),
            "monotone": self.monotone,
        }

    @classmethod
    def from_dict(cls, payload: dict[str, object]) -> "IsotonicCalibrator":
        thresholds = [float(value) for value in payload.get("thresholds") or []]
        probabilities = [float(value) for value in payload.get("probabilities") or []]
        monotone = str(payload.get("monotone") or "decreasing")
        return cls(thresholds=thresholds, probabilities=probabilities, monotone=monotone)

    def save(self, path: Path) -> None:
        path = Path(path)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(self.to_dict(), indent=2), encoding="utf-8")

    @classmethod
    def load(cls, path: Path) -> "IsotonicCalibrator":
        return cls.from_dict(json.loads(Path(path).read_text(encoding="utf-8")))

    @classmethod
    def fit(
        cls,
        observations: Iterable[tuple[float, float]],
        *,
        weights: Iterable[float] | None = None,
        monotone: str = "decreasing",
        max_grid_points: int = 64,
    ) -> "IsotonicCalibrator":
        """Fit a monotone calibration from raw observations.

        Each observation is ``(predicted_abs_fit_score, was_correct ∈ {0, 1})``.
        When ``monotone="decreasing"`` (the default for fit confidence), the raw
        labels are negated for fitting and the resulting curve is flipped back
        so probability decreases as the input score grows.
        """
        observation_list = [(float(x), float(y)) for x, y in observations]
        if not observation_list:
            return cls()

        if weights is None:
            weight_list = [1.0] * len(observation_list)
        else:
            weight_list = [float(weight) for weight in weights]
            if len(weight_list) != len(observation_list):
                raise ValueError("weights must align with observations")

        order = sorted(range(len(observation_list)), key=lambda index: observation_list[index][0])
        sorted_x = [observation_list[index][0] for index in order]
        sorted_y = [observation_list[index][1] for index in order]
        sorted_w = [weight_list[index] for index in order]
        if monotone == "decreasing":
            sorted_y = [-value for value in sorted_y]

        fitted = _isotonic_pava(sorted_y, sorted_w)
        if monotone == "decreasing":
            fitted = [-value for value in fitted]

        # Compress duplicate thresholds and clamp probabilities into [0, 1].
        compressed_x: list[float] = []
        compressed_y: list[float] = []
        for index, x_value in enumerate(sorted_x):
            y_value = max(0.0, min(1.0, fitted[index]))
            if compressed_x and compressed_x[-1] == x_value:
                # Average the duplicate y for stability.
                compressed_y[-1] = (compressed_y[-1] + y_value) / 2
                continue
            compressed_x.append(x_value)
            compressed_y.append(y_value)

        # Optional uniform-grid downsample so the persisted artifact stays small.
        if len(compressed_x) > max_grid_points:
            stride = len(compressed_x) / max_grid_points
            sampled_indices = sorted({int(stride * index) for index in range(max_grid_points)} | {len(compressed_x) - 1})
            compressed_x = [compressed_x[index] for index in sampled_indices]
            compressed_y = [compressed_y[index] for index in sampled_indices]

        return cls(thresholds=compressed_x, probabilities=compressed_y, monotone=monotone)


class CalibrationService:
    """Loads and reloads an ``IsotonicCalibrator`` artifact."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._calibrator: IsotonicCalibrator | None = None
        self._loaded_path: str = ""

    def load(self, path: str | Path | None) -> bool:
        path_str = str(path or "").strip()
        if not path_str:
            with self._lock:
                self._calibrator = None
                self._loaded_path = ""
            return False

        try:
            calibrator = IsotonicCalibrator.load(Path(path_str))
        except (OSError, ValueError, json.JSONDecodeError):
            with self._lock:
                self._calibrator = None
                self._loaded_path = ""
            return False

        if not calibrator.is_fitted:
            with self._lock:
                self._calibrator = None
                self._loaded_path = path_str
            return False

        with self._lock:
            self._calibrator = calibrator
            self._loaded_path = path_str
        return True

    @property
    def loaded(self) -> bool:
        return self._calibrator is not None

    @property
    def loaded_path(self) -> str:
        return self._loaded_path

    def calibrate(self, value: float) -> float | None:
        with self._lock:
            calibrator = self._calibrator
        if calibrator is None:
            return None
        return calibrator.apply(value)


calibration_service = CalibrationService()
