from __future__ import annotations

import asyncio
import logging
import sys
import time

from fastapi import APIRouter, Depends, Header, HTTPException, Request, Response, status
from fastapi.responses import PlainTextResponse
from pydantic import ValidationError

from app.core.config import settings
from app.core.idempotency import IdempotencyCache
from app.core.metrics import metrics
from app.core.rate_limit import rate_limiter
from app.core.request_context import get_request_id
from app.core.security import secrets_match
from app.schemas.request_models import (
    AnalyzeBodyRequest,
    BatchRecommendationRequest,
    FitFeedbackRequest,
    ForgetRequest,
    RecommendationRequest,
)
from app.schemas.response_models import (
    AnalyzeBodyResponse,
    BatchRecommendationItemResult,
    BatchRecommendationResponse,
    FeedbackResponse,
    ForgetResponse,
    HealthResponse,
    RecommendationResponse,
    VersionResponse,
)
from app.services.body_analysis import BodyQualityError, analyze_body_request
from app.services.feedback_service import feedback_service
from app.services.model_service import model_service
from app.services.recommendation_service import RecommendationService


logger = logging.getLogger(__name__)

router = APIRouter()
recommendation_service = RecommendationService(model_service)
idempotency_cache = IdempotencyCache(
    max_size=settings.idempotency_cache_size,
    ttl_seconds=settings.idempotency_cache_ttl_seconds,
)


def _client_identifier(request: Request) -> str:
    forwarded_for = request.headers.get("x-forwarded-for")
    if forwarded_for:
        return forwarded_for.split(",")[0].strip() or "anonymous"
    if request.client and request.client.host:
        return request.client.host
    return "anonymous"


def _enforce_rate_limit(request: Request, *, route: str, per_minute: int) -> None:
    if per_minute <= 0:
        return
    if not rate_limiter.allow(route=route, client_id=_client_identifier(request), per_minute=per_minute):
        metrics.rate_limited_total.inc(route=route)
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Rate limit exceeded",
            headers={"Retry-After": "30"},
        )


def verify_shared_secret(x_ml_service_secret: str | None = Header(default=None)) -> None:
    if not settings.shared_secret:
        return
    if not secrets_match(x_ml_service_secret, settings.shared_secret):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Unauthorized")


def verify_admin_secret(x_ml_admin_secret: str | None = Header(default=None)) -> None:
    expected = settings.admin_secret or settings.shared_secret
    if not expected:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Admin endpoints require ML_ADMIN_SECRET or ML_SERVICE_SHARED_SECRET",
        )
    if not secrets_match(x_ml_admin_secret, expected):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Unauthorized")


async def _run_with_timeout(callable_, *, timeout_seconds: float, route: str):
    if timeout_seconds <= 0:
        return await asyncio.to_thread(callable_)

    started = time.perf_counter()
    try:
        return await asyncio.wait_for(asyncio.to_thread(callable_), timeout=timeout_seconds)
    except asyncio.TimeoutError as exc:
        elapsed = time.perf_counter() - started
        metrics.timeouts_total.inc(route=route)
        logger.warning(
            "Request exceeded timeout",
            extra={"route": route, "timeoutSeconds": timeout_seconds, "elapsedSeconds": round(elapsed, 4)},
        )
        raise HTTPException(
            status_code=status.HTTP_504_GATEWAY_TIMEOUT,
            detail="Request timed out",
        ) from exc


@router.get("/health", response_model=HealthResponse)
def get_health(request: Request) -> HealthResponse:
    _enforce_rate_limit(request, route="health", per_minute=settings.rate_limit_health_per_minute)
    return HealthResponse(
        appName=settings.app_name,
        environment=settings.app_env,
        modelLoaded=model_service.model_loaded,
        modelVersion=model_service.model_version
    )


@router.get("/ready")
def get_ready(response: Response, request: Request) -> dict[str, object]:
    _enforce_rate_limit(request, route="health", per_minute=settings.rate_limit_health_per_minute)
    if not model_service.load_attempted:
        response.status_code = status.HTTP_503_SERVICE_UNAVAILABLE
        return {
            "status": "starting",
            "modelLoaded": False,
            "modelVersion": model_service.model_version,
            "requestId": get_request_id(),
        }

    return {
        "status": "ready",
        "modelLoaded": model_service.model_loaded,
        "modelVersion": model_service.model_version,
        "requestId": get_request_id(),
    }


@router.post(
    "/recommend-size",
    response_model=RecommendationResponse,
    dependencies=[Depends(verify_shared_secret)],
)
async def recommend_size(
    payload: RecommendationRequest,
    request: Request,
    response: Response,
    idempotency_key: str | None = Header(default=None, alias="Idempotency-Key"),
) -> RecommendationResponse:
    _enforce_rate_limit(request, route="recommend", per_minute=settings.rate_limit_recommend_per_minute)

    payload_signature = ""
    cache_outcome = "skip"
    if idempotency_key and idempotency_cache.enabled:
        try:
            payload_signature = payload.model_dump_json()
        except Exception:  # pragma: no cover - defensive
            payload_signature = ""
        client_id = _client_identifier(request)
        cache_outcome, cached_body = idempotency_cache.lookup(
            client_id, idempotency_key, payload_signature
        )
        if cache_outcome == "hit" and cached_body is not None:
            metrics.idempotency_total.inc(result="hit")
            response.headers["x-idempotency-cache"] = "hit"
            return RecommendationResponse.model_validate(cached_body)
        if cache_outcome == "conflict":
            metrics.idempotency_total.inc(result="conflict")
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Idempotency-Key was reused with a different payload.",
            )
        metrics.idempotency_total.inc(result=cache_outcome)

    try:
        recommendation_response = await _run_with_timeout(
            lambda: recommendation_service.recommend_size(payload),
            timeout_seconds=settings.recommend_timeout_seconds,
            route="recommend-size",
        )
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)) from exc

    if idempotency_key and idempotency_cache.enabled and cache_outcome == "miss":
        idempotency_cache.store(
            _client_identifier(request),
            idempotency_key,
            payload_signature,
            recommendation_response.model_dump(mode="json"),
        )
        metrics.idempotency_total.inc(result="store")
        response.headers["x-idempotency-cache"] = "store"

    return recommendation_response


@router.post(
    "/analyze-body",
    response_model=AnalyzeBodyResponse,
    dependencies=[Depends(verify_shared_secret)],
)
async def analyze_body(payload: AnalyzeBodyRequest, request: Request) -> AnalyzeBodyResponse:
    _enforce_rate_limit(request, route="analyze", per_minute=settings.rate_limit_analyze_per_minute)
    try:
        return await _run_with_timeout(
            lambda: analyze_body_request(payload),
            timeout_seconds=settings.analyze_timeout_seconds,
            route="analyze-body",
        )
    except BodyQualityError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail={"error": str(exc), "reason": exc.reason},
        ) from exc
    except NotImplementedError as exc:
        raise HTTPException(status_code=status.HTTP_501_NOT_IMPLEMENTED, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)) from exc


@router.post("/admin/reload-model", dependencies=[Depends(verify_admin_secret)])
async def reload_model(request: Request) -> dict[str, object]:
    _enforce_rate_limit(request, route="admin", per_minute=settings.rate_limit_admin_per_minute)
    loaded = await model_service.reload_model()
    return {
        "status": "ok",
        "modelLoaded": loaded,
        "modelVersion": model_service.model_version,
        "artifactPath": str(model_service.artifact_path),
    }


def _verify_metrics_access(x_ml_admin_secret: str | None = Header(default=None)) -> None:
    if not settings.metrics_enabled:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Metrics disabled")
    if not settings.metrics_require_secret:
        return
    expected = settings.admin_secret or settings.shared_secret
    if not expected:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Metrics require ML_ADMIN_SECRET when ML_METRICS_REQUIRE_SECRET is enabled",
        )
    if not secrets_match(x_ml_admin_secret, expected):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Unauthorized")


@router.get("/metrics", dependencies=[Depends(_verify_metrics_access)])
def get_metrics(request: Request) -> PlainTextResponse:
    _enforce_rate_limit(request, route="health", per_minute=settings.rate_limit_health_per_minute)
    return PlainTextResponse(metrics.render(), media_type="text/plain; version=0.0.4; charset=utf-8")


@router.get("/version", response_model=VersionResponse)
def get_version(request: Request) -> VersionResponse:
    _enforce_rate_limit(request, route="health", per_minute=settings.rate_limit_health_per_minute)
    python_version = ".".join(str(part) for part in sys.version_info[:3])
    from app.services.calibration import calibration_service  # local import: avoid cycle on cold start

    return VersionResponse(
        appName=settings.app_name,
        environment=settings.app_env,
        modelVersion=model_service.model_version,
        modelLoaded=model_service.model_loaded,
        artifactSha256=model_service.artifact_sha256,
        gitSha=settings.git_sha,
        buildLabel=settings.build_label,
        pythonVersion=python_version,
        shadowLoaded=model_service.shadow_loaded,
        shadowVersion=model_service.shadow_version,
        shadowSha256=model_service.shadow_sha256,
        calibrationLoaded=calibration_service.loaded,
        calibrationPath=calibration_service.loaded_path,
    )


@router.post(
    "/feedback",
    response_model=FeedbackResponse,
    dependencies=[Depends(verify_shared_secret)],
)
async def submit_feedback(payload: FitFeedbackRequest, request: Request) -> FeedbackResponse:
    _enforce_rate_limit(request, route="feedback", per_minute=settings.rate_limit_feedback_per_minute)
    persisted = await asyncio.to_thread(feedback_service.record, payload)
    return FeedbackResponse(
        accepted=True,
        persisted=persisted,
        requestId=payload.requestId or get_request_id(),
    )


def _score_batch_item(payload: RecommendationRequest) -> RecommendationResponse:
    return recommendation_service.recommend_size(payload)


@router.post(
    "/recommend-size:batch",
    response_model=BatchRecommendationResponse,
    dependencies=[Depends(verify_shared_secret)],
)
async def recommend_size_batch(
    payload: BatchRecommendationRequest, request: Request
) -> BatchRecommendationResponse:
    _enforce_rate_limit(request, route="recommend", per_minute=settings.rate_limit_recommend_per_minute)
    metrics.batch_size.observe(len(payload.items))

    async def _process_item(item) -> BatchRecommendationItemResult:
        try:
            response = await _run_with_timeout(
                lambda: _score_batch_item(item.request),
                timeout_seconds=settings.recommend_timeout_seconds,
                route="recommend-batch-item",
            )
            return BatchRecommendationItemResult(key=item.key, success=True, response=response)
        except HTTPException as exc:
            metrics.batch_item_failures.inc(reason=str(exc.status_code))
            detail = exc.detail if isinstance(exc.detail, str) else "Request failed"
            return BatchRecommendationItemResult(
                key=item.key, success=False, error=detail, statusCode=exc.status_code
            )
        except (ValueError, ValidationError) as exc:
            metrics.batch_item_failures.inc(reason="validation_error")
            return BatchRecommendationItemResult(
                key=item.key, success=False, error=str(exc), statusCode=422
            )
        except Exception as exc:  # pragma: no cover - defensive
            metrics.batch_item_failures.inc(reason="unexpected_error")
            logger.exception("Batch recommendation item failed", extra={"errorType": type(exc).__name__})
            return BatchRecommendationItemResult(
                key=item.key, success=False, error="Internal error", statusCode=500
            )

    try:
        results = await asyncio.wait_for(
            asyncio.gather(*[_process_item(item) for item in payload.items]),
            timeout=settings.recommend_batch_timeout_seconds or None,
        )
    except asyncio.TimeoutError as exc:
        metrics.timeouts_total.inc(route="recommend-batch")
        raise HTTPException(
            status_code=status.HTTP_504_GATEWAY_TIMEOUT,
            detail="Batch request timed out",
        ) from exc

    success_count = sum(1 for result in results if result.success)
    return BatchRecommendationResponse(
        count=len(results),
        successCount=success_count,
        failureCount=len(results) - success_count,
        items=results,
    )


@router.post(
    "/forget",
    response_model=ForgetResponse,
    dependencies=[Depends(verify_admin_secret)],
)
async def forget_user(payload: ForgetRequest, request: Request) -> ForgetResponse:
    """G-Priv-2 — privacy purge endpoint.

    Removes every cached and persisted artifact tied to ``userId``:

    * Drops feedback JSONL rows matching the user.
    * Evicts every Idempotency-Key entry whose stored response references the user.
    * Conservatively flushes the recommendation cache (responses don't embed
      ``userId``, so per-user eviction would risk false negatives).
    """
    _enforce_rate_limit(request, route="admin", per_minute=settings.rate_limit_admin_per_minute)

    feedback_removed = await asyncio.to_thread(feedback_service.forget_user, payload.userId)
    idempotency_removed = idempotency_cache.evict_user(payload.userId)
    recommendation_cache_size = len(recommendation_service.cache)
    recommendation_service.cache.clear()
    metrics.recommendation_cache_size.set(0)

    feedback_path = (
        str(feedback_service.log_path) if feedback_service.persistence_enabled else None
    )
    logger.info(
        "forget_user_request_completed",
        extra={
            "userId": payload.userId,
            "feedbackRemoved": feedback_removed,
            "idempotencyEvicted": idempotency_removed,
            "recommendationCacheCleared": recommendation_cache_size,
        },
    )
    return ForgetResponse(
        userId=payload.userId,
        evictedRecommendationCacheEntries=recommendation_cache_size,
        evictedIdempotencyEntries=idempotency_removed,
        feedbackRecordsRemoved=feedback_removed,
        feedbackPath=feedback_path,
    )
