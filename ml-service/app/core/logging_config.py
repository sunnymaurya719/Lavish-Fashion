from __future__ import annotations

import json
import logging
import sys
from datetime import datetime, timezone
from typing import Any

from app.core.config import settings
from app.core.request_context import get_request_id


_RESERVED_RECORD_KEYS = {
    "name",
    "msg",
    "args",
    "levelname",
    "levelno",
    "pathname",
    "filename",
    "module",
    "exc_info",
    "exc_text",
    "stack_info",
    "lineno",
    "funcName",
    "created",
    "msecs",
    "relativeCreated",
    "thread",
    "threadName",
    "processName",
    "process",
    "message",
    "taskName",
}


class JsonLogFormatter(logging.Formatter):
    """Stdlib-only JSON log formatter that injects the active request id."""

    def format(self, record: logging.LogRecord) -> str:  # noqa: D401 - stdlib API
        payload: dict[str, Any] = {
            "timestamp": datetime.fromtimestamp(record.created, tz=timezone.utc).isoformat(),
            "level": record.levelname,
            "logger": record.name,
            "message": record.getMessage(),
            "module": record.module,
        }

        request_id = get_request_id()
        if request_id:
            payload["requestId"] = request_id

        for key, value in record.__dict__.items():
            if key in _RESERVED_RECORD_KEYS or key.startswith("_"):
                continue
            try:
                json.dumps(value)
            except (TypeError, ValueError):
                value = repr(value)
            payload[key] = value

        if record.exc_info:
            payload["exception"] = self.formatException(record.exc_info)

        return json.dumps(payload, ensure_ascii=False)


def configure_logging() -> None:
    """Idempotently install the structured handler on the root logger."""

    root_logger = logging.getLogger()
    desired_level = getattr(logging, settings.log_level, logging.INFO)
    root_logger.setLevel(desired_level)

    handler: logging.Handler
    if any(getattr(existing, "_ml_service_handler", False) for existing in root_logger.handlers):
        return

    handler = logging.StreamHandler(stream=sys.stdout)
    if settings.log_json:
        handler.setFormatter(JsonLogFormatter())
    else:
        handler.setFormatter(
            logging.Formatter("%(asctime)s %(levelname)s %(name)s :: %(message)s")
        )

    handler._ml_service_handler = True  # type: ignore[attr-defined]
    root_logger.addHandler(handler)
