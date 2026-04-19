from __future__ import annotations

from statistics import median

from app.core.config import settings
from app.core.metrics import metrics
from app.schemas.request_models import AnalyzeBodyRequest, LandmarkInput
from app.schemas.response_models import (
    AnalyzeBodyMeta,
    AnalyzeBodyResponse,
    BodyFeaturesResponse,
)
from app.services.feature_builder import clamp, round_value
from app.utils.image_utils import (
    _read_jpeg_exif_orientation,
    decode_data_url_image,
    get_image_dimensions,
)


LEFT_SHOULDER_INDEX = 11
RIGHT_SHOULDER_INDEX = 12
LEFT_HIP_INDEX = 23
RIGHT_HIP_INDEX = 24


class BodyQualityError(ValueError):
    """Raised when a body scan fails its quality gates (HTTP 422 in routes)."""

    def __init__(self, message: str, *, reason: str) -> None:
        super().__init__(message)
        self.reason = reason


def _distance(first_point: LandmarkInput, second_point: LandmarkInput) -> float:
    x_delta = first_point.x - second_point.x
    y_delta = first_point.y - second_point.y
    return (x_delta ** 2 + y_delta ** 2) ** 0.5


def _heuristics_from_image(image_data_url: str) -> tuple[BodyFeaturesResponse, dict[str, object]]:
    _, image_bytes = decode_data_url_image(image_data_url or "")
    width, height = get_image_dimensions(image_bytes)
    orientation = (
        _read_jpeg_exif_orientation(image_bytes) if image_bytes[:2] == b"\xff\xd8" else 1
    )

    if width <= 0 or height <= 0:
        raise BodyQualityError("The scan image dimensions are invalid.", reason="invalid_dimensions")

    short_edge = min(width, height)
    if short_edge < settings.body_min_image_dimension:
        metrics.body_quality_rejections_total.inc(reason="image_too_small")
        raise BodyQualityError(
            f"The scan image is too small (min edge {short_edge}px < {settings.body_min_image_dimension}px).",
            reason="image_too_small",
        )

    aspect_ratio = width / max(height, 1)
    resolution_score = clamp(min(width, height) / 720, 0.18, 1)
    portrait_score = clamp(1 - abs(aspect_ratio - 0.58) * 1.6, 0.22, 0.82)
    payload_size_score = clamp(len(image_bytes) / 350_000, 0.15, 0.85)
    scan_quality = round_value(
        clamp(
            (resolution_score * 0.42)
            + (portrait_score * 0.38)
            + (payload_size_score * 0.2),
            0.24,
            0.58,
        ),
        4,
    )

    shoulder_ratio = round_value(clamp(1 + ((aspect_ratio - 0.55) * 0.12), 0.94, 1.06), 4)
    hip_ratio = round_value(clamp(1 - ((aspect_ratio - 0.55) * 0.08), 0.95, 1.05), 4)
    torso_ratio = round_value(clamp(1.06 + ((0.62 - aspect_ratio) * 0.18), 0.96, 1.16), 4)

    body_features = BodyFeaturesResponse(
        shoulderRatio=shoulder_ratio,
        hipRatio=hip_ratio,
        torsoRatio=torso_ratio,
        scanQuality=scan_quality,
    )
    diagnostic = {
        "imageWidth": width,
        "imageHeight": height,
        "exifOrientation": orientation,
    }
    return body_features, diagnostic


def _analyze_image_heuristics(payload: AnalyzeBodyRequest) -> AnalyzeBodyResponse:
    body_features, diagnostic = _heuristics_from_image(payload.imageBase64 or "")
    return AnalyzeBodyResponse(
        bodyFeatures=body_features,
        meta=AnalyzeBodyMeta(
            source="image_heuristic",
            imageWidth=int(diagnostic["imageWidth"]),
            imageHeight=int(diagnostic["imageHeight"]),
            exifOrientation=int(diagnostic["exifOrientation"]),
            frameCount=1,
        ),
    )


def _analyze_frames(payload: AnalyzeBodyRequest) -> AnalyzeBodyResponse:
    frame_data_urls = list(payload.frames or [])
    if payload.imageBase64 and payload.imageBase64 not in frame_data_urls:
        frame_data_urls.insert(0, payload.imageBase64)
    if not frame_data_urls:
        raise BodyQualityError("No frames supplied for fusion.", reason="no_frames")

    metrics.body_frame_count.observe(len(frame_data_urls))

    per_frame_features: list[BodyFeaturesResponse] = []
    last_diagnostic: dict[str, object] = {}
    for frame_data_url in frame_data_urls:
        features, diagnostic = _heuristics_from_image(frame_data_url)
        per_frame_features.append(features)
        last_diagnostic = diagnostic

    if not per_frame_features:
        raise BodyQualityError(
            "All frames were rejected by quality gates.",
            reason="all_frames_rejected",
        )

    shoulder_values = [feature.shoulderRatio for feature in per_frame_features]
    hip_values = [feature.hipRatio for feature in per_frame_features]
    torso_values = [feature.torsoRatio for feature in per_frame_features]
    quality_values = [feature.scanQuality for feature in per_frame_features]

    shoulder_ratio = round_value(median(shoulder_values), 4)
    hip_ratio = round_value(median(hip_values), 4)
    torso_ratio = round_value(median(torso_values), 4)
    scan_quality = round_value(median(quality_values), 4)

    if len(shoulder_values) >= 2:
        spread = max(shoulder_values) - min(shoulder_values)
        frame_agreement = round_value(clamp(1 - (spread / 0.06), 0.0, 1.0), 4)
    else:
        frame_agreement = 1.0

    quality_flags: list[str] = []
    if frame_agreement < 0.6:
        quality_flags.append("low_frame_agreement")
    if scan_quality < 0.3:
        quality_flags.append("low_scan_quality")

    raw_width = int(last_diagnostic.get("imageWidth", 0)) or None
    raw_height = int(last_diagnostic.get("imageHeight", 0)) or None
    raw_orientation = int(last_diagnostic.get("exifOrientation", 1))

    return AnalyzeBodyResponse(
        bodyFeatures=BodyFeaturesResponse(
            shoulderRatio=shoulder_ratio,
            hipRatio=hip_ratio,
            torsoRatio=torso_ratio,
            scanQuality=scan_quality,
        ),
        meta=AnalyzeBodyMeta(
            source="frames_fused",
            imageWidth=raw_width,
            imageHeight=raw_height,
            exifOrientation=raw_orientation,
            frameCount=len(per_frame_features),
            frameAgreement=frame_agreement,
            qualityFlags=quality_flags,
        ),
    )


def _analyze_landmarks(payload: AnalyzeBodyRequest) -> AnalyzeBodyResponse:
    landmarks = payload.landmarks or []
    if len(landmarks) <= RIGHT_HIP_INDEX:
        raise BodyQualityError(
            "Pose landmarks are incomplete for body analysis.",
            reason="incomplete_landmarks",
        )

    left_shoulder = landmarks[LEFT_SHOULDER_INDEX]
    right_shoulder = landmarks[RIGHT_SHOULDER_INDEX]
    left_hip = landmarks[LEFT_HIP_INDEX]
    right_hip = landmarks[RIGHT_HIP_INDEX]

    shoulder_width = _distance(left_shoulder, right_shoulder)
    hip_width = _distance(left_hip, right_hip)
    torso_height = abs(
        ((left_shoulder.y + right_shoulder.y) / 2)
        - ((left_hip.y + right_hip.y) / 2)
    )
    key_points = [left_shoulder, right_shoulder, left_hip, right_hip]
    average_visibility = sum(point.visibility or 0.8 for point in key_points) / 4

    if shoulder_width <= 0 or hip_width <= 0:
        raise BodyQualityError(
            "Pose landmarks could not produce stable body features.",
            reason="degenerate_landmarks",
        )

    if average_visibility < settings.body_min_frame_visibility:
        metrics.body_quality_rejections_total.inc(reason="low_visibility")
        raise BodyQualityError(
            f"Average landmark visibility {average_visibility:.2f} is below the configured threshold "
            f"{settings.body_min_frame_visibility:.2f}.",
            reason="low_visibility",
        )

    body_features = BodyFeaturesResponse(
        shoulderRatio=round_value(shoulder_width / hip_width, 4),
        hipRatio=round_value(hip_width / shoulder_width, 4),
        torsoRatio=round_value(torso_height / shoulder_width, 4),
        scanQuality=round_value(clamp(average_visibility, 0, 1), 4),
    )

    return AnalyzeBodyResponse(
        bodyFeatures=body_features,
        meta=AnalyzeBodyMeta(
            source="landmarks",
            landmarkCount=len(landmarks),
            landmarkAvgVisibility=round_value(clamp(average_visibility, 0, 1), 4),
            frameCount=0,
        ),
    )


def analyze_body_request(payload: AnalyzeBodyRequest) -> AnalyzeBodyResponse:
    if payload.landmarks:
        return _analyze_landmarks(payload)
    if payload.frames:
        return _analyze_frames(payload)
    if payload.imageBase64:
        return _analyze_image_heuristics(payload)

    raise BodyQualityError(
        "No usable body input supplied (landmarks, image, or frames required).",
        reason="missing_input",
    )
