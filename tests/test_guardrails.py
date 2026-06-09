from visionary.orchestration.guardrails import estimate_tokens, select_for_replay


def test_estimate_tokens_returns_positive_int_for_text():
    assert estimate_tokens("hello world") > 0
    assert estimate_tokens("") == 0


def test_estimate_tokens_grows_with_text_size():
    short = estimate_tokens("hi")
    long = estimate_tokens("hi" * 1000)
    assert long > short


def test_select_for_replay_returns_empty_for_empty_input():
    assert select_for_replay([], ceiling=1000) == []


def test_select_for_replay_keeps_most_recent_within_budget():
    msgs = [
        {"role": "user", "content": "old long " * 100},
        {"role": "user", "content": "medium " * 20},
        {"role": "user", "content": "recent short"},
    ]
    selected = select_for_replay(msgs, ceiling=200)
    assert any("recent short" in m["content"] for m in selected)
    assert not any("old long" in m["content"] for m in selected[:1])


def test_select_for_replay_respects_ceiling():
    msgs = [{"role": "user", "content": "x" * 100} for _ in range(50)]
    selected = select_for_replay(msgs, ceiling=200)
    total = sum(estimate_tokens(m["content"]) for m in selected)
    assert total <= 200
