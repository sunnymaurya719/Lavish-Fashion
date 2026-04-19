"""Persists fit-feedback events to a JSONL file for the nightly retraining job.

Writes are append-only with file-locking on POSIX (best-effort on Windows). Each
record is written as a single newline-terminated JSON object so the training
pipeline can stream them without loading the file into memory.
"""

from __future__ import annotations

import json
import logging
import os
import threading
from datetime import datetime, timezone
from pathlib import Path

from app.core.config import settings
from app.core.metrics import metrics
from app.core.request_context import get_request_id
from app.schemas.request_models import FitFeedbackRequest


logger = logging.getLogger(__name__)


class FeedbackService:
    def __init__(self, log_path: str | Path | None = None) -> None:
        configured = log_path if log_path is not None else settings.feedback_log_path
        self._log_path: Path | None = Path(configured) if configured else None
        self._write_lock = threading.Lock()

    @property
    def log_path(self) -> Path | None:
        return self._log_path

    @property
    def persistence_enabled(self) -> bool:
        return self._log_path is not None

    def record(self, payload: FitFeedbackRequest) -> bool:
        metrics.feedback_total.inc(feedback=payload.feedback, source=payload.source)

        if not self.persistence_enabled:
            return False

        record = payload.model_dump(mode="json", exclude_none=False)
        record["receivedAt"] = datetime.now(timezone.utc).isoformat()
        record["requestId"] = payload.requestId or get_request_id()

        try:
            self._append_record(record)
            return True
        except OSError as exc:
            metrics.feedback_persist_failures.inc(reason="io_error")
            logger.warning(
                "Failed to persist fit feedback",
                extra={"error": str(exc), "logPath": str(self._log_path)},
            )
            return False
        except Exception as exc:  # pragma: no cover - defensive
            metrics.feedback_persist_failures.inc(reason="unexpected_error")
            logger.warning(
                "Unexpected error while persisting fit feedback",
                extra={"error": str(exc)},
                exc_info=True,
            )
            return False

    def _append_record(self, record: dict[str, object]) -> None:
        assert self._log_path is not None
        path = self._log_path
        serialized = json.dumps(record, separators=(",", ":"), default=str) + "\n"

        with self._write_lock:
            path.parent.mkdir(parents=True, exist_ok=True)
            with open(path, "a", encoding="utf-8", newline="") as handle:
                if os.name == "posix":
                    try:
                        import fcntl

                        fcntl.flock(handle.fileno(), fcntl.LOCK_EX)
                    except OSError:  # pragma: no cover - non-fatal
                        pass
                handle.write(serialized)
                handle.flush()

    def forget_user(self, user_id: str) -> int:
        """Remove every persisted feedback record matching ``user_id``.

        Returns the number of records dropped. The implementation rewrites the
        JSONL file under the same write lock so concurrent writers cannot
        re-introduce stale records mid-purge.
        """
        if not user_id or not self.persistence_enabled or self._log_path is None:
            return 0
        path = self._log_path
        with self._write_lock:
            if not path.is_file():
                return 0
            removed = 0
            kept_lines: list[str] = []
            with open(path, "r", encoding="utf-8", newline="") as handle:
                for raw_line in handle:
                    stripped = raw_line.strip()
                    if not stripped:
                        continue
                    try:
                        record = json.loads(stripped)
                    except json.JSONDecodeError:
                        kept_lines.append(raw_line if raw_line.endswith("\n") else raw_line + "\n")
                        continue
                    if record.get("userId") == user_id:
                        removed += 1
                        continue
                    kept_lines.append(raw_line if raw_line.endswith("\n") else raw_line + "\n")
            if removed == 0:
                return 0
            tmp_path = path.with_suffix(path.suffix + ".tmp")
            with open(tmp_path, "w", encoding="utf-8", newline="") as handle:
                handle.writelines(kept_lines)
            os.replace(tmp_path, path)
            return removed


feedback_service = FeedbackService()
