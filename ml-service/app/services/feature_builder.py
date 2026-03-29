from __future__ import annotations

from typing import Iterable


MEASUREMENT_FIELDS = ("chest", "waist", "hip", "shoulder", "sleeveLength", "inseam", "garmentLength")
LENGTH_FIELDS = {"sleeveLength", "inseam", "garmentLength"}
FIELD_WEIGHTS = {
    "chest": 1.4,
    "waist": 1.25,
    "hip": 1.25,
    "shoulder": 1.15,
    "sleeveLength": 0.55,
    "inseam": 0.8,
    "garmentLength": 0.65
}
FIT_EASE_BY_FIELD = {
    "chest": {"slim": 4, "regular": 8, "relaxed": 12},
    "waist": {"slim": 2, "regular": 5, "relaxed": 8},
    "hip": {"slim": 3, "regular": 6, "relaxed": 9},
    "shoulder": {"slim": 0.5, "regular": 1.5, "relaxed": 3}
}
MEASUREMENT_TEMPLATES = {
    "topwear": ("chest", "shoulder", "garmentLength"),
    "bottomwear": ("waist", "hip", "inseam"),
    "dress": ("chest", "waist", "hip", "garmentLength"),
    "outerwear": ("chest", "shoulder", "sleeveLength", "garmentLength"),
    "kids_general": ("chest", "waist", "hip", "garmentLength")
}
CATEGORY_BODY_FACTORS = {
    "Men": {
        "chest": {"height": 0.51, "weight": 0.21, "base": -2},
        "waist": {"height": 0.42, "weight": 0.22, "base": -4},
        "hip": {"height": 0.50, "weight": 0.18, "base": -6},
        "shoulder": {"height": 0.255, "weight": 0.015, "base": -1}
    },
    "Women": {
        "chest": {"height": 0.49, "weight": 0.18, "base": -4},
        "waist": {"height": 0.39, "weight": 0.20, "base": -5},
        "hip": {"height": 0.54, "weight": 0.17, "base": -6},
        "shoulder": {"height": 0.235, "weight": 0.01, "base": -0.5}
    },
    "Kids": {
        "chest": {"height": 0.47, "weight": 0.12, "base": 4},
        "waist": {"height": 0.40, "weight": 0.12, "base": 1},
        "hip": {"height": 0.48, "weight": 0.13, "base": 2},
        "shoulder": {"height": 0.23, "weight": 0.008, "base": 0}
    }
}
FEATURE_ORDER = [
    "heightCm",
    "weightKg",
    "bmi",
    "preferredFitSlim",
    "preferredFitRelaxed",
    "stretchScore",
    "fitBiasRunsSmall",
    "fitBiasRunsLarge",
    "scanQuality",
    "shoulderRatio",
    "hipRatio",
    "torsoRatio",
    "chestDelta",
    "waistDelta",
    "hipDelta",
    "shoulderDelta",
    "sleeveLengthDelta",
    "inseamDelta",
    "garmentLengthDelta",
    "requiredCoverage"
]


def clamp(value: float, minimum: float, maximum: float) -> float:
    return min(maximum, max(minimum, value))


def round_value(value: float | int, precision: int = 4) -> float:
    return round(float(value), precision)


def get_measurement_template_fields(template: str) -> tuple[str, ...]:
    return MEASUREMENT_TEMPLATES.get(template, MEASUREMENT_TEMPLATES["topwear"])


def get_length_expectation(height_cm: float, measurement_template: str, field: str) -> float:
    if field == "inseam":
        return height_cm * 0.45
    if field == "sleeveLength":
        return height_cm * 0.34

    garment_length_multipliers = {
        "topwear": 0.42,
        "bottomwear": 0.45,
        "dress": 0.63,
        "outerwear": 0.47,
        "kids_general": 0.41
    }
    return height_cm * garment_length_multipliers.get(measurement_template, 0.42)


def get_bias_offset(fit_bias: str) -> float:
    if fit_bias == "runs_small":
        return -1.25
    if fit_bias == "runs_large":
        return 1.25
    return 0


def estimate_body_profile(
    *,
    height_cm: float,
    weight_kg: float,
    category: str,
    preferred_fit: str,
    body_features: dict[str, float | None] | None = None
) -> dict[str, float]:
    normalized_category = category if category in CATEGORY_BODY_FACTORS else "Men"
    factors = CATEGORY_BODY_FACTORS[normalized_category]
    height_meters = height_cm / 100
    bmi = weight_kg / max(height_meters * height_meters, 0.1)
    frame_adjustment = clamp((bmi - 22) * 0.55, -4, 7)
    fit_adjustment = 0.6 if preferred_fit == "relaxed" else -0.35 if preferred_fit == "slim" else 0

    estimated = {
        "chest": round_value(factors["chest"]["height"] * height_cm + factors["chest"]["weight"] * weight_kg + factors["chest"]["base"] + frame_adjustment),
        "waist": round_value(factors["waist"]["height"] * height_cm + factors["waist"]["weight"] * weight_kg + factors["waist"]["base"] + frame_adjustment),
        "hip": round_value(factors["hip"]["height"] * height_cm + factors["hip"]["weight"] * weight_kg + factors["hip"]["base"] + frame_adjustment * 0.6),
        "shoulder": round_value(
            factors["shoulder"]["height"] * height_cm + factors["shoulder"]["weight"] * weight_kg + factors["shoulder"]["base"] + fit_adjustment
        ),
        "bmi": round_value(bmi)
    }

    if body_features:
        quality = clamp(float(body_features.get("scanQuality") or 0), 0, 1)
        if quality > 0.3:
            shoulder_multiplier = clamp(float(body_features.get("shoulderRatio") or 1), 0.85, 1.18)
            hip_multiplier = clamp(float(body_features.get("hipRatio") or 1), 0.85, 1.18)
            torso_multiplier = clamp(float(body_features.get("torsoRatio") or 1), 0.9, 1.14)
            estimated["shoulder"] = round_value(estimated["shoulder"] * (1 + (shoulder_multiplier - 1) * quality))
            estimated["hip"] = round_value(estimated["hip"] * (1 + (hip_multiplier - 1) * quality))
            blended_upper_body = (shoulder_multiplier + torso_multiplier) / 2
            estimated["chest"] = round_value(estimated["chest"] * (1 + (blended_upper_body - 1) * quality))

    return estimated


def get_target_measurement(
    *,
    field: str,
    estimated_body_profile: dict[str, float],
    stretch_score: float,
    preferred_fit: str,
    height_cm: float,
    measurement_template: str
) -> float:
    if field in LENGTH_FIELDS:
        return get_length_expectation(height_cm, measurement_template, field)

    preferred_ease = FIT_EASE_BY_FIELD.get(field, FIT_EASE_BY_FIELD["waist"]).get(preferred_fit, 5)
    stretch_adjustment = stretch_score * 0.75 if field == "shoulder" else stretch_score * 2.2
    return estimated_body_profile[field] + max(0, preferred_ease - stretch_adjustment)


def build_candidate_feature_map(
    *,
    size_entry,
    measurement_template: str,
    fit_bias: str,
    stretch_score: float,
    user_metrics,
    estimated_body_profile: dict[str, float],
    body_features
) -> dict[str, float]:
    required_fields = get_measurement_template_fields(measurement_template)
    bias_offset = get_bias_offset(fit_bias)
    feature_map: dict[str, float] = {
        "heightCm": round_value(user_metrics.heightCm),
        "weightKg": round_value(user_metrics.weightKg),
        "bmi": round_value(estimated_body_profile["bmi"]),
        "preferredFitSlim": 1.0 if user_metrics.preferredFit == "slim" else 0.0,
        "preferredFitRelaxed": 1.0 if user_metrics.preferredFit == "relaxed" else 0.0,
        "stretchScore": round_value(stretch_score),
        "fitBiasRunsSmall": 1.0 if fit_bias == "runs_small" else 0.0,
        "fitBiasRunsLarge": 1.0 if fit_bias == "runs_large" else 0.0,
        "scanQuality": round_value(getattr(body_features, "scanQuality", None) or 0),
        "shoulderRatio": round_value(getattr(body_features, "shoulderRatio", None) or 1),
        "hipRatio": round_value(getattr(body_features, "hipRatio", None) or 1),
        "torsoRatio": round_value(getattr(body_features, "torsoRatio", None) or 1),
        "requiredCoverage": 0
    }

    covered_fields = 0
    for field in MEASUREMENT_FIELDS:
        measurement = getattr(size_entry, field, None)
        if measurement is None:
            feature_map[f"{field}Delta"] = -6.0
            continue

        adjusted_measurement = measurement if field in LENGTH_FIELDS else measurement + bias_offset
        target_measurement = get_target_measurement(
            field=field,
            estimated_body_profile=estimated_body_profile,
            stretch_score=stretch_score,
            preferred_fit=user_metrics.preferredFit,
            height_cm=user_metrics.heightCm,
            measurement_template=measurement_template
        )
        feature_map[f"{field}Delta"] = round_value(adjusted_measurement - target_measurement)

        if field in required_fields:
            covered_fields += 1

    feature_map["requiredCoverage"] = round_value(covered_fields / max(len(required_fields), 1))
    return feature_map


def feature_map_to_vector(feature_map: dict[str, float]) -> list[float]:
    return [float(feature_map.get(feature_name, 0)) for feature_name in FEATURE_ORDER]


def mean(values: Iterable[float]) -> float:
    materialized = list(values)
    return sum(materialized) / len(materialized) if materialized else 0
