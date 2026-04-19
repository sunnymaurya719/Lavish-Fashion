"""TTL-LRU cache for ``Idempotency-Key`` replay (A4).

Stores serialized ``RecommendationResponse`` payloads keyed by
``(client identifier, idempotency-key)`` so a client can safely retry with the
same key and receive the original response within ``ttl_seconds``. Backed by
the existing :mod:`app.core.cache` ``TTLCache`` primitive.
"""

from __future__ import annotations

import hashlib
import json
import threading
from typing import Any

from app.core.cache import TTLCache


class IdempotencyCache:
    def __init__(self, *, max_size: int, ttl_seconds: float) -> None:
        self._cache: TTLCache[str, dict[str, Any]] = TTLCache(
            max_size=max_size, ttl_seconds=ttl_seconds
        )
        self._lock = threading.Lock()

    @property
    def enabled(self) -> bool:
        return self._cache.enabled

    @staticmethod
    def _hash_payload(payload_json: str) -> str:
        return hashlib.sha256(payload_json.encode("utf-8")).hexdigest()

    @staticmethod
    def build_key(client_id: str, idempotency_key: str) -> str:
        return f"{client_id}::{idempotency_key.strip()}"

    def lookup(
        self, client_id: str, idempotency_key: str, payload_json: str
    ) -> tuple[str, dict[str, Any] | None]:
        """Return ``("hit", body)``, ``("conflict", None)``, or ``("miss", None)``."""
        if not self.enabled or not idempotency_key:
            return "skip", None

        key = self.build_key(client_id, idempotency_key)
        request_hash = self._hash_payload(payload_json)
        with self._lock:
            existing = self._cache.get(key)
        if existing is None:
            return "miss", None
        if existing.get("requestHash") != request_hash:
            return "conflict", None
        return "hit", existing.get("response")

    def store(
        self,
        client_id: str,
        idempotency_key: str,
        payload_json: str,
        response_body: dict[str, Any],
    ) -> None:
        if not self.enabled or not idempotency_key:
            return
        key = self.build_key(client_id, idempotency_key)
        envelope = {
            "requestHash": self._hash_payload(payload_json),
            "response": response_body,
        }
        with self._lock:
            self._cache.set(key, envelope)

    def evict_user(self, user_id: str) -> int:
        """Drop any cache entries whose stored response references ``user_id``.

        The current ``RecommendationResponse`` does not embed the user id, so
        the dominant case is a no-op. The helper still walks the cache so the
        Privacy ``/v1/forget`` endpoint can drop matching keys when the body
        carries a ``userId``-style envelope (used by future audit payloads).
        """
        if not user_id:
            return 0
        removed = 0
        with self._lock:
            snapshot = list(self._cache.items())
            for cache_key, envelope in snapshot:
                response_body = envelope.get("response") if isinstance(envelope, dict) else None
                serialized = json.dumps(response_body, sort_keys=True, default=str) if response_body else ""
                if user_id in serialized:
                    self._cache.delete(cache_key)
                    removed += 1
        return removed

    def __len__(self) -> int:
        return len(self._cache)
