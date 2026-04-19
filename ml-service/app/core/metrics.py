"""Stdlib-only Prometheus exposition for the ML service.

Implements just enough of the Prometheus text format to power Grafana dashboards
and alerting without pulling in ``prometheus_client`` (which would inflate the
serverless deployment). Counters, gauges, and histograms are thread-safe.
"""

from __future__ import annotations

import threading
import time
from dataclasses import dataclass, field
from typing import Iterable


_LABEL_SAFE_TRANSLATION = str.maketrans({"\\": "\\\\", '"': '\\"', "\n": "\\n"})


def _format_label_value(value: object) -> str:
    return str(value).translate(_LABEL_SAFE_TRANSLATION)


def _format_label_block(labels: tuple[tuple[str, str], ...]) -> str:
    if not labels:
        return ""
    rendered = ",".join(f'{name}="{_format_label_value(value)}"' for name, value in labels)
    return "{" + rendered + "}"


def _normalize_label_pairs(label_names: tuple[str, ...], values: dict[str, object] | None) -> tuple[tuple[str, str], ...]:
    if not label_names:
        return ()
    provided = values or {}
    return tuple((name, str(provided.get(name, ""))) for name in label_names)


@dataclass
class _Counter:
    name: str
    help: str
    label_names: tuple[str, ...]
    _values: dict[tuple[tuple[str, str], ...], float] = field(default_factory=dict)
    _lock: threading.Lock = field(default_factory=threading.Lock)

    def inc(self, amount: float = 1.0, **labels: object) -> None:
        if amount < 0:
            raise ValueError("Counter increments must be non-negative")
        key = _normalize_label_pairs(self.label_names, labels)
        with self._lock:
            self._values[key] = self._values.get(key, 0.0) + float(amount)

    def render(self) -> Iterable[str]:
        yield f"# HELP {self.name} {self.help}"
        yield f"# TYPE {self.name} counter"
        with self._lock:
            snapshot = list(self._values.items())
        if not snapshot:
            yield f"{self.name}{_format_label_block(())} 0"
            return
        for key, value in snapshot:
            yield f"{self.name}{_format_label_block(key)} {value}"


@dataclass
class _Gauge:
    name: str
    help: str
    label_names: tuple[str, ...]
    _values: dict[tuple[tuple[str, str], ...], float] = field(default_factory=dict)
    _lock: threading.Lock = field(default_factory=threading.Lock)

    def set(self, value: float, **labels: object) -> None:
        key = _normalize_label_pairs(self.label_names, labels)
        with self._lock:
            self._values[key] = float(value)

    def render(self) -> Iterable[str]:
        yield f"# HELP {self.name} {self.help}"
        yield f"# TYPE {self.name} gauge"
        with self._lock:
            snapshot = list(self._values.items())
        if not snapshot:
            yield f"{self.name}{_format_label_block(())} 0"
            return
        for key, value in snapshot:
            yield f"{self.name}{_format_label_block(key)} {value}"


_DEFAULT_BUCKETS: tuple[float, ...] = (
    0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1.0, 2.5, 5.0, 10.0,
)


@dataclass
class _HistogramSeries:
    bucket_counts: list[int]
    sum_value: float = 0.0
    count: int = 0


@dataclass
class _Histogram:
    name: str
    help: str
    label_names: tuple[str, ...]
    buckets: tuple[float, ...] = _DEFAULT_BUCKETS
    _series: dict[tuple[tuple[str, str], ...], _HistogramSeries] = field(default_factory=dict)
    _lock: threading.Lock = field(default_factory=threading.Lock)

    def observe(self, value: float, **labels: object) -> None:
        key = _normalize_label_pairs(self.label_names, labels)
        with self._lock:
            series = self._series.get(key)
            if series is None:
                series = _HistogramSeries(bucket_counts=[0] * len(self.buckets))
                self._series[key] = series
            series.sum_value += float(value)
            series.count += 1
            for index, upper_bound in enumerate(self.buckets):
                if value <= upper_bound:
                    series.bucket_counts[index] += 1

    def render(self) -> Iterable[str]:
        yield f"# HELP {self.name} {self.help}"
        yield f"# TYPE {self.name} histogram"
        with self._lock:
            snapshot = [(key, _HistogramSeries(list(series.bucket_counts), series.sum_value, series.count))
                        for key, series in self._series.items()]
        for key, series in snapshot:
            cumulative = 0
            for upper_bound, bucket_count in zip(self.buckets, series.bucket_counts):
                cumulative += bucket_count
                bucket_labels = key + (("le", _format_le(upper_bound)),)
                yield f"{self.name}_bucket{_format_label_block(bucket_labels)} {cumulative}"
            inf_labels = key + (("le", "+Inf"),)
            yield f"{self.name}_bucket{_format_label_block(inf_labels)} {series.count}"
            yield f"{self.name}_count{_format_label_block(key)} {series.count}"
            yield f"{self.name}_sum{_format_label_block(key)} {series.sum_value}"


def _format_le(value: float) -> str:
    if value == int(value):
        return f"{int(value)}.0"
    return f"{value}"


class MetricsRegistry:
    """Thread-safe registry of all metrics exported by the ML service."""

    def __init__(self) -> None:
        self.process_start_time = time.time()
        self.requests_total = _Counter(
            name="ml_requests_total",
            help="Total HTTP requests handled by the ML service.",
            label_names=("route", "method", "status"),
        )
        self.request_duration_seconds = _Histogram(
            name="ml_request_duration_seconds",
            help="HTTP request latency in seconds, observed at the application layer.",
            label_names=("route", "method"),
        )
        self.predictions_total = _Counter(
            name="ml_predictions_total",
            help="Recommendation outcomes by prediction source.",
            label_names=("source",),
        )
        self.recommendation_cache_total = _Counter(
            name="ml_recommendation_cache_total",
            help="Recommendation cache outcomes (hit, miss, store, skip).",
            label_names=("result",),
        )
        self.recommendation_cache_size = _Gauge(
            name="ml_recommendation_cache_size",
            help="Number of entries currently held in the recommendation cache.",
            label_names=(),
        )
        self.rate_limited_total = _Counter(
            name="ml_rate_limited_total",
            help="Requests rejected because the per-route rate limit was exhausted.",
            label_names=("route",),
        )
        self.timeouts_total = _Counter(
            name="ml_request_timeouts_total",
            help="Requests aborted because they exceeded the configured timeout.",
            label_names=("route",),
        )
        self.model_loaded = _Gauge(
            name="ml_model_loaded",
            help="1 when an ML artifact is loaded, 0 when running on heuristic only.",
            label_names=(),
        )
        self.model_load_failures = _Counter(
            name="ml_model_load_failures_total",
            help="Number of times artifact loading failed (missing, invalid, or pinning rejection).",
            label_names=("reason",),
        )
        self.feedback_total = _Counter(
            name="ml_feedback_total",
            help="Fit feedback events ingested by /feedback, grouped by feedback verdict and source.",
            label_names=("feedback", "source"),
        )
        self.feedback_persist_failures = _Counter(
            name="ml_feedback_persist_failures_total",
            help="Number of feedback events that failed to persist to disk.",
            label_names=("reason",),
        )
        self.batch_size = _Histogram(
            name="ml_recommend_batch_size",
            help="Distribution of /recommend-size:batch request sizes.",
            label_names=(),
            buckets=(1, 2, 4, 8, 16, 32, 64, 128),
        )
        self.batch_item_failures = _Counter(
            name="ml_recommend_batch_item_failures_total",
            help="Number of items in batched recommendation requests that failed validation or scoring.",
            label_names=("reason",),
        )
        self.idempotency_total = _Counter(
            name="ml_idempotency_total",
            help="Idempotency-Key handling outcomes (hit, miss, store, conflict, skip).",
            label_names=("result",),
        )
        self.calibration_applied_total = _Counter(
            name="ml_calibration_applied_total",
            help="Number of recommendation responses with isotonic confidence calibration applied.",
            label_names=("result",),
        )
        self.shadow_predictions_total = _Counter(
            name="ml_shadow_predictions_total",
            help="Number of shadow-model predictions executed alongside the primary artifact.",
            label_names=("result",),
        )
        self.shadow_score_delta = _Histogram(
            name="ml_shadow_score_delta",
            help="Absolute fitScore delta between primary and shadow model on best candidate.",
            label_names=(),
            buckets=(0.05, 0.1, 0.25, 0.5, 1.0, 2.0, 5.0),
        )
        self.body_frame_count = _Histogram(
            name="ml_body_frame_count",
            help="Distribution of /analyze-body request frame counts.",
            label_names=(),
            buckets=(1, 2, 3, 4, 5, 6),
        )
        self.body_quality_rejections_total = _Counter(
            name="ml_body_quality_rejections_total",
            help="Body analysis frames rejected by quality gates.",
            label_names=("reason",),
        )

    def render(self) -> str:
        lines: list[str] = []
        lines.extend(self.requests_total.render())
        lines.extend(self.request_duration_seconds.render())
        lines.extend(self.predictions_total.render())
        lines.extend(self.recommendation_cache_total.render())
        lines.extend(self.recommendation_cache_size.render())
        lines.extend(self.rate_limited_total.render())
        lines.extend(self.timeouts_total.render())
        lines.extend(self.model_loaded.render())
        lines.extend(self.model_load_failures.render())
        lines.extend(self.feedback_total.render())
        lines.extend(self.feedback_persist_failures.render())
        lines.extend(self.batch_size.render())
        lines.extend(self.batch_item_failures.render())
        lines.extend(self.idempotency_total.render())
        lines.extend(self.calibration_applied_total.render())
        lines.extend(self.shadow_predictions_total.render())
        lines.extend(self.shadow_score_delta.render())
        lines.extend(self.body_frame_count.render())
        lines.extend(self.body_quality_rejections_total.render())
        lines.append(f"# HELP ml_process_uptime_seconds Seconds since the ML service process started.")
        lines.append(f"# TYPE ml_process_uptime_seconds gauge")
        lines.append(f"ml_process_uptime_seconds {time.time() - self.process_start_time}")
        return "\n".join(lines) + "\n"


metrics = MetricsRegistry()
