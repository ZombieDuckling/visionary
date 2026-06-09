"""Guardrails — token budgeting + replay selection.

Mirror of the Node src/guardrails.js. Phase 1b uses estimate_tokens +
select_for_replay; jailbreak detection + canary tokens come in Phase 1c
when wired into the dispatch path.
"""

from typing import Any

_CHARS_PER_TOKEN = 4


def estimate_tokens(text: str) -> int:
    if not text:
        return 0
    return max(1, len(text) // _CHARS_PER_TOKEN)


def select_for_replay(
    messages: list[dict[str, Any]],
    ceiling: int,
    most_recent_first: bool = True,
) -> list[dict[str, Any]]:
    """Pick the most recent messages that fit within the token ceiling.

    Returns a NEW list in chronological order (oldest → newest) after dropping
    older ones that exceed the budget.
    """
    if not messages:
        return []
    selected: list[dict[str, Any]] = []
    budget = 0
    for msg in reversed(messages):
        cost = estimate_tokens(str(msg.get("content", "")))
        if budget + cost > ceiling:
            break
        selected.append(msg)
        budget += cost
    if most_recent_first:
        return list(reversed(selected))
    return selected
