from visionary.orchestration.cookbook import context_window, list_models


def test_context_window_returns_int_for_known_model():
    assert context_window("claude", "claude-sonnet-4-6") > 0
    assert context_window("claude", "claude-opus-4-7") > 0


def test_context_window_returns_none_for_unknown():
    assert context_window("claude", "unknown-model") is None
    assert context_window("unknown-harness", "anything") is None


def test_list_models_for_harness_returns_iterable():
    assert "claude-sonnet-4-6" in list_models("claude")
    assert "claude-opus-4-7" in list_models("claude")
    assert list_models("unknown-harness") == []
