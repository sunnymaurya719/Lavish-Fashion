from __future__ import annotations

import logging
import time
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.api.routes import router
from app.core.config import settings
from app.core.logging_config import configure_logging
from app.core.metrics import metrics
from app.core.request_context import generate_request_id, get_request_id, set_request_id
from app.services.calibration import calibration_service
from app.services.model_service import model_service


configure_logging()
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(_: FastAPI):
    if settings.is_production and settings.shared_secret and len(settings.shared_secret) < 24:
        logger.warning(
            "ML_SERVICE_SHARED_SECRET is shorter than the recommended 24 characters in production",
            extra={"shared_secret_length": len(settings.shared_secret)},
        )
    model_service.load_model()
    if settings.calibration_path:
        loaded = calibration_service.load(settings.calibration_path)
        logger.info(
            "calibration_artifact_loaded" if loaded else "calibration_artifact_unavailable",
            extra={"calibrationPath": settings.calibration_path, "loaded": loaded},
        )
    yield


app = FastAPI(title=settings.app_name, lifespan=lifespan)

if settings.cors_allow_origins:
    app.add_middleware(
        CORSMiddleware,
        allow_origins=list(settings.cors_allow_origins),
        allow_credentials=False,
        allow_methods=["GET", "POST"],
        allow_headers=["*"],
    )


@app.middleware("http")
async def request_context_middleware(request: Request, call_next):
    incoming_request_id = (
        request.headers.get("x-request-id")
        or request.headers.get("X-Request-Id")
        or ""
    ).strip()
    request_id = set_request_id(incoming_request_id or generate_request_id())

    start = time.perf_counter()
    status_code = 500
    route_label = request.url.path
    try:
        response = await call_next(request)
        status_code = response.status_code
        response.headers["x-request-id"] = request_id
        return response
    finally:
        duration_seconds = time.perf_counter() - start
        if settings.metrics_enabled:
            metrics.requests_total.inc(
                route=route_label,
                method=request.method,
                status=str(status_code),
            )
            metrics.request_duration_seconds.observe(
                duration_seconds,
                route=route_label,
                method=request.method,
            )
        logger.info(
            "request_completed",
            extra={
                "route": route_label,
                "method": request.method,
                "status": status_code,
                "latencyMs": round(duration_seconds * 1000, 2),
            },
        )


def _build_error_payload(*, message: str, status_code: int, detail: object | None = None) -> dict[str, object]:
    payload: dict[str, object] = {
        "error": {
            "message": message,
            "status": status_code,
            "requestId": get_request_id(),
        }
    }
    if detail is not None and (settings.expose_error_details or status_code < 500):
        payload["error"]["detail"] = detail
    return payload


@app.exception_handler(StarletteHTTPException)
async def http_exception_handler(_: Request, exc: StarletteHTTPException) -> JSONResponse:
    payload = _build_error_payload(
        message=exc.detail if isinstance(exc.detail, str) else "Request failed",
        status_code=exc.status_code,
        detail=exc.detail if not isinstance(exc.detail, str) else None,
    )
    return JSONResponse(payload, status_code=exc.status_code, headers=exc.headers or None)


@app.exception_handler(RequestValidationError)
async def validation_exception_handler(_: Request, exc: RequestValidationError) -> JSONResponse:
    payload = _build_error_payload(
        message="Request validation failed",
        status_code=422,
        detail=exc.errors(),
    )
    return JSONResponse(payload, status_code=422)


@app.exception_handler(Exception)
async def unhandled_exception_handler(_: Request, exc: Exception) -> JSONResponse:
    logger.exception("Unhandled exception while serving request", extra={"errorType": type(exc).__name__})
    payload = _build_error_payload(
        message="Internal server error",
        status_code=500,
        detail=str(exc) if settings.expose_error_details else None,
    )
    return JSONResponse(payload, status_code=500)


app.include_router(router)
if settings.enable_v1_aliases:
    # A1 — versioned route aliases. Mount the same handlers under ``/v1`` so
    # callers can pin to the stable contract without breaking pre-v1 clients.
    app.include_router(router, prefix="/v1")
