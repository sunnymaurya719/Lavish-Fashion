from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

import joblib
import numpy as np
import xgboost as xgb


PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from app.core.config import settings  # noqa: E402
from app.services.feature_builder import FEATURE_ORDER, round_value  # noqa: E402
from app.services.model_artifact import GradientBoostedFitArtifact  # noqa: E402
from train.build_dataset import build_training_dataset  # noqa: E402
from train.external_review_dataset import load_rent_the_runway_training_dataset  # noqa: E402


def resolve_external_source(external_source: str) -> str:
    normalized_source = str(external_source or "none").strip().lower()
    if normalized_source == "auto":
        return "renttherunway"
    return normalized_source


def combine_training_datasets(*datasets: dict[str, object]) -> dict[str, object]:
    active_datasets = [dataset for dataset in datasets if dataset]
    if not active_datasets:
        raise ValueError("At least one dataset is required to build the training matrix.")

    feature_order = list(active_datasets[0]["featureOrder"])
    features = np.concatenate([np.asarray(dataset["features"], dtype=np.float32) for dataset in active_datasets], axis=0)
    targets = np.concatenate([np.asarray(dataset["targets"], dtype=np.float32) for dataset in active_datasets], axis=0)
    sample_weights = np.concatenate(
        [
            np.asarray(
                dataset.get("sampleWeights")
                if dataset.get("sampleWeights") is not None
                else np.ones(len(dataset["targets"]), dtype=np.float32),
                dtype=np.float32,
            )
            for dataset in active_datasets
        ],
        axis=0,
    )

    return {
        "features": features,
        "targets": targets,
        "sampleWeights": sample_weights,
        "featureOrder": feature_order,
        "summary": {
            "rows": int(len(features)),
            "featureCount": int(features.shape[1]) if features.ndim == 2 else 0,
            "sources": [dataset.get("summary") or {} for dataset in active_datasets],
            "targetMean": round_value(float(targets.mean()), 4) if len(targets) else 0.0,
            "targetStd": round_value(float(targets.std()), 4) if len(targets) else 0.0,
            "sampleWeightMean": round_value(float(sample_weights.mean()), 4) if len(sample_weights) else 0.0,
        },
    }


def build_training_corpus(
    *,
    rows: int,
    seed: int,
    external_source: str,
    external_max_reviews: int,
    external_min_item_reviews: int,
    external_row_weight: float,
) -> dict[str, object]:
    synthetic_dataset = build_training_dataset(row_target=max(rows, 200), seed=seed)
    synthetic_dataset["sampleWeights"] = np.ones(len(synthetic_dataset["targets"]), dtype=np.float32)
    resolved_external_source = resolve_external_source(external_source)

    if resolved_external_source == "none":
        return synthetic_dataset

    if resolved_external_source != "renttherunway":
        raise ValueError(f"Unsupported external source: {external_source}")

    external_dataset = load_rent_the_runway_training_dataset(
        max_reviews=max(external_max_reviews, 0),
        min_item_reviews=max(external_min_item_reviews, 3),
    )
    external_dataset["sampleWeights"] = np.full(
        len(external_dataset["targets"]),
        max(min(float(external_row_weight), 1.0), 0.05),
        dtype=np.float32,
    )
    return combine_training_datasets(synthetic_dataset, external_dataset)


def _build_index_split(row_count: int, *, seed: int, validation_ratio: float = 0.2) -> tuple[np.ndarray, np.ndarray]:
    rng = np.random.default_rng(seed)
    shuffled_indices = rng.permutation(row_count)
    validation_size = max(1, int(row_count * validation_ratio))
    validation_indices = shuffled_indices[:validation_size]
    training_indices = shuffled_indices[validation_size:]
    return training_indices, validation_indices


def _compute_metrics(targets: np.ndarray, predictions: np.ndarray) -> dict[str, float]:
    absolute_errors = np.abs(predictions - targets)
    squared_errors = np.square(predictions - targets)

    return {
        "rmse": round_value(float(np.sqrt(squared_errors.mean())), 4),
        "mae": round_value(float(absolute_errors.mean()), 4),
        "withinHalfPointRate": round_value(float(np.mean(absolute_errors <= 0.5)), 4),
        "withinOnePointRate": round_value(float(np.mean(absolute_errors <= 1.0)), 4),
    }


def train_size_model(
    dataset: dict[str, object],
    *,
    seed: int = 17,
    num_boost_round: int = 120,
    model_version: str | None = None,
) -> tuple[dict[str, object], dict[str, object]]:
    features = np.asarray(dataset["features"], dtype=np.float32)
    targets = np.asarray(dataset["targets"], dtype=np.float32)
    sample_weights = np.asarray(dataset.get("sampleWeights"), dtype=np.float32) if dataset.get("sampleWeights") is not None else np.ones(len(targets), dtype=np.float32)
    feature_order = tuple(dataset.get("featureOrder") or FEATURE_ORDER)

    if len(features) < 200:
        raise ValueError("At least 200 generated rows are required to train the fit model.")

    training_indices, validation_indices = _build_index_split(len(features), seed=seed)

    training_matrix = xgb.DMatrix(
        features[training_indices],
        label=targets[training_indices],
        weight=sample_weights[training_indices],
        feature_names=list(feature_order),
    )
    validation_matrix = xgb.DMatrix(
        features[validation_indices],
        label=targets[validation_indices],
        weight=sample_weights[validation_indices],
        feature_names=list(feature_order),
    )

    params = {
        "objective": "reg:squarederror",
        "eval_metric": ["rmse", "mae"],
        "eta": 0.08,
        "max_depth": 5,
        "subsample": 0.92,
        "colsample_bytree": 0.9,
        "min_child_weight": 4,
        "seed": seed,
        "tree_method": "hist",
    }
    evaluation_history: dict[str, dict[str, list[float]]] = {}
    booster = xgb.train(
        params,
        training_matrix,
        num_boost_round=max(num_boost_round, 20),
        evals=[(training_matrix, "train"), (validation_matrix, "validation")],
        evals_result=evaluation_history,
        verbose_eval=False,
    )

    training_predictions = booster.predict(training_matrix)
    validation_predictions = booster.predict(validation_matrix)
    resolved_model_version = str(model_version or settings.model_version).strip() or settings.model_version
    source_names = [
        str(source_summary.get("source") or "unknown")
        for source_summary in (dataset.get("summary", {}).get("sources") or [dataset.get("summary") or {}])
    ]
    unique_source_names = [source_name for source_name in source_names if source_name]
    metadata = {
        "modelVersion": resolved_model_version,
        "trainedAt": datetime.now(timezone.utc).isoformat(),
        "featureOrder": list(feature_order),
        "rowCount": int(len(features)),
        "trainingRowCount": int(len(training_indices)),
        "validationRowCount": int(len(validation_indices)),
        "seed": int(seed),
        "numBoostRound": int(max(num_boost_round, 20)),
        "datasetSummary": dataset.get("summary") or {},
        "trainMetrics": _compute_metrics(targets[training_indices], training_predictions),
        "validationMetrics": _compute_metrics(targets[validation_indices], validation_predictions),
        "trainingSource": "+".join(dict.fromkeys(unique_source_names)) or "synthetic_bootstrap",
        "evaluationHistoryTail": {
            split_name: {
                metric_name: round_value(values[-1], 4)
                for metric_name, values in metric_values.items()
                if values
            }
            for split_name, metric_values in evaluation_history.items()
        },
    }

    artifact = GradientBoostedFitArtifact(
        booster=booster,
        feature_order=feature_order,
        metadata=metadata,
    )

    return {"model": artifact, "metadata": metadata}, metadata


def save_model_artifact(artifact_payload: dict[str, object], artifact_path: Path) -> tuple[Path, Path]:
    artifact_path.parent.mkdir(parents=True, exist_ok=True)
    joblib.dump(artifact_payload, artifact_path)

    metadata_path = artifact_path.with_suffix(".metadata.json")
    metadata_path.write_text(json.dumps(artifact_payload["metadata"], indent=2), encoding="utf-8")
    return artifact_path, metadata_path


def main() -> None:
    parser = argparse.ArgumentParser(description="Train the Lavish Fit XGBoost size scorer.")
    parser.add_argument("--rows", type=int, default=12_000, help="Number of synthetic candidate rows to generate.")
    parser.add_argument("--seed", type=int, default=17, help="Random seed for dataset and training reproducibility.")
    parser.add_argument("--rounds", type=int, default=120, help="Boosting rounds for the regressor.")
    parser.add_argument(
        "--external-source",
        type=str,
        default="none",
        help="External review dataset to blend into training. Supported: none, auto, renttherunway.",
    )
    parser.add_argument(
        "--external-max-reviews",
        type=int,
        default=1_000,
        help="Maximum external review rows to ingest when an external source is enabled.",
    )
    parser.add_argument(
        "--external-min-item-reviews",
        type=int,
        default=8,
        help="Minimum valid reviews per item before using an external product group for supervision.",
    )
    parser.add_argument(
        "--external-row-weight",
        type=float,
        default=0.35,
        help="Relative training weight for external candidate rows when an external source is enabled.",
    )
    parser.add_argument(
        "--artifact-path",
        type=Path,
        default=Path("app/models/size_recommender.joblib"),
        help="Destination path for the persisted model artifact.",
    )
    parser.add_argument(
        "--model-version",
        type=str,
        default=settings.model_version,
        help="Version string to persist inside the trained artifact metadata.",
    )
    args = parser.parse_args()

    dataset = build_training_corpus(
        rows=args.rows,
        seed=args.seed,
        external_source=args.external_source,
        external_max_reviews=args.external_max_reviews,
        external_min_item_reviews=args.external_min_item_reviews,
        external_row_weight=args.external_row_weight,
    )
    artifact_payload, metadata = train_size_model(
        dataset,
        seed=args.seed,
        num_boost_round=args.rounds,
        model_version=args.model_version,
    )
    artifact_path, metadata_path = save_model_artifact(artifact_payload, args.artifact_path)

    print(
        json.dumps(
            {
                "artifactPath": str(artifact_path.resolve()),
                "metadataPath": str(metadata_path.resolve()),
                "modelVersion": metadata["modelVersion"],
                "validationMetrics": metadata["validationMetrics"],
                "rowCount": metadata["rowCount"],
            },
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
