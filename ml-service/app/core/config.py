from dataclasses import dataclass
from pathlib import Path
import os


def _normalize_secret(value: str | None) -> str:
    return str(value or "").strip()


def _parse_int(value: str | None, default: int, *, minimum: int | None = None) -> int:
    try:
        parsed = int(str(value).strip()) if value not in (None, "") else default
    except (TypeError, ValueError):
        parsed = default
    if minimum is not None and parsed < minimum:
        return minimum
    return parsed


def _parse_float(value: str | None, default: float, *, minimum: float | None = None) -> float:
    try:
        parsed = float(str(value).strip()) if value not in (None, "") else default
    except (TypeError, ValueError):
        parsed = default
    if minimum is not None and parsed < minimum:
        return minimum
    return parsed


def _parse_bool(value: str | None, default: bool) -> bool:
    if value is None:
        return default
    text = str(value).strip().lower()
    if not text:
        return default
    return text in {"1", "true", "yes", "y", "on"}


def _parse_csv(value: str | None) -> tuple[str, ...]:
    if not value:
        return ()
    return tuple(item.strip() for item in str(value).split(",") if item.strip())


@dataclass(frozen=True)
class Settings:
    app_name: str = os.getenv("ML_APP_NAME", "Lavish Fit ML Service").strip()
    app_env: str = os.getenv("ML_APP_ENV", "development").strip().lower()
    model_version: str = os.getenv("MODEL_VERSION", "xgb-fit-v1").strip()
    model_path: Path = Path(os.getenv("MODEL_PATH", "app/models/size_recommender.joblib")).resolve()
    shared_secret: str = _normalize_secret(os.getenv("ML_SERVICE_SHARED_SECRET"))
    admin_secret: str = _normalize_secret(os.getenv("ML_ADMIN_SECRET"))

    # Timeouts in seconds. ``0`` disables the timeout for that route.
    recommend_timeout_seconds: float = _parse_float(os.getenv("ML_RECOMMEND_TIMEOUT_SECONDS"), 3.0, minimum=0.0)
    analyze_timeout_seconds: float = _parse_float(os.getenv("ML_ANALYZE_TIMEOUT_SECONDS"), 6.0, minimum=0.0)

    # Payload guards.
    max_image_bytes: int = _parse_int(os.getenv("ML_MAX_IMAGE_BYTES"), 3_000_000, minimum=1_024)
    max_image_pixels: int = _parse_int(os.getenv("ML_MAX_IMAGE_PIXELS"), 12_000_000, minimum=1)
    max_image_dimension: int = _parse_int(os.getenv("ML_MAX_IMAGE_DIMENSION"), 4_096, minimum=1)
    max_landmarks: int = _parse_int(os.getenv("ML_MAX_LANDMARKS"), 64, minimum=1)
    max_size_measurements: int = _parse_int(os.getenv("ML_MAX_SIZE_MEASUREMENTS"), 30, minimum=1)
    # Allowed image MIME types for body-scan payloads. Comma-separated env override.
    allowed_image_mime_types: tuple[str, ...] = _parse_csv(
        os.getenv("ML_ALLOWED_IMAGE_MIME_TYPES", "image/jpeg,image/png,image/webp")
    )
    # Hard cap on raw HTTP request body bytes (defence-in-depth before Pydantic).
    # Default sized to comfortably hold a 3MB base64 image plus envelope overhead.
    max_request_body_bytes: int = _parse_int(
        os.getenv("ML_MAX_REQUEST_BODY_BYTES"), 5_000_000, minimum=1_024
    )

    # Rate limits per minute. ``0`` disables the limit for that route.
    rate_limit_recommend_per_minute: int = _parse_int(os.getenv("ML_RATE_LIMIT_RECOMMEND_PER_MINUTE"), 120, minimum=0)
    rate_limit_analyze_per_minute: int = _parse_int(os.getenv("ML_RATE_LIMIT_ANALYZE_PER_MINUTE"), 30, minimum=0)
    rate_limit_health_per_minute: int = _parse_int(os.getenv("ML_RATE_LIMIT_HEALTH_PER_MINUTE"), 600, minimum=0)
    rate_limit_admin_per_minute: int = _parse_int(os.getenv("ML_RATE_LIMIT_ADMIN_PER_MINUTE"), 12, minimum=0)

    # Logging & CORS.
    log_level: str = os.getenv("ML_LOG_LEVEL", "INFO").strip().upper()
    log_json: bool = _parse_bool(os.getenv("ML_LOG_JSON"), True)
    cors_allow_origins: tuple[str, ...] = _parse_csv(os.getenv("ML_CORS_ALLOW_ORIGINS"))

    # Behaviour flags.
    warm_up_model: bool = _parse_bool(os.getenv("ML_WARM_UP_MODEL"), True)
    expose_error_details: bool = _parse_bool(os.getenv("ML_EXPOSE_ERROR_DETAILS"), False)

    # Recommendation cache. ``recommendation_cache_size=0`` disables caching entirely.
    recommendation_cache_size: int = _parse_int(os.getenv("ML_RECOMMENDATION_CACHE_SIZE"), 1024, minimum=0)
    recommendation_cache_ttl_seconds: float = _parse_float(
        os.getenv("ML_RECOMMENDATION_CACHE_TTL_SECONDS"), 300.0, minimum=0.0
    )

    # Metrics endpoint.
    metrics_enabled: bool = _parse_bool(os.getenv("ML_METRICS_ENABLED"), True)
    metrics_require_secret: bool = _parse_bool(os.getenv("ML_METRICS_REQUIRE_SECRET"), False)

    # Model integrity pinning. Empty values disable the check.
    expected_model_version: str = _normalize_secret(os.getenv("ML_EXPECTED_MODEL_VERSION"))
    expected_model_sha256: str = _normalize_secret(os.getenv("ML_EXPECTED_MODEL_SHA256")).lower()

    # Feedback ingestion. Empty path disables disk persistence (still accepts requests).
    feedback_log_path: str = os.getenv("ML_FEEDBACK_LOG_PATH", "train/data/fit_feedback_runtime.jsonl").strip()
    feedback_max_payload_chars: int = _parse_int(os.getenv("ML_FEEDBACK_MAX_PAYLOAD_CHARS"), 16_384, minimum=256)
    rate_limit_feedback_per_minute: int = _parse_int(os.getenv("ML_RATE_LIMIT_FEEDBACK_PER_MINUTE"), 240, minimum=0)

    # Batch recommendation guardrails.
    recommend_batch_max_items: int = _parse_int(os.getenv("ML_RECOMMEND_BATCH_MAX_ITEMS"), 32, minimum=1)
    recommend_batch_timeout_seconds: float = _parse_float(
        os.getenv("ML_RECOMMEND_BATCH_TIMEOUT_SECONDS"), 8.0, minimum=0.0
    )

    # Build / deployment provenance.
    git_sha: str = (os.getenv("ML_GIT_SHA") or os.getenv("GIT_SHA") or "").strip()
    build_label: str = os.getenv("ML_BUILD_LABEL", "").strip()

    # Phase 3 — feature flags.
    feature_nan_missing: bool = _parse_bool(os.getenv("ML_FEATURE_NAN_MISSING"), False)
    enable_v1_aliases: bool = _parse_bool(os.getenv("ML_ENABLE_V1_ALIASES"), True)

    # Idempotency-Key support for /recommend-size.
    idempotency_cache_size: int = _parse_int(os.getenv("ML_IDEMPOTENCY_CACHE_SIZE"), 1024, minimum=0)
    idempotency_cache_ttl_seconds: float = _parse_float(
        os.getenv("ML_IDEMPOTENCY_CACHE_TTL_SECONDS"), 600.0, minimum=0.0
    )

    # Body analysis camera-phase guards.
    body_max_frames: int = _parse_int(os.getenv("ML_BODY_MAX_FRAMES"), 3, minimum=1)
    body_min_frame_visibility: float = _parse_float(
        os.getenv("ML_BODY_MIN_FRAME_VISIBILITY"), 0.4, minimum=0.0
    )
    body_min_image_dimension: int = _parse_int(os.getenv("ML_BODY_MIN_IMAGE_DIMENSION"), 0, minimum=0)

    # Calibration artifact (optional). Empty disables runtime calibration.
    calibration_path: str = os.getenv("ML_CALIBRATION_PATH", "").strip()

    # Shadow model (M7) + canary tolerance (M8).
    shadow_model_path: str = os.getenv("ML_SHADOW_MODEL_PATH", "").strip()
    shadow_sample_rate: float = _parse_float(os.getenv("ML_SHADOW_SAMPLE_RATE"), 0.25, minimum=0.0)
    canary_max_score_delta: float = _parse_float(
        os.getenv("ML_CANARY_MAX_SCORE_DELTA"), 1.0, minimum=0.0
    )

    @property
    def is_production(self) -> bool:
        return self.app_env in {"production", "prod"}


settings = Settings()
