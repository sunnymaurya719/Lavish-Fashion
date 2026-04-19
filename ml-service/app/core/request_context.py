from __future__ import annotations

import uuid
from contextvars import ContextVar


_request_id_var: ContextVar[str] = ContextVar("ml_request_id", default="")


def set_request_id(value: str) -> str:
    """Store the incoming/minted request id for the current task."""

    _request_id_var.set(value)
    return value


def get_request_id() -> str:
    return _request_id_var.get()


def generate_request_id() -> str:
    """Return a random request id. Uses uuid4 for portability across Pythons."""

    return uuid.uuid4().hex
