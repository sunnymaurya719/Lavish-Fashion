from __future__ import annotations

import argparse
import hashlib
import json
import os
import sys
import tempfile
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
    for index, dataset in enumerate(active_datasets[1:], start=1):
        candidate_feature_order = list(dataset.get("featureOrder") or [])
        if candidate_feature_order != feature_order:
            raise ValueError(
                "Cannot combine datasets with mismatched featureOrder "
                f"(dataset {index} expected {feature_order}, got {candidate_feature_order})."
            )
        candidate_features = np.asarray(dataset["features"], dtype=np.float32)
        if candidate_features.ndim != 2 or candidate_features.shape[1] != len(feature_order):
            raise ValueError(
                f"Dataset {index} feature matrix shape {candidate_features.shape} "
                f"does not match feature order length {len(feature_order)}."
            )
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

    group_ids: list[str] = []
    segments: list[tuple[str, str, str]] = []
    for dataset_index, dataset in enumerate(active_datasets):
        row_count = int(len(dataset["targets"]))
        dataset_group_ids = list(dataset.get("groupIds") or [])
        if len(dataset_group_ids) != row_count:
            dataset_group_ids = [f"ds{dataset_index}-row-{row_index}" for row_index in range(row_count)]
        group_ids.extend(str(value) for value in dataset_group_ids)
        dataset_segments = list(dataset.get("segments") or [])
        if len(dataset_segments) != row_count:
            dataset_segments = [("unknown", "unknown", "unknown")] * row_count
        segments.extend(tuple(str(part) for part in segment) for segment in dataset_segments)

    return {
        "features": features,
        "targets": targets,
        "sampleWeights": sample_weights,
        "featureOrder": feature_order,
        "groupIds": group_ids,
        "segments": segments,
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


def _build_index_split(
    row_count: int,
    *,
    seed: int,
    validation_ratio: float = 0.2,
    group_ids: list[str] | None = None,
) -> tuple[np.ndarray, np.ndarray]:
    if not group_ids or len(group_ids) != row_count:
        rng = np.random.default_rng(seed)
        shuffled_indices = rng.permutation(row_count)
        validation_size = max(1, int(row_count * validation_ratio))
        validation_indices = shuffled_indices[:validation_size]
        training_indices = shuffled_indices[validation_size:]
        return training_indices, validation_indices

    # Group-aware deterministic split: hash(group_id, seed) decides train vs validation.
    unique_groups = sorted({str(value) for value in group_ids})
    rng = np.random.default_rng(seed)
    rng.shuffle(unique_groups)
    validation_group_count = max(1, int(len(unique_groups) * validation_ratio))
    validation_groups = set(unique_groups[:validation_group_count])

    group_array = np.asarray([str(value) for value in group_ids])
    validation_mask = np.isin(group_array, list(validation_groups))
    validation_indices = np.flatnonzero(validation_mask)
    training_indices = np.flatnonzero(~validation_mask)

    if validation_indices.size == 0 or training_indices.size == 0:
        # Degenerate group structure → fall back to random split.
        return _build_index_split(row_count, seed=seed, validation_ratio=validation_ratio)

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


def _compute_segment_metrics(
    targets: np.ndarray,
    predictions: np.ndarray,
    segments: list[tuple[str, str, str]],
    *,
    min_rows: int = 25,
) -> dict[str, dict[str, float | int]]:
    if not segments or len(segments) != len(targets):
        return {}

    grouped: dict[tuple[str, str, str], list[int]] = {}
    for index, segment in enumerate(segments):
        grouped.setdefault(tuple(segment), []).append(index)

    output: dict[str, dict[str, float | int]] = {}
    for segment_key, indices in grouped.items():
        if len(indices) < min_rows:
            continue
        index_array = np.asarray(indices)
        segment_metrics = _compute_metrics(targets[index_array], predictions[index_array])
        segment_label = "|".join(segment_key)
        output[segment_label] = {**segment_metrics, "rowCount": int(len(indices))}

    return dict(sorted(output.items()))


def _capture_reproducibility_metadata(features: np.ndarray, targets: np.ndarray) -> dict[str, object]:
    import platform

    package_versions: dict[str, str] = {}
    for package_name in ("xgboost", "numpy", "joblib", "scikit-learn"):
        try:  # pragma: no cover - optional best-effort lookup
            from importlib.metadata import PackageNotFoundError, version

            package_versions[package_name] = version(package_name)
        except PackageNotFoundError:  # pragma: no cover - skip absent packages
            continue
        except Exception:  # pragma: no cover - defensive
            continue

    git_sha = (os.getenv("ML_GIT_SHA") or os.getenv("GIT_SHA") or "").strip()

    matrix_view = np.ascontiguousarray(np.concatenate([features.reshape(-1), targets.reshape(-1)]).astype(np.float32))
    dataset_sha256 = hashlib.sha256(matrix_view.tobytes()).hexdigest()

    return {
        "gitSha": git_sha,
        "pythonVersion": platform.python_version(),
        "platform": platform.platform(),
        "packageVersions": package_versions,
        "datasetSha256": dataset_sha256,
        "pythonHashSeed": os.getenv("PYTHONHASHSEED", ""),
    }


def train_size_model(
    dataset: dict[str, object],
    *,
    seed: int = 17,
    num_boost_round: int = 120,
    model_version: str | None = None,
    use_group_split: bool = True,
) -> tuple[dict[str, object], dict[str, object]]:
    features = np.asarray(dataset["features"], dtype=np.float32)
    targets = np.asarray(dataset["targets"], dtype=np.float32)
    sample_weights = np.asarray(dataset.get("sampleWeights"), dtype=np.float32) if dataset.get("sampleWeights") is not None else np.ones(len(targets), dtype=np.float32)
    feature_order = tuple(dataset.get("featureOrder") or FEATURE_ORDER)
    raw_group_ids = list(dataset.get("groupIds") or [])
    group_ids = [str(value) for value in raw_group_ids] if len(raw_group_ids) == len(features) else []
    raw_segments = list(dataset.get("segments") or [])
    segments: list[tuple[str, str, str]] = (
        [tuple(str(part) for part in segment) for segment in raw_segments]
        if len(raw_segments) == len(features)
        else []
    )

    if len(features) < 200:
        raise ValueError("At least 200 generated rows are required to train the fit model.")

    # Determinism: seed Python hash, NumPy RNG, and XGBoost in lockstep.
    os.environ.setdefault("PYTHONHASHSEED", str(seed))

    training_indices, validation_indices = _build_index_split(
        len(features),
        seed=seed,
        group_ids=group_ids if use_group_split else None,
    )

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
    validation_segments = [segments[index] for index in validation_indices.tolist()] if segments else []
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
        "validationSegmentMetrics": _compute_segment_metrics(
            targets[validation_indices], validation_predictions, validation_segments
        ),
        "splitStrategy": "group" if (group_ids and use_group_split) else "random",
        "uniqueGroupCount": int(len({*group_ids})) if group_ids else 0,
        "trainingSource": "+".join(dict.fromkeys(unique_source_names)) or "synthetic_bootstrap",
        "evaluationHistoryTail": {
            split_name: {
                metric_name: round_value(values[-1], 4)
                for metric_name, values in metric_values.items()
                if values
            }
            for split_name, metric_values in evaluation_history.items()
        },
        "reproducibility": _capture_reproducibility_metadata(features, targets),
    }

    artifact = GradientBoostedFitArtifact(
        booster=booster,
        feature_order=feature_order,
        metadata=metadata,
    )

    return {"model": artifact, "metadata": metadata}, metadata


def save_model_artifact(artifact_payload: dict[str, object], artifact_path: Path) -> tuple[Path, Path]:
    artifact_path = Path(artifact_path)
    artifact_path.parent.mkdir(parents=True, exist_ok=True)

    # Atomic write: dump to a sibling temp file and os.replace into the final path.
    temp_handle, temp_name = tempfile.mkstemp(
        dir=str(artifact_path.parent),
        prefix=f".{artifact_path.name}.",
        suffix=".tmp",
    )
    os.close(temp_handle)
    temp_path = Path(temp_name)
    try:
        joblib.dump(artifact_payload, temp_path)
        artifact_sha256 = hashlib.sha256(temp_path.read_bytes()).hexdigest()
        metadata = artifact_payload.get("metadata")
        if isinstance(metadata, dict):
            metadata["artifactSha256"] = artifact_sha256
            metadata["artifactBytes"] = int(temp_path.stat().st_size)
            joblib.dump(artifact_payload, temp_path)
        os.replace(temp_path, artifact_path)
    except Exception:
        if temp_path.exists():
            temp_path.unlink(missing_ok=True)
        raise

    metadata_path = artifact_path.with_suffix(".metadata.json")
    metadata_path.write_text(
        json.dumps(artifact_payload.get("metadata") or {}, indent=2),
        encoding="utf-8",
    )
    return artifact_path, metadata_path


def publish_to_registry(
    artifact_path: Path,
    metadata_path: Path,
    *,
    registry_dir: Path,
    metadata: dict[str, object] | None = None,
) -> Path | None:
    """Copy the freshly written artifact into a versioned registry folder.

    Layout: ``{registry_dir}/{modelVersion}/{trainedAt}/{artifactName}`` plus
    sibling ``metadata.json`` and ``MANIFEST.sha256``. Returns the destination
    folder path or ``None`` when ``registry_dir`` is falsy.
    """
    import shutil

    if not registry_dir:
        return None

    metadata_payload = dict(metadata or {})
    if not metadata_payload:
        try:
            metadata_payload = json.loads(metadata_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            metadata_payload = {}

    model_version = str(metadata_payload.get("modelVersion") or settings.model_version).strip() or "unknown"
    trained_at = str(metadata_payload.get("trainedAt") or datetime.now(timezone.utc).isoformat())
    safe_trained_at = trained_at.replace(":", "").replace(".", "-")
    safe_model_version = "".join(ch if ch.isalnum() or ch in "._-" else "_" for ch in model_version)
    destination_dir = Path(registry_dir) / safe_model_version / safe_trained_at
    destination_dir.mkdir(parents=True, exist_ok=True)

    artifact_destination = destination_dir / artifact_path.name
    metadata_destination = destination_dir / "metadata.json"
    shutil.copy2(artifact_path, artifact_destination)
    shutil.copy2(metadata_path, metadata_destination)

    artifact_sha256 = hashlib.sha256(artifact_destination.read_bytes()).hexdigest()
    manifest_lines = [
        f"{artifact_sha256}  {artifact_destination.name}",
        f"{hashlib.sha256(metadata_destination.read_bytes()).hexdigest()}  {metadata_destination.name}",
    ]
    (destination_dir / "MANIFEST.sha256").write_text("\n".join(manifest_lines) + "\n", encoding="utf-8")

    latest_pointer = Path(registry_dir) / safe_model_version / "LATEST"
    latest_pointer.write_text(safe_trained_at + "\n", encoding="utf-8")
    return destination_dir


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
    parser.add_argument(
        "--registry-dir",
        type=Path,
        default=Path(os.getenv("ML_MODEL_REGISTRY_DIR", "")) if os.getenv("ML_MODEL_REGISTRY_DIR") else None,
        help="Optional registry directory to receive a versioned copy of the artifact + manifest.",
    )
    parser.add_argument(
        "--no-group-split",
        dest="use_group_split",
        action="store_false",
        help="Disable group-aware train/validation split (falls back to random).",
    )
    parser.set_defaults(use_group_split=True)
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
        use_group_split=args.use_group_split,
    )
    artifact_path, metadata_path = save_model_artifact(artifact_payload, args.artifact_path)

    registry_destination: Path | None = None
    if args.registry_dir:
        registry_destination = publish_to_registry(
            artifact_path,
            metadata_path,
            registry_dir=args.registry_dir,
            metadata=metadata,
        )

    print(
        json.dumps(
            {
                "artifactPath": str(artifact_path.resolve()),
                "metadataPath": str(metadata_path.resolve()),
                "registryPath": str(registry_destination.resolve()) if registry_destination else None,
                "modelVersion": metadata["modelVersion"],
                "validationMetrics": metadata["validationMetrics"],
                "rowCount": metadata["rowCount"],
            },
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
