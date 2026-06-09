"""Cookbook — per-harness model catalog with context windows.

Tracks what Anthropic / OpenClaw / etc support. The numbers come from the
official model docs and are conservative defaults. Tweak if a model's window
changes upstream.
"""

# (harness, model) -> context window in tokens
_WINDOWS: dict[tuple[str, str], int] = {
    ("claude", "claude-opus-4-7"): 200_000,
    ("claude", "claude-sonnet-4-6"): 200_000,
    ("claude", "claude-haiku-4-5-20251001"): 200_000,
    ("openclaw", "claude-sonnet"): 200_000,
    ("openclaw", "claude-opus"): 200_000,
}


def context_window(harness: str, model: str) -> int | None:
    """Return the model's context window in tokens, or None if unknown."""
    return _WINDOWS.get((harness, model))


def list_models(harness: str) -> list[str]:
    """Return known model names for a harness (may be empty)."""
    return sorted({m for (h, m) in _WINDOWS if h == harness})
