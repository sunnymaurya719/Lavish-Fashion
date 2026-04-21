from typing import Literal

from pydantic import BaseModel, Field, model_validator

from app.core.config import settings


MeasurementTemplate = Literal["topwear", "bottomwear", "dress", "outerwear", "kids_general"]
FitBias = Literal["runs_small", "true_to_size", "runs_large"]
PreferredFit = Literal["slim", "regular", "relaxed"]
RecommendationMode = Literal["manual", "camera", "hybrid"]
SizeScale = Literal["alpha", "numeric", "waist", "custom"]


class SizeMeasurement(BaseModel):
    size: str = Field(min_length=1, max_length=10)
    chest: float | None = Field(default=None, ge=0, le=400, allow_inf_nan=False)
    waist: float | None = Field(default=None, ge=0, le=400, allow_inf_nan=False)
    hip: float | None = Field(default=None, ge=0, le=400, allow_inf_nan=False)
    shoulder: float | None = Field(default=None, ge=0, le=200, allow_inf_nan=False)
    sleeveLength: float | None = Field(default=None, ge=0, le=200, allow_inf_nan=False)
    inseam: float | None = Field(default=None, ge=0, le=200, allow_inf_nan=False)
    garmentLength: float | None = Field(default=None, ge=0, le=300, allow_inf_nan=False)


class ProductFitProfile(BaseModel):
    measurementTemplate: MeasurementTemplate = "topwear"
    fitBias: FitBias = "true_to_size"
    stretchScore: float = Field(default=0.25, ge=0, le=1, allow_inf_nan=False)
    measurementUnit: Literal["cm"] = "cm"
    sizeMeasurements: list[SizeMeasurement] = Field(
        default_factory=list,
        max_length=settings.max_size_measurements,
    )


class ProductFitProfileSummary(BaseModel):
    ready: bool = False
    measurementTemplate: MeasurementTemplate = "topwear"


class ProductInput(BaseModel):
    id: str | None = None
    category: str = Field(min_length=1, max_length=50)
    subCategory: str | None = None
    sizes: list[str] = Field(default_factory=list)
    sizeScale: SizeScale = "alpha"
    fitProfile: ProductFitProfile
    fitProfileSummary: ProductFitProfileSummary | None = None


class UserMetricsInput(BaseModel):
    heightCm: float = Field(ge=50, le=260, allow_inf_nan=False)
    weightKg: float = Field(ge=20, le=350, allow_inf_nan=False)
    preferredFit: PreferredFit = "regular"


class BodyFeaturesInput(BaseModel):
    shoulderRatio: float | None = Field(default=None, ge=0, le=10, allow_inf_nan=False)
    hipRatio: float | None = Field(default=None, ge=0, le=10, allow_inf_nan=False)
    torsoRatio: float | None = Field(default=None, ge=0, le=10, allow_inf_nan=False)
    scanQuality: float | None = Field(default=None, ge=0, le=1, allow_inf_nan=False)


class RecommendationRequest(BaseModel):
    mode: RecommendationMode = "manual"
    product: ProductInput
    userMetrics: UserMetricsInput
    bodyFeatures: BodyFeaturesInput | None = None
    requestId: str | None = None


class LandmarkInput(BaseModel):
    x: float = Field(ge=0, le=1, allow_inf_nan=False)
    y: float = Field(ge=0, le=1, allow_inf_nan=False)
    visibility: float | None = Field(default=None, ge=0, le=1, allow_inf_nan=False)


class AnalyzeBodyRequest(BaseModel):
    heightCm: float = Field(ge=50, le=260, allow_inf_nan=False)
    weightKg: float | None = Field(default=None, ge=20, le=350, allow_inf_nan=False)
    landmarks: list[LandmarkInput] | None = Field(default=None, max_length=settings.max_landmarks)
    imageBase64: str | None = None
    frames: list[str] | None = Field(
        default=None,
        max_length=settings.body_max_frames,
        description=(
            "Optional multi-frame burst (each entry a data URL). When supplied, the"
            " service computes per-frame heuristics and fuses them by median for"
            " stability. The active frame should still be passed in ``imageBase64``"
            " if both are provided."
        ),
    )

    @model_validator(mode="after")
    def validate_scan_input(self):
        has_frames = bool(self.frames)
        if not self.landmarks and not self.imageBase64 and not has_frames:
            raise ValueError("Either landmarks, imageBase64, or frames is required")

        max_chars = int(settings.max_image_bytes * 1.4) + 256
        if self.imageBase64 is not None and len(self.imageBase64) > max_chars:
            raise ValueError("The image payload exceeds the maximum allowed size.")
        if has_frames:
            for index, frame in enumerate(self.frames or []):
                if not frame:
                    raise ValueError(f"frames[{index}] must be a non-empty data URL")
                if len(frame) > max_chars:
                    raise ValueError(f"frames[{index}] exceeds the maximum allowed size.")

        return self


class ForgetRequest(BaseModel):
    userId: str = Field(min_length=1, max_length=64)
    reason: str | None = Field(default=None, max_length=120)


FitFeedbackVerdict = Literal["too_small", "perfect", "too_large"]


class FitFeedbackRequest(BaseModel):
    userId: str = Field(min_length=1, max_length=64)
    productId: str = Field(min_length=1, max_length=64)
    orderId: str = Field(min_length=1, max_length=64)
    selectedSize: str = Field(min_length=1, max_length=10)
    recommendedSize: str = Field(min_length=1, max_length=10)
    feedback: FitFeedbackVerdict
    source: RecommendationMode = "manual"
    confidence: float | None = Field(default=None, ge=0, le=1, allow_inf_nan=False)
    modelVersion: str | None = Field(default=None, max_length=60)
    # M-loop: capture which engine actually produced the recommendation so
    # downstream consumers (calibration trainer, analytics quality metrics)
    # can filter heuristic-driven feedback out of model-quality calculations.
    predictionSource: str | None = Field(default=None, max_length=40)
    requestId: str | None = Field(default=None, max_length=64)


class BatchRecommendationItem(BaseModel):
    key: str | None = Field(default=None, max_length=64)
    request: RecommendationRequest


class BatchRecommendationRequest(BaseModel):
    items: list[BatchRecommendationItem] = Field(min_length=1, max_length=settings.recommend_batch_max_items)
