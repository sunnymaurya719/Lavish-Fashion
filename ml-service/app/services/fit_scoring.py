from __future__ import annotations

from app.services.feature_builder import (
    FIELD_WEIGHTS,
    build_candidate_feature_map,
    get_bias_offset,
    get_measurement_template_fields,
    get_target_measurement,
    round_value,
)


LENGTH_FIELDS = {"sleeveLength", "inseam", "garmentLength"}


def evaluate_candidate_size(
    *,
    size_entry,
    measurement_template: str,
    fit_bias: str,
    stretch_score: float,
    user_metrics,
    estimated_body_profile: dict[str, float],
    body_features=None,
) -> dict:
    required_fields = get_measurement_template_fields(measurement_template)
    bias_offset = get_bias_offset(fit_bias)

    total_penalty = 0.0
    weighted_score = 0.0
    total_weight = 0.0
    field_breakdown: list[dict] = []

    for field in required_fields:
        measurement = getattr(size_entry, field, None)
        weight = FIELD_WEIGHTS.get(field, 1)
        total_weight += weight

        if measurement is None:
            total_penalty += 6
            field_breakdown.append({"field": field, "penalty": 6, "delta": -6, "measurement": None})
            continue

        adjusted_measurement = measurement if field in LENGTH_FIELDS else measurement + bias_offset
        target_measurement = get_target_measurement(
            field=field,
            estimated_body_profile=estimated_body_profile,
            stretch_score=stretch_score,
            preferred_fit=user_metrics.preferredFit,
            height_cm=user_metrics.heightCm,
            measurement_template=measurement_template,
        )
        delta = adjusted_measurement - target_measurement

        if field in LENGTH_FIELDS:
            penalty = abs(delta) * 0.22 * weight
        elif delta >= 0:
            penalty = delta * 0.35 * weight
        else:
            penalty = abs(delta) * 1.1 * weight

        total_penalty += penalty
        weighted_score += delta * weight
        field_breakdown.append(
            {
                "field": field,
                "penalty": round_value(penalty, 2),
                "delta": round_value(delta, 2),
                "measurement": round_value(adjusted_measurement, 2),
            }
        )

    return {
        "size": size_entry.size,
        "penalty": round_value(total_penalty, 2),
        "fitScore": round_value(weighted_score / max(total_weight, 1), 2),
        "fieldBreakdown": sorted(field_breakdown, key=lambda item: item["penalty"]),
        "featureVector": build_candidate_feature_map(
            size_entry=size_entry,
            measurement_template=measurement_template,
            fit_bias=fit_bias,
            stretch_score=stretch_score,
            user_metrics=user_metrics,
            estimated_body_profile=estimated_body_profile,
            body_features=body_features,
        ),
    }
