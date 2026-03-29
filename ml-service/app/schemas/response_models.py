from typing import Literal

from pydantic import BaseModel, Field


class RecommendationDetails(BaseModel):
    size: str
    confidence: float = Field(ge=0, le=1)
    reason: str
    range: str = ""


class AlternativeRecommendation(BaseModel):
    size: str
    confidence: float = Field(ge=0, le=1)


class RecommendationInsights(BaseModel):
    fitBias: str
    crowdSignal: str = ""


class RecommendationMeta(BaseModel):
    modelVersion: str
    fitTemplate: str
    predictionSource: str
    modelLoaded: bool


class RecommendationResponse(BaseModel):
    success: bool = True
    source: Literal["ml", "heuristic"]
    recommendation: RecommendationDetails
    alternatives: list[AlternativeRecommendation] = Field(default_factory=list)
    insights: RecommendationInsights
    meta: RecommendationMeta


class BodyFeaturesResponse(BaseModel):
    shoulderRatio: float = Field(ge=0)
    hipRatio: float = Field(ge=0)
    torsoRatio: float = Field(ge=0)
    scanQuality: float = Field(ge=0, le=1)


class AnalyzeBodyResponse(BaseModel):
    success: bool = True
    bodyFeatures: BodyFeaturesResponse
    meta: dict[str, str | bool]


class HealthResponse(BaseModel):
    status: Literal["ok"] = "ok"
    appName: str
    environment: str
    modelLoaded: bool
    modelVersion: str
