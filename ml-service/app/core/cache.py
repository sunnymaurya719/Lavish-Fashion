"""Thread-safe TTL-LRU cache used by the recommendation service.

Pure stdlib implementation so the cache works in slim Vercel deployments without
pulling in additional runtime dependencies.
"""

from __future__ import annotations

import threading
import time
from collections import OrderedDict
from typing import Generic, TypeVar


K = TypeVar("K")
V = TypeVar("V")


class TTLCache(Generic[K, V]):
    def __init__(self, *, max_size: int, ttl_seconds: float) -> None:
        self._max_size = max(int(max_size), 0)
        self._ttl_seconds = float(max(ttl_seconds, 0.0))
        self._store: OrderedDict[K, tuple[float, V]] = OrderedDict()
        self._lock = threading.Lock()

    @property
    def enabled(self) -> bool:
        return self._max_size > 0 and self._ttl_seconds > 0.0

    def __len__(self) -> int:
        with self._lock:
            return len(self._store)

    def get(self, key: K) -> V | None:
        if not self.enabled:
            return None
        now = time.monotonic()
        with self._lock:
            entry = self._store.get(key)
            if entry is None:
                return None
            expires_at, value = entry
            if expires_at <= now:
                self._store.pop(key, None)
                return None
            self._store.move_to_end(key)
            return value

    def set(self, key: K, value: V) -> None:
        if not self.enabled:
            return
        expires_at = time.monotonic() + self._ttl_seconds
        with self._lock:
            if key in self._store:
                self._store.move_to_end(key)
            self._store[key] = (expires_at, value)
            while len(self._store) > self._max_size:
                self._store.popitem(last=False)

    def clear(self) -> None:
        with self._lock:
            self._store.clear()

    def delete(self, key: K) -> bool:
        with self._lock:
            return self._store.pop(key, None) is not None

    def items(self) -> list[tuple[K, V]]:
        now = time.monotonic()
        with self._lock:
            live = [(key, value) for key, (expires_at, value) in self._store.items() if expires_at > now]
            return live
