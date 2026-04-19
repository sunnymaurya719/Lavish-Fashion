from __future__ import annotations

import threading
import time
from dataclasses import dataclass


@dataclass
class _Bucket:
    tokens: float
    last_refill: float


class TokenBucketRateLimiter:
    """Thread-safe token-bucket limiter keyed by (route, client_id).

    Per-minute limit ``per_minute`` is converted into a steady-state refill
    rate of ``per_minute / 60`` tokens per second. Burst is capped at the
    full minute capacity. ``per_minute=0`` disables the limit for that key.
    """

    def __init__(self, *, max_keys: int = 10_000) -> None:
        self._buckets: dict[tuple[str, str], _Bucket] = {}
        self._lock = threading.Lock()
        self._max_keys = max(max_keys, 1)

    def allow(self, *, route: str, client_id: str, per_minute: int) -> bool:
        if per_minute <= 0:
            return True

        capacity = float(per_minute)
        refill_rate = capacity / 60.0
        key = (route, client_id or "anonymous")
        now = time.monotonic()

        with self._lock:
            bucket = self._buckets.get(key)
            if bucket is None:
                if len(self._buckets) >= self._max_keys:
                    self._evict_oldest_locked()
                bucket = _Bucket(tokens=capacity, last_refill=now)
                self._buckets[key] = bucket
            else:
                elapsed = max(0.0, now - bucket.last_refill)
                bucket.tokens = min(capacity, bucket.tokens + elapsed * refill_rate)
                bucket.last_refill = now

            if bucket.tokens >= 1.0:
                bucket.tokens -= 1.0
                return True

            return False

    def reset(self) -> None:
        with self._lock:
            self._buckets.clear()

    def _evict_oldest_locked(self) -> None:
        oldest_key = min(self._buckets, key=lambda key: self._buckets[key].last_refill)
        self._buckets.pop(oldest_key, None)


rate_limiter = TokenBucketRateLimiter()
