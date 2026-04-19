from __future__ import annotations

import hmac


def secrets_match(provided: str | None, expected: str) -> bool:
    """Constant-time comparison that tolerates ``None`` inputs."""

    if not expected:
        return False
    return hmac.compare_digest(str(provided or ""), str(expected))
