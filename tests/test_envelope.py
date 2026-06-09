from visionary.comm.envelope import (
    Envelope, new_trace_id, current_trace_id, with_trace_id,
)


def test_envelope_round_trip():
    e = Envelope(
        from_="ceo", to="scout", topic=None, key=None,
        type="mail", payload={"subject": "hi"}, trace_id="t-1",
    )
    assert e.from_ == "ceo"
    assert e.to == "scout"
    assert e.trace_id == "t-1"


def test_new_trace_id_returns_unique_strings():
    a = new_trace_id()
    b = new_trace_id()
    assert isinstance(a, str)
    assert a != b


def test_with_trace_id_sets_contextvar_for_block():
    assert current_trace_id() is None
    with with_trace_id("t-x"):
        assert current_trace_id() == "t-x"
    assert current_trace_id() is None


def test_nested_with_trace_id_restores_outer():
    with with_trace_id("t-outer"):
        assert current_trace_id() == "t-outer"
        with with_trace_id("t-inner"):
            assert current_trace_id() == "t-inner"
        assert current_trace_id() == "t-outer"
