from typing import Literal

from pydantic import BaseModel, Field, model_validator


MeasurementTemplate = Literal["topwear", "bottomwear", "dress", "outerwear", "kids_general"]
FitBias = Literal["runs_small", "true_to_size", "runs_large"]
PreferredFit = Literal["slim", "regular", "relaxed"]
RecommendationMode = Literal["manual", "camera", "hybrid"]
SizeScale = Literal["alpha", "numeric", "waist", "custom"]


class SizeMeasurement(BaseModel):
    size: str = Field(min_length=1, max_length=10)
    chest: float | None = Field(default=None, ge=0)
    waist: float | None = Field(default=None, ge=0)
    hip: float | None = Field(default=None, ge=0)
    shoulder: float | None = Field(default=None, ge=0)
    sleeveLength: float | None = Field(default=None, ge=0)
    inseam: float | None = Field(default=None, ge=0)
    garmentLength: float | None = Field(default=None, ge=0)


class ProductFitProfile(BaseModel):
    measurementTemplate: MeasurementTemplate = "topwear"
    fitBias: FitBias = "true_to_size"
    stretchScore: float = Field(default=0.25, ge=0, le=1)
    measurementUnit: Literal["cm"] = "cm"
    sizeMeasurements: list[SizeMeasurement] = Field(default_factory=list)


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
    heightCm: float = Field(ge=50, le=260)
    weightKg: float = Field(ge=20, le=350)
    preferredFit: PreferredFit = "regular"


class BodyFeaturesInput(BaseModel):
    shoulderRatio: float | None = Field(default=None, ge=0)
    hipRatio: float | None = Field(default=None, ge=0)
    torsoRatio: float | None = Field(default=None, ge=0)
    scanQuality: float | None = Field(default=None, ge=0, le=1)


class RecommendationRequest(BaseModel):
    mode: RecommendationMode = "manual"
    product: ProductInput
    userMetrics: UserMetricsInput
    bodyFeatures: BodyFeaturesInput | None = None
    requestId: str | None = None


class LandmarkInput(BaseModel):
    x: float = Field(ge=0, le=1)
    y: float = Field(ge=0, le=1)
    visibility: float | None = Field(default=None, ge=0, le=1)


class AnalyzeBodyRequest(BaseModel):
    heightCm: float = Field(ge=50, le=260)
    weightKg: float | None = Field(default=None, ge=20, le=350)
    landmarks: list[LandmarkInput] | None = None
    imageBase64: str | None = None

    @model_validator(mode="after")
    def validate_scan_input(self):
        if not self.landmarks and not self.imageBase64:
            raise ValueError("Either landmarks or imageBase64 is required")
        return self
