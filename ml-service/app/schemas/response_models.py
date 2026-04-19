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


class AnalyzeBodyMeta(BaseModel):
    source: Literal["landmarks", "image_heuristic", "frames_fused"]
    landmarkCount: int = 0
    landmarkAvgVisibility: float | None = Field(default=None, ge=0, le=1)
    imageWidth: int | None = Field(default=None, ge=0)
    imageHeight: int | None = Field(default=None, ge=0)
    exifOrientation: int | None = Field(default=None, ge=1, le=8)
    frameCount: int = 0
    frameAgreement: float | None = Field(default=None, ge=0, le=1)
    qualityFlags: list[str] = Field(default_factory=list)


class AnalyzeBodyResponse(BaseModel):
    success: bool = True
    bodyFeatures: BodyFeaturesResponse
    meta: AnalyzeBodyMeta


class ForgetResponse(BaseModel):
    success: bool = True
    userId: str
    evictedRecommendationCacheEntries: int = 0
    evictedIdempotencyEntries: int = 0
    feedbackRecordsRemoved: int = 0
    feedbackPath: str | None = None


class HealthResponse(BaseModel):
    status: Literal["ok"] = "ok"
    appName: str
    environment: str
    modelLoaded: bool
    modelVersion: str


class FeedbackResponse(BaseModel):
    success: bool = True
    accepted: bool
    persisted: bool
    requestId: str | None = None


class BatchRecommendationItemResult(BaseModel):
    key: str | None = None
    success: bool
    response: RecommendationResponse | None = None
    error: str | None = None
    statusCode: int = 200


class BatchRecommendationResponse(BaseModel):
    success: bool = True
    count: int
    successCount: int
    failureCount: int
    items: list[BatchRecommendationItemResult]


class VersionResponse(BaseModel):
    appName: str
    environment: str
    modelVersion: str
    modelLoaded: bool
    artifactSha256: str = ""
    gitSha: str = ""
    buildLabel: str = ""
    pythonVersion: str
    shadowLoaded: bool = False
    shadowVersion: str = ""
    shadowSha256: str = ""
    calibrationLoaded: bool = False
    calibrationPath: str = ""
