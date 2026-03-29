from __future__ import annotations

import json
import re
from collections import Counter, defaultdict
from pathlib import Path
from types import SimpleNamespace

import numpy as np

from app.services.feature_builder import (
    FEATURE_ORDER,
    feature_map_to_vector,
    estimate_body_profile,
    get_length_expectation,
    round_value,
)
from app.services.fit_scoring import evaluate_candidate_size


PROJECT_ROOT = Path(__file__).resolve().parents[1]
REPO_ROOT = PROJECT_ROOT.parent
DEFAULT_RENT_THE_RUNWAY_PATH = REPO_ROOT / "renttherunway_final_data.json"

HEIGHT_FEET_IN_PATTERN = re.compile(r"(?P<feet>\d+)\s*(?:ft|')\s*(?P<inches>\d+)?\s*(?:in|\")?", re.IGNORECASE)
WEIGHT_LBS_PATTERN = re.compile(r"(?P<weight>\d+(?:\.\d+)?)\s*lbs?", re.IGNORECASE)

BODY_TYPE_TO_PREFERRED_FIT = {
    "petite": "slim",
    "straight & narrow": "slim",
    "athletic": "regular",
    "pear": "regular",
    "hourglass": "regular",
    "full bust": "relaxed",
    "apple": "relaxed",
}
TEMPLATE_STRETCH_BY_TYPE = {
    "topwear": 0.35,
    "bottomwear": 0.18,
    "dress": 0.24,
    "outerwear": 0.12,
}
EASE_BY_TEMPLATE = {
    "topwear": {"chest": 8.5, "waist": 5.5, "hip": 5.5, "shoulder": 1.4},
    "bottomwear": {"waist": 4.0, "hip": 6.5},
    "dress": {"chest": 7.5, "waist": 4.5, "hip": 7.0, "shoulder": 1.2},
    "outerwear": {"chest": 10.5, "waist": 6.0, "hip": 6.0, "shoulder": 1.8},
}
LENGTH_EXTRA_BY_TEMPLATE = {
    "topwear": {"garmentLength": 0.0, "sleeveLength": 0.8},
    "bottomwear": {"inseam": 0.0},
    "dress": {"garmentLength": 2.5},
    "outerwear": {"garmentLength": 2.0, "sleeveLength": 1.1},
}


def parse_height_to_cm(value: str | None) -> float | None:
    text = str(value or "").strip().lower()
    if not text:
        return None

    match = HEIGHT_FEET_IN_PATTERN.search(text)
    if not match:
        return None

    feet = int(match.group("feet"))
    inches = int(match.group("inches") or 0)
    total_inches = (feet * 12) + inches
    return round_value(total_inches * 2.54, 2)


def parse_weight_to_kg(value: str | None) -> float | None:
    text = str(value or "").strip().lower()
    if not text:
        return None

    match = WEIGHT_LBS_PATTERN.search(text)
    if not match:
        return None

    pounds = float(match.group("weight"))
    return round_value(pounds * 0.45359237, 2)


def normalize_size_label(value) -> str:
    text = str(value or "").strip()
    if not text:
        return ""

    numeric_value = int(float(text)) if str(text).replace(".", "", 1).isdigit() else None
    return str(numeric_value) if numeric_value is not None else text.upper()


def sort_size_labels(size_labels: set[str]) -> list[str]:
    def sort_key(value: str):
        try:
            return (0, int(value))
        except ValueError:
            return (1, value)

    return sorted((label for label in size_labels if label), key=sort_key)


def map_rtr_category_to_template(category: str) -> str | None:
    normalized_category = str(category or "").strip().lower()
    if not normalized_category:
        return None

    if any(keyword in normalized_category for keyword in ("dress", "gown", "sheath", "shift", "maxi", "mini", "jumpsuit", "romper")):
        return "dress"
    if any(keyword in normalized_category for keyword in ("blazer", "jacket", "coat", "outerwear", "cardigan", "poncho")):
        return "outerwear"
    if any(keyword in normalized_category for keyword in ("pant", "skirt", "jean", "legging", "short", "trouser")):
        return "bottomwear"
    return "topwear"


def resolve_preferred_fit(body_type: str) -> str:
    normalized_body_type = str(body_type or "").strip().lower()
    return BODY_TYPE_TO_PREFERRED_FIT.get(normalized_body_type, "regular")


def infer_ideal_index(fit_label: str, current_index: int, size_count: int) -> int | None:
    normalized_fit = str(fit_label or "").strip().lower()
    if normalized_fit == "fit":
        return current_index
    if normalized_fit == "small":
        return current_index + 1 if current_index + 1 < size_count else None
    if normalized_fit == "large":
        return current_index - 1 if current_index - 1 >= 0 else None
    return None


def mean(values) -> float:
    materialized = [float(value) for value in values if value is not None]
    return sum(materialized) / len(materialized) if materialized else 0.0


def normalize_rtr_record(raw_record: dict) -> tuple[dict | None, str | None]:
    item_id = str(raw_record.get("item_id") or "").strip()
    size_label = normalize_size_label(raw_record.get("size"))
    fit_label = str(raw_record.get("fit") or "").strip().lower()
    height_cm = parse_height_to_cm(raw_record.get("height"))
    weight_kg = parse_weight_to_kg(raw_record.get("weight"))
    measurement_template = map_rtr_category_to_template(raw_record.get("category"))

    if not item_id:
        return None, "missing_item_id"
    if not size_label:
        return None, "missing_size"
    if fit_label not in {"fit", "small", "large"}:
        return None, "unsupported_fit_label"
    if height_cm is None:
        return None, "missing_height"
    if weight_kg is None:
        return None, "missing_weight"
    if measurement_template is None:
        return None, "missing_category"

    return (
        {
            "itemId": item_id,
            "sizeLabel": size_label,
            "fitLabel": fit_label,
            "measurementTemplate": measurement_template,
            "heightCm": height_cm,
            "weightKg": weight_kg,
            "preferredFit": resolve_preferred_fit(raw_record.get("body type")),
            "categoryLabel": str(raw_record.get("category") or "").strip().lower(),
        },
        None,
    )


def derive_group_fit_bias(records: list[dict]) -> str:
    fit_counts = Counter(record["fitLabel"] for record in records)
    total = sum(fit_counts.values()) or 1
    if (fit_counts["small"] / total) >= 0.48:
        return "runs_small"
    if (fit_counts["large"] / total) >= 0.48:
        return "runs_large"
    return "true_to_size"


def resolve_bucket_records(ideal_buckets: dict[str, list[dict]], ordered_sizes: list[str], size_index: int, fallback_records: list[dict]) -> list[dict]:
    preferred_size = ordered_sizes[size_index]
    if ideal_buckets.get(preferred_size):
        return ideal_buckets[preferred_size]

    for offset in range(1, len(ordered_sizes)):
        lower_index = size_index - offset
        upper_index = size_index + offset
        if lower_index >= 0 and ideal_buckets.get(ordered_sizes[lower_index]):
            return ideal_buckets[ordered_sizes[lower_index]]
        if upper_index < len(ordered_sizes) and ideal_buckets.get(ordered_sizes[upper_index]):
            return ideal_buckets[ordered_sizes[upper_index]]

    return fallback_records


def build_pseudo_size_chart(
    *,
    grouped_records: list[dict],
    ideal_buckets: dict[str, list[dict]],
    ordered_sizes: list[str],
    measurement_template: str,
) -> list[SimpleNamespace]:
    chart: list[SimpleNamespace] = []
    stretch_score = TEMPLATE_STRETCH_BY_TYPE.get(measurement_template, 0.25)
    ease_map = EASE_BY_TEMPLATE.get(measurement_template, EASE_BY_TEMPLATE["topwear"])
    length_extra_map = LENGTH_EXTRA_BY_TEMPLATE.get(measurement_template, {})

    for size_index, size_label in enumerate(ordered_sizes):
        bucket_records = resolve_bucket_records(ideal_buckets, ordered_sizes, size_index, grouped_records)
        body_profiles = [
            estimate_body_profile(
                height_cm=record["heightCm"],
                weight_kg=record["weightKg"],
                category="Women",
                preferred_fit=record["preferredFit"],
            )
            for record in bucket_records
        ]
        average_height = mean(record["heightCm"] for record in bucket_records) or 165
        average_profile = {
            "chest": mean(profile["chest"] for profile in body_profiles),
            "waist": mean(profile["waist"] for profile in body_profiles),
            "hip": mean(profile["hip"] for profile in body_profiles),
            "shoulder": mean(profile["shoulder"] for profile in body_profiles),
        }

        row = {
            "size": size_label,
            "chest": round_value(average_profile["chest"] + ease_map.get("chest", 0), 2) if ease_map.get("chest") else None,
            "waist": round_value(average_profile["waist"] + ease_map.get("waist", 0), 2) if ease_map.get("waist") else None,
            "hip": round_value(average_profile["hip"] + ease_map.get("hip", 0), 2) if ease_map.get("hip") else None,
            "shoulder": round_value(average_profile["shoulder"] + ease_map.get("shoulder", 0), 2) if ease_map.get("shoulder") else None,
            "sleeveLength": None,
            "inseam": None,
            "garmentLength": None,
        }

        if measurement_template in {"topwear", "dress", "outerwear"}:
            row["garmentLength"] = round_value(
                get_length_expectation(average_height, measurement_template, "garmentLength") + length_extra_map.get("garmentLength", 0),
                2,
            )
        if measurement_template == "outerwear":
            row["sleeveLength"] = round_value(
                get_length_expectation(average_height, measurement_template, "sleeveLength") + length_extra_map.get("sleeveLength", 0),
                2,
            )
        if measurement_template == "bottomwear":
            row["inseam"] = round_value(
                get_length_expectation(average_height, measurement_template, "inseam") + length_extra_map.get("inseam", 0),
                2,
            )

        chart.append(SimpleNamespace(**row))

    return chart


def load_rent_the_runway_training_dataset(
    *,
    path: str | Path | None = None,
    max_reviews: int = 12000,
    min_item_reviews: int = 8,
) -> dict[str, object]:
    dataset_path = Path(path or DEFAULT_RENT_THE_RUNWAY_PATH)
    if not dataset_path.is_file():
        raise FileNotFoundError(f"Rent the Runway dataset not found at {dataset_path}")

    grouped_records: dict[str, list[dict]] = defaultdict(list)
    skip_counts = Counter()
    template_counts = Counter()
    fit_counts = Counter()
    category_counts = Counter()
    total_lines = 0
    accepted_reviews = 0

    with dataset_path.open("r", encoding="utf-8") as dataset_file:
        for line in dataset_file:
            if not line.strip():
                continue

            total_lines += 1
            raw_record = json.loads(line)
            normalized_record, skip_reason = normalize_rtr_record(raw_record)
            if not normalized_record:
                skip_counts[skip_reason or "invalid_record"] += 1
                continue

            grouped_records[normalized_record["itemId"]].append(normalized_record)
            template_counts[normalized_record["measurementTemplate"]] += 1
            fit_counts[normalized_record["fitLabel"]] += 1
            category_counts[normalized_record["categoryLabel"]] += 1
            accepted_reviews += 1

    feature_rows: list[list[float]] = []
    targets: list[float] = []
    eligible_items = 0
    used_reviews = 0
    eligible_item_groups: list[dict[str, object]] = []

    sorted_item_groups = sorted(grouped_records.values(), key=len, reverse=True)

    for item_records in sorted_item_groups:
        ordered_sizes = sort_size_labels({record["sizeLabel"] for record in item_records})
        if len(item_records) < min_item_reviews:
            skip_counts["too_few_item_reviews"] += len(item_records)
            continue
        if len(ordered_sizes) < 2:
            skip_counts["too_few_item_sizes"] += len(item_records)
            continue

        measurement_template = Counter(record["measurementTemplate"] for record in item_records).most_common(1)[0][0]
        fit_bias = derive_group_fit_bias(item_records)
        ideal_buckets: dict[str, list[dict]] = defaultdict(list)
        eligible_records: list[dict] = []

        for record in item_records:
            current_index = ordered_sizes.index(record["sizeLabel"])
            ideal_index = infer_ideal_index(record["fitLabel"], current_index, len(ordered_sizes))
            if ideal_index is None:
                skip_counts["edge_size_without_adjacent_label"] += 1
                continue

            enriched_record = {**record, "idealIndex": ideal_index}
            ideal_buckets[ordered_sizes[ideal_index]].append(enriched_record)
            eligible_records.append(enriched_record)

        if len(eligible_records) < min_item_reviews:
            skip_counts["too_few_supervised_reviews"] += len(item_records)
            continue
        eligible_item_groups.append(
            {
                "measurementTemplate": measurement_template,
                "fitBias": fit_bias,
                "orderedSizes": ordered_sizes,
                "idealBuckets": ideal_buckets,
                "eligibleRecords": eligible_records,
                "selectedRecords": [],
            }
        )

    if max_reviews and eligible_item_groups:
        max_supported_groups = max(int(max_reviews // max(min_item_reviews, 1)), 1)
        selected_item_groups = eligible_item_groups[:max_supported_groups]

        for item_group in selected_item_groups:
            item_group["selectedRecords"] = list(item_group["eligibleRecords"][:min_item_reviews])

        remaining_budget = max(max_reviews - (len(selected_item_groups) * min_item_reviews), 0)
        while remaining_budget > 0:
            assigned_in_round = False
            for item_group in selected_item_groups:
                selected_records = item_group["selectedRecords"]
                eligible_records = item_group["eligibleRecords"]
                if len(selected_records) >= len(eligible_records):
                    continue

                selected_records.append(eligible_records[len(selected_records)])
                remaining_budget -= 1
                assigned_in_round = True
                if remaining_budget <= 0:
                    break

            if not assigned_in_round:
                break
    else:
        for item_group in eligible_item_groups:
            item_group["selectedRecords"] = list(item_group["eligibleRecords"])

    for item_group in eligible_item_groups:
        selected_records = list(item_group["selectedRecords"])
        if len(selected_records) < min_item_reviews:
            skip_counts["budget_limited_item_reviews"] += len(selected_records)
            continue

        measurement_template = str(item_group["measurementTemplate"])
        stretch_score = TEMPLATE_STRETCH_BY_TYPE.get(measurement_template, 0.25)
        pseudo_size_chart = build_pseudo_size_chart(
            grouped_records=selected_records,
            ideal_buckets=item_group["idealBuckets"],
            ordered_sizes=item_group["orderedSizes"],
            measurement_template=measurement_template,
        )
        eligible_items += 1
        used_reviews += len(selected_records)

        for record in selected_records:
            user_metrics = SimpleNamespace(
                heightCm=record["heightCm"],
                weightKg=record["weightKg"],
                preferredFit=record["preferredFit"],
            )
            estimated_body_profile = estimate_body_profile(
                height_cm=record["heightCm"],
                weight_kg=record["weightKg"],
                category="Women",
                preferred_fit=record["preferredFit"],
            )

            for candidate_index, size_entry in enumerate(pseudo_size_chart):
                evaluation = evaluate_candidate_size(
                    size_entry=size_entry,
                    measurement_template=measurement_template,
                    fit_bias=str(item_group["fitBias"]),
                    stretch_score=stretch_score,
                    user_metrics=user_metrics,
                    estimated_body_profile=estimated_body_profile,
                    body_features=None,
                )
                feature_rows.append(feature_map_to_vector(evaluation["featureVector"]))
                targets.append(float(candidate_index - record["idealIndex"]))

    features = np.asarray(feature_rows, dtype=np.float32)
    target_values = np.asarray(targets, dtype=np.float32)

    return {
        "features": features,
        "targets": target_values,
        "featureOrder": list(FEATURE_ORDER),
        "summary": {
            "source": "renttherunway",
            "selectionReason": "Chosen over ModCloth because it includes clearer garment categories plus both height and weight, which align with the current fit model.",
            "datasetPath": str(dataset_path),
            "totalLinesScanned": total_lines,
            "acceptedReviews": accepted_reviews,
            "usedReviews": used_reviews,
            "eligibleItems": eligible_items,
            "candidateRows": int(len(feature_rows)),
            "templateCounts": dict(template_counts),
            "fitCounts": dict(fit_counts),
            "topCategories": dict(category_counts.most_common(12)),
            "skipCounts": dict(skip_counts),
            "targetMean": round_value(float(target_values.mean()), 4) if len(target_values) else 0.0,
            "targetStd": round_value(float(target_values.std()), 4) if len(target_values) else 0.0,
        },
    }
