from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from types import SimpleNamespace

import numpy as np


PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from app.services.feature_builder import (  # noqa: E402
    FEATURE_ORDER,
    LENGTH_FIELDS,
    feature_map_to_vector,
    get_bias_offset,
    get_length_expectation,
    get_measurement_template_fields,
    estimate_body_profile,
    round_value,
)
from app.services.fit_scoring import evaluate_candidate_size  # noqa: E402


CATEGORY_OPTIONS = ("Men", "Women", "Kids")
TEMPLATE_OPTIONS_BY_CATEGORY = {
    "Men": ("topwear", "bottomwear", "outerwear"),
    "Women": ("topwear", "bottomwear", "dress", "outerwear"),
    "Kids": ("kids_general", "topwear", "bottomwear"),
}
SIZE_LABELS_BY_TEMPLATE = {
    "topwear": ("XS", "S", "M", "L", "XL"),
    "bottomwear": ("28", "30", "32", "34", "36"),
    "dress": ("XS", "S", "M", "L", "XL"),
    "outerwear": ("S", "M", "L", "XL"),
    "kids_general": ("4Y", "6Y", "8Y", "10Y", "12Y"),
}
NON_LENGTH_STEP_BY_FIELD = {
    "chest": 5.2,
    "waist": 4.4,
    "hip": 5.0,
    "shoulder": 1.15,
}
LENGTH_STEP_BY_FIELD = {
    "sleeveLength": 1.3,
    "inseam": 2.1,
    "garmentLength": 2.0,
}
BASE_EASE_BY_TEMPLATE = {
    "topwear": {"chest": 8.5, "shoulder": 1.3},
    "bottomwear": {"waist": 4.2, "hip": 7.4, "inseam": 0.0},
    "dress": {"chest": 7.5, "waist": 4.0, "hip": 7.0},
    "outerwear": {"chest": 10.0, "shoulder": 1.8, "sleeveLength": 0.6},
    "kids_general": {"chest": 7.0, "waist": 5.0, "hip": 6.0},
}


def _choose_height_weight(rng: np.random.Generator, category: str) -> tuple[float, float]:
    if category == "Women":
        height = rng.uniform(148, 182)
        weight = rng.uniform(42, 95)
    elif category == "Kids":
        height = rng.uniform(92, 160)
        weight = rng.uniform(20, 58)
    else:
        height = rng.uniform(156, 198)
        weight = rng.uniform(50, 118)

    return round_value(height, 2), round_value(weight, 2)


def _choose_body_features(rng: np.random.Generator) -> SimpleNamespace | None:
    if rng.random() < 0.35:
        return None

    return SimpleNamespace(
        shoulderRatio=round_value(rng.uniform(0.92, 1.08), 4),
        hipRatio=round_value(rng.uniform(0.92, 1.08), 4),
        torsoRatio=round_value(rng.uniform(0.95, 1.12), 4),
        scanQuality=round_value(rng.uniform(0.35, 0.96), 4),
    )


def _build_size_chart(
    *,
    rng: np.random.Generator,
    category: str,
    measurement_template: str,
    fit_bias: str,
) -> list[SimpleNamespace]:
    size_labels = SIZE_LABELS_BY_TEMPLATE[measurement_template]
    center_height, center_weight = _choose_height_weight(rng, category)
    center_profile = estimate_body_profile(
        height_cm=center_height,
        weight_kg=center_weight,
        category=category,
        preferred_fit="regular",
    )
    required_fields = get_measurement_template_fields(measurement_template)
    bias_offset = get_bias_offset(fit_bias)
    center_index = (len(size_labels) - 1) / 2
    chart: list[SimpleNamespace] = []

    for size_index, size_label in enumerate(size_labels):
        offset = size_index - center_index
        row = {"size": size_label}

        for field in ("chest", "waist", "hip", "shoulder", "sleeveLength", "inseam", "garmentLength"):
            if field not in required_fields and rng.random() < 0.7:
                row[field] = None
                continue

            if field in LENGTH_FIELDS:
                base_measurement = get_length_expectation(center_height, measurement_template, field)
                measured_value = base_measurement + (offset * LENGTH_STEP_BY_FIELD.get(field, 1.2)) + rng.normal(0, 0.6)
                row[field] = round_value(max(measured_value, 10), 2)
                continue

            base_ease = BASE_EASE_BY_TEMPLATE.get(measurement_template, {}).get(field, 5.0)
            base_measurement = center_profile.get(field, 60) + base_ease
            measured_value = base_measurement + (offset * NON_LENGTH_STEP_BY_FIELD.get(field, 3.8)) + rng.normal(0, 0.95)
            row[field] = round_value(max(measured_value - bias_offset, 10), 2)

        chart.append(SimpleNamespace(**row))

    return chart


def build_training_dataset(*, row_target: int = 12_000, seed: int = 17) -> dict[str, object]:
    rng = np.random.default_rng(seed)
    feature_rows: list[list[float]] = []
    targets: list[float] = []
    group_ids: list[str] = []
    segments: list[tuple[str, str, str]] = []
    category_counts = {category: 0 for category in CATEGORY_OPTIONS}
    template_counts = {template: 0 for template in SIZE_LABELS_BY_TEMPLATE}
    fit_bias_counts = {fit_bias: 0 for fit_bias in ("runs_small", "true_to_size", "runs_large")}
    product_count = 0

    while len(feature_rows) < row_target:
        category = str(rng.choice(CATEGORY_OPTIONS, p=[0.42, 0.4, 0.18]))
        measurement_template = str(rng.choice(TEMPLATE_OPTIONS_BY_CATEGORY[category]))
        preferred_fit = str(rng.choice(("slim", "regular", "relaxed"), p=[0.22, 0.53, 0.25]))
        fit_bias = str(rng.choice(("runs_small", "true_to_size", "runs_large"), p=[0.2, 0.58, 0.22]))
        stretch_score = round_value(rng.uniform(0.05, 0.88), 4)
        size_chart = _build_size_chart(
            rng=rng,
            category=category,
            measurement_template=measurement_template,
            fit_bias=fit_bias,
        )

        product_count += 1
        category_counts[category] += 1
        template_counts[measurement_template] += 1
        fit_bias_counts[fit_bias] += 1

        for _ in range(int(rng.integers(12, 24))):
            height_cm, weight_kg = _choose_height_weight(rng, category)
            body_features = _choose_body_features(rng)
            user_metrics = SimpleNamespace(
                heightCm=height_cm,
                weightKg=weight_kg,
                preferredFit=preferred_fit,
            )
            estimated_body_profile = estimate_body_profile(
                height_cm=height_cm,
                weight_kg=weight_kg,
                category=category,
                preferred_fit=preferred_fit,
                body_features=body_features.__dict__ if body_features else None,
            )

            for size_entry in size_chart:
                evaluation = evaluate_candidate_size(
                    size_entry=size_entry,
                    measurement_template=measurement_template,
                    fit_bias=fit_bias,
                    stretch_score=stretch_score,
                    user_metrics=user_metrics,
                    estimated_body_profile=estimated_body_profile,
                    body_features=body_features,
                )
                feature_rows.append(feature_map_to_vector(evaluation["featureVector"]))
                targets.append(float(evaluation["fitScore"]))
                group_ids.append(f"syn-{product_count:06d}")
                segments.append((category, fit_bias, preferred_fit))

                if len(feature_rows) >= row_target:
                    break

            if len(feature_rows) >= row_target:
                break

    features = np.asarray(feature_rows, dtype=np.float32)
    target_values = np.asarray(targets, dtype=np.float32)

    return {
        "features": features,
        "targets": target_values,
        "featureOrder": list(FEATURE_ORDER),
        "groupIds": list(group_ids),
        "segments": list(segments),
        "summary": {
            "source": "synthetic_bootstrap",
            "rows": int(features.shape[0]),
            "featureCount": int(features.shape[1]) if features.ndim == 2 else 0,
            "products": product_count,
            "categoryCounts": category_counts,
            "templateCounts": template_counts,
            "fitBiasCounts": fit_bias_counts,
            "targetMean": round_value(float(target_values.mean()), 4) if len(target_values) else 0.0,
            "targetStd": round_value(float(target_values.std()), 4) if len(target_values) else 0.0,
        },
    }


def export_dataset_preview(dataset: dict[str, object], output_path: Path, *, preview_limit: int = 300) -> Path:
    output_path.parent.mkdir(parents=True, exist_ok=True)
    features = np.asarray(dataset["features"], dtype=float)
    targets = np.asarray(dataset["targets"], dtype=float)
    feature_order = list(dataset["featureOrder"])

    with output_path.open("w", encoding="utf-8") as output_file:
        for index in range(min(len(features), preview_limit)):
            row = {
                "targetFitScore": round_value(targets[index], 4),
                "features": {
                    feature_name: round_value(features[index][feature_index], 4)
                    for feature_index, feature_name in enumerate(feature_order)
                },
            }
            output_file.write(json.dumps(row) + "\n")

    return output_path


def main() -> None:
    parser = argparse.ArgumentParser(description="Build a synthetic cold-start dataset for fit-model training.")
    parser.add_argument("--rows", type=int, default=12_000, help="Number of candidate rows to generate.")
    parser.add_argument("--seed", type=int, default=17, help="Random seed for reproducible dataset generation.")
    parser.add_argument(
        "--output",
        type=Path,
        default=None,
        help="Optional JSONL preview output path for inspecting a subset of generated rows.",
    )
    parser.add_argument(
        "--preview-limit",
        type=int,
        default=300,
        help="Maximum preview rows to export when --output is provided.",
    )
    args = parser.parse_args()

    dataset = build_training_dataset(row_target=max(args.rows, 200), seed=args.seed)
    if args.output:
        export_dataset_preview(dataset, args.output, preview_limit=max(args.preview_limit, 1))

    print(json.dumps(dataset["summary"], indent=2))


if __name__ == "__main__":
    main()
