from __future__ import annotations

from app.schemas.request_models import AnalyzeBodyRequest, LandmarkInput
from app.schemas.response_models import AnalyzeBodyResponse, BodyFeaturesResponse
from app.services.feature_builder import clamp, round_value
from app.utils.image_utils import decode_data_url_image, get_image_dimensions


LEFT_SHOULDER_INDEX = 11
RIGHT_SHOULDER_INDEX = 12
LEFT_HIP_INDEX = 23
RIGHT_HIP_INDEX = 24


def _distance(first_point: LandmarkInput, second_point: LandmarkInput) -> float:
    x_delta = first_point.x - second_point.x
    y_delta = first_point.y - second_point.y
    return (x_delta ** 2 + y_delta ** 2) ** 0.5


def _analyze_image_heuristics(payload: AnalyzeBodyRequest) -> AnalyzeBodyResponse:
    _, image_bytes = decode_data_url_image(payload.imageBase64 or "")
    width, height = get_image_dimensions(image_bytes)

    if width <= 0 or height <= 0:
        raise ValueError("The scan image dimensions are invalid.")

    aspect_ratio = width / max(height, 1)
    resolution_score = clamp(min(width, height) / 720, 0.18, 1)
    portrait_score = clamp(1 - abs(aspect_ratio - 0.58) * 1.6, 0.22, 0.82)
    payload_size_score = clamp(len(image_bytes) / 350_000, 0.15, 0.85)
    scan_quality = round_value(clamp((resolution_score * 0.42) + (portrait_score * 0.38) + (payload_size_score * 0.2), 0.24, 0.58), 4)

    shoulder_ratio = round_value(clamp(1 + ((aspect_ratio - 0.55) * 0.12), 0.94, 1.06), 4)
    hip_ratio = round_value(clamp(1 - ((aspect_ratio - 0.55) * 0.08), 0.95, 1.05), 4)
    torso_ratio = round_value(clamp(1.06 + ((0.62 - aspect_ratio) * 0.18), 0.96, 1.16), 4)

    return AnalyzeBodyResponse(
        bodyFeatures=BodyFeaturesResponse(
            shoulderRatio=shoulder_ratio,
            hipRatio=hip_ratio,
            torsoRatio=torso_ratio,
            scanQuality=scan_quality
        ),
        meta={
            "source": "image_heuristic",
            "imageStored": False
        }
    )


def analyze_body_request(payload: AnalyzeBodyRequest) -> AnalyzeBodyResponse:
    if not payload.landmarks:
        if payload.imageBase64:
            return _analyze_image_heuristics(payload)

        raise NotImplementedError(
            "Image-only body analysis is reserved for the camera phase and needs the pose pipeline to be enabled."
        )

    if len(payload.landmarks) <= RIGHT_HIP_INDEX:
        raise ValueError("Pose landmarks are incomplete for body analysis.")

    left_shoulder = payload.landmarks[LEFT_SHOULDER_INDEX]
    right_shoulder = payload.landmarks[RIGHT_SHOULDER_INDEX]
    left_hip = payload.landmarks[LEFT_HIP_INDEX]
    right_hip = payload.landmarks[RIGHT_HIP_INDEX]

    shoulder_width = _distance(left_shoulder, right_shoulder)
    hip_width = _distance(left_hip, right_hip)
    torso_height = abs(((left_shoulder.y + right_shoulder.y) / 2) - ((left_hip.y + right_hip.y) / 2))
    average_visibility = sum(point.visibility or 0.8 for point in [left_shoulder, right_shoulder, left_hip, right_hip]) / 4

    if shoulder_width <= 0 or hip_width <= 0:
        raise ValueError("Pose landmarks could not produce stable body features.")

    body_features = BodyFeaturesResponse(
        shoulderRatio=round_value(shoulder_width / hip_width, 4),
        hipRatio=round_value(hip_width / shoulder_width, 4),
        torsoRatio=round_value(torso_height / shoulder_width, 4),
        scanQuality=round_value(clamp(average_visibility, 0, 1), 4)
    )

    return AnalyzeBodyResponse(
        bodyFeatures=body_features,
        meta={
            "source": "landmarks",
            "imageStored": False
        }
    )
