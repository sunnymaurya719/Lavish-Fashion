from fastapi import APIRouter, Depends, Header, HTTPException

from app.core.config import settings
from app.schemas.request_models import AnalyzeBodyRequest, RecommendationRequest
from app.schemas.response_models import AnalyzeBodyResponse, HealthResponse, RecommendationResponse
from app.services.body_analysis import analyze_body_request
from app.services.model_service import model_service
from app.services.recommendation_service import RecommendationService


router = APIRouter()
recommendation_service = RecommendationService(model_service)


def verify_shared_secret(x_ml_service_secret: str | None = Header(default=None)) -> None:
    if settings.shared_secret and x_ml_service_secret != settings.shared_secret:
        raise HTTPException(status_code=401, detail="Unauthorized")


@router.get("/health", response_model=HealthResponse)
def get_health() -> HealthResponse:
    return HealthResponse(
        appName=settings.app_name,
        environment=settings.app_env,
        modelLoaded=model_service.model_loaded,
        modelVersion=model_service.model_version
    )


@router.post("/recommend-size", response_model=RecommendationResponse, dependencies=[Depends(verify_shared_secret)])
def recommend_size(payload: RecommendationRequest) -> RecommendationResponse:
    try:
        return recommendation_service.recommend_size(payload)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.post("/analyze-body", response_model=AnalyzeBodyResponse, dependencies=[Depends(verify_shared_secret)])
def analyze_body(payload: AnalyzeBodyRequest) -> AnalyzeBodyResponse:
    try:
        return analyze_body_request(payload)
    except NotImplementedError as exc:
        raise HTTPException(status_code=501, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
