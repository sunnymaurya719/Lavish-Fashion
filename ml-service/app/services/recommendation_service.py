from __future__ import annotations

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
from app.services.model_service import ModelService


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

    def recommend_size(self, payload: RecommendationRequest) -> RecommendationResponse:
        if payload.product.fitProfileSummary and not payload.product.fitProfileSummary.ready:
            raise ValueError("This product does not have enough fit data for recommendations yet.")

        size_entries = [entry for entry in payload.product.fitProfile.sizeMeasurements if entry.size.strip()]
        if not size_entries:
            raise ValueError("No size measurements are available for this product.")

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

        prediction_source = "heuristic_fallback"
        if self._model_service.model_loaded:
            feature_rows = [feature_map_to_vector(candidate["featureVector"]) for candidate in candidates]
            predicted_fit_scores = self._model_service.predict_fit_scores(feature_rows)
            if predicted_fit_scores and len(predicted_fit_scores) == len(candidates):
                prediction_source = "xgboost_regressor"
                for candidate, predicted_score in zip(candidates, predicted_fit_scores, strict=True):
                    candidate["fitScore"] = round_value(predicted_score, 2)
                    candidate["sortScore"] = abs(predicted_score)
            else:
                for candidate in candidates:
                    candidate["sortScore"] = candidate["penalty"]
        else:
            for candidate in candidates:
                candidate["sortScore"] = candidate["penalty"]

        ranked_candidates = sorted(candidates, key=lambda candidate: candidate["sortScore"])
        best_candidate = ranked_candidates[0]
        second_candidate = ranked_candidates[1] if len(ranked_candidates) > 1 else None

        closeness_score = clamp(1 - (best_candidate["sortScore"] / 12), 0, 1)
        margin_score = (
            clamp((second_candidate["sortScore"] - best_candidate["sortScore"]) / 8, 0, 0.22)
            if second_candidate
            else 0.16
        )
        scan_bonus = clamp((getattr(payload.bodyFeatures, "scanQuality", None) or 0) * 0.08, 0, 0.08)
        confidence = round_value(clamp(0.38 + closeness_score * 0.44 + margin_score + scan_bonus, 0.38, 0.97), 2)

        alternatives = [
            AlternativeRecommendation(
                size=candidate["size"],
                confidence=round_value(clamp(confidence - (candidate["sortScore"] - best_candidate["sortScore"]) / 10, 0.18, 0.84), 2)
            )
            for candidate in ranked_candidates[1:3]
        ]

        return RecommendationResponse(
            source="ml" if prediction_source != "heuristic_fallback" else "heuristic",
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
                predictionSource=prediction_source,
                modelLoaded=self._model_service.model_loaded
            )
        )
