from __future__ import annotations

import hashlib
import json
import logging

from app.core.cache import TTLCache
from app.core.config import settings
from app.core.enums import PredictionSource
from app.core.metrics import metrics
from app.schemas.request_models import RecommendationRequest
from app.schemas.response_models import (
    AlternativeRecommendation,
    RecommendationDetails,
    RecommendationInsights,
    RecommendationMeta,
    RecommendationResponse
)
from app.services.feature_builder import (
    clamp,
    estimate_body_profile,
    feature_map_to_vector,
    round_value
)
from app.services.fit_scoring import evaluate_candidate_size
from app.services.model_service import (
    ModelService,
    PredictionExecutionError,
    PredictionLengthMismatchError,
)
from app.services.calibration import calibration_service


logger = logging.getLogger(__name__)


FIELD_LABELS = {
    "chest": "chest room",
    "waist": "waist balance",
    "hip": "hip ease",
    "shoulder": "shoulder width",
    "sleeveLength": "sleeve length",
    "inseam": "inseam length",
    "garmentLength": "overall length"
}


def _build_recommendation_reason(best_candidate: dict, stretch_score: float) -> str:
    top_fields = [
        FIELD_LABELS.get(field_breakdown["field"], field_breakdown["field"])
        for field_breakdown in best_candidate["fieldBreakdown"]
        if field_breakdown["measurement"] is not None
    ][:2]
    if not top_fields:
        top_fields = ["overall fit"]

    stretch_label = "higher stretch" if stretch_score >= 0.6 else "moderate stretch" if stretch_score >= 0.3 else "lower stretch"

    if best_candidate["fitScore"] < -1.5:
        return f"Closest match for {' and '.join(top_fields)} while avoiding an overly tight fit on this {stretch_label} garment."
    if best_candidate["fitScore"] > 1.5:
        return f"Best balance for {' and '.join(top_fields)} without looking too loose on this {stretch_label} garment."
    return f"Best balance for {' and '.join(top_fields)} with the current cut and {stretch_label} profile."


def _build_range_label(best_size: str, alternative_size: str | None, sizes: list[str]) -> str:
    if not alternative_size:
        return best_size

    normalized_sizes = [str(size).strip() for size in sizes]
    first_index = normalized_sizes.index(best_size) if best_size in normalized_sizes else -1
    second_index = normalized_sizes.index(alternative_size) if alternative_size in normalized_sizes else -1
    if first_index == -1 or second_index == -1:
        return f"{best_size}-{alternative_size}"

    return f"{best_size}-{alternative_size}" if first_index < second_index else f"{alternative_size}-{best_size}"

class RecommendationService:
    def __init__(self, model_service: ModelService) -> None:
        self._model_service = model_service
        self._cache: TTLCache[str, RecommendationResponse] = TTLCache(
            max_size=settings.recommendation_cache_size,
            ttl_seconds=settings.recommendation_cache_ttl_seconds,
        )

    @property
    def cache(self) -> TTLCache[str, RecommendationResponse]:
        return self._cache

    def _build_cache_key(self, payload: RecommendationRequest) -> str | None:
        if not self._cache.enabled:
            return None
        try:
            payload_dict = payload.model_dump(mode="json", exclude_none=True)
        except Exception:  # pragma: no cover - defensive: pydantic dump should never fail here
            return None
        envelope = {
            "modelVersion": self._model_service.model_version,
            "modelLoaded": self._model_service.model_loaded,
            "payload": payload_dict,
        }
        serialized = json.dumps(envelope, sort_keys=True, separators=(",", ":"), default=str)
        return hashlib.sha256(serialized.encode("utf-8")).hexdigest()

    def recommend_size(self, payload: RecommendationRequest) -> RecommendationResponse:
        if payload.product.fitProfileSummary and not payload.product.fitProfileSummary.ready:
            raise ValueError("This product does not have enough fit data for recommendations yet.")

        size_entries = [entry for entry in payload.product.fitProfile.sizeMeasurements if entry.size.strip()]
        if not size_entries:
            raise ValueError("No size measurements are available for this product.")

        cache_key = self._build_cache_key(payload)
        if cache_key is not None:
            cached_response = self._cache.get(cache_key)
            if cached_response is not None:
                metrics.recommendation_cache_total.inc(result="hit")
                metrics.predictions_total.inc(source=cached_response.meta.predictionSource)
                return cached_response
            metrics.recommendation_cache_total.inc(result="miss")
        else:
            metrics.recommendation_cache_total.inc(result="skip")

        estimated_body_profile = estimate_body_profile(
            height_cm=payload.userMetrics.heightCm,
            weight_kg=payload.userMetrics.weightKg,
            category=payload.product.category,
            preferred_fit=payload.userMetrics.preferredFit,
            body_features=payload.bodyFeatures.model_dump() if payload.bodyFeatures else None
        )

        candidates = [
            evaluate_candidate_size(
                size_entry=size_entry,
                measurement_template=payload.product.fitProfile.measurementTemplate,
                fit_bias=payload.product.fitProfile.fitBias,
                stretch_score=payload.product.fitProfile.stretchScore,
                user_metrics=payload.userMetrics,
                estimated_body_profile=estimated_body_profile,
                body_features=payload.bodyFeatures
            )
            for size_entry in size_entries
        ]

        prediction_source = PredictionSource.HEURISTIC
        if self._model_service.model_loaded:
            feature_rows = [feature_map_to_vector(candidate["featureVector"]) for candidate in candidates]
            try:
                predicted_fit_scores = self._model_service.predict_fit_scores(feature_rows)
            except PredictionLengthMismatchError as exc:
                logger.warning(
                    "Model returned mismatched prediction length; falling back to heuristic",
                    extra={"error": str(exc), "candidateCount": len(candidates)},
                )
                predicted_fit_scores = []
                prediction_source = PredictionSource.MODEL_LENGTH_MISMATCH
            except PredictionExecutionError as exc:
                logger.warning(
                    "Model prediction failed; falling back to heuristic",
                    extra={"error": str(exc), "candidateCount": len(candidates)},
                )
                predicted_fit_scores = []
                prediction_source = PredictionSource.MODEL_ERROR

            if predicted_fit_scores and len(predicted_fit_scores) == len(candidates):
                prediction_source = PredictionSource.MODEL
                for candidate, predicted_score in zip(candidates, predicted_fit_scores, strict=True):
                    candidate["fitScore"] = round_value(predicted_score, 2)
                    candidate["sortScore"] = abs(predicted_score)

                # M7 — opportunistic shadow scoring + drift telemetry.
                if self._model_service.shadow_loaded:
                    shadow_scores = self._model_service.predict_shadow_fit_scores(feature_rows)
                    if shadow_scores and len(shadow_scores) == len(candidates):
                        primary_best_index = min(
                            range(len(predicted_fit_scores)),
                            key=lambda index: abs(predicted_fit_scores[index]),
                        )
                        shadow_best_index = min(
                            range(len(shadow_scores)),
                            key=lambda index: abs(shadow_scores[index]),
                        )
                        score_delta = abs(
                            predicted_fit_scores[primary_best_index]
                            - shadow_scores[primary_best_index]
                        )
                        metrics.shadow_score_delta.observe(score_delta)
                        if primary_best_index != shadow_best_index:
                            metrics.shadow_predictions_total.inc(result="size_disagreement")
            else:
                for candidate in candidates:
                    candidate["sortScore"] = candidate["penalty"]
        else:
            for candidate in candidates:
                candidate["sortScore"] = candidate["penalty"]

        ranked_candidates = sorted(candidates, key=lambda candidate: candidate["sortScore"])
        best_candidate = ranked_candidates[0]
        second_candidate = ranked_candidates[1] if len(ranked_candidates) > 1 else None
        best_sort_score = best_candidate["sortScore"]

        closeness_score = clamp(1 - (best_sort_score / 12), 0, 1)
        margin_score = (
            clamp((second_candidate["sortScore"] - best_sort_score) / 8, 0, 0.22)
            if second_candidate
            else 0.16
        )
        scan_bonus = clamp((getattr(payload.bodyFeatures, "scanQuality", None) or 0) * 0.08, 0, 0.08)
        confidence = round_value(clamp(0.38 + closeness_score * 0.44 + margin_score + scan_bonus, 0.38, 0.97), 2)

        # M3 — apply isotonic calibration on top of the heuristic confidence
        # whenever a fitted artifact is available. Falls through silently when
        # ``ML_CALIBRATION_PATH`` is unset or the artifact failed to load.
        calibrated_confidence = calibration_service.calibrate(abs(best_sort_score))
        if calibrated_confidence is not None:
            confidence = round_value(clamp(calibrated_confidence, 0.05, 0.99), 2)
            metrics.calibration_applied_total.inc(result="applied")
        else:
            metrics.calibration_applied_total.inc(result="skip")

        alternatives = [
            AlternativeRecommendation(
                size=candidate["size"],
                confidence=round_value(
                    clamp(confidence - (candidate["sortScore"] - best_sort_score) / 10, 0.18, 0.84),
                    2,
                ),
            )
            for candidate in ranked_candidates[1:3]
        ]

        response = RecommendationResponse(
            source="ml" if prediction_source.is_model else "heuristic",
            recommendation=RecommendationDetails(
                size=best_candidate["size"],
                confidence=confidence,
                reason=_build_recommendation_reason(best_candidate, payload.product.fitProfile.stretchScore),
                range=_build_range_label(
                    best_candidate["size"],
                    alternatives[0].size if confidence < 0.6 and alternatives else None,
                    payload.product.sizes
                )
                if confidence < 0.6
                else ""
            ),
            alternatives=alternatives,
            insights=RecommendationInsights(
                fitBias=payload.product.fitProfile.fitBias,
                crowdSignal=""
            ),
            meta=RecommendationMeta(
                modelVersion=self._model_service.model_version,
                fitTemplate=payload.product.fitProfile.measurementTemplate,
                predictionSource=prediction_source.value,
                modelLoaded=self._model_service.model_loaded
            )
        )

        metrics.predictions_total.inc(source=prediction_source.value)
        if cache_key is not None:
            self._cache.set(cache_key, response)
            metrics.recommendation_cache_size.set(len(self._cache))
            metrics.recommendation_cache_total.inc(result="store")
        return response
