import time
from pathlib import Path

import pytest

from visionary.db import Database
from visionary.db.migrations import run_migrations
from visionary.orchestration.rate_limiter import RateLimiter


@pytest.fixture
def db(tmp_path: Path):
    d = Database(str(tmp_path / "t.sqlite"))
    run_migrations(d)
    yield d
    d.close()


def test_default_capacity_allows_first_acquire(db):
    rl = RateLimiter(db)
    assert rl.acquire("scout") is True


def test_capacity_exhausts_after_n_acquires(db):
    rl = RateLimiter(db)
    rl.configure("scout", capacity=2, refill_per_second=0)
    assert rl.acquire("scout") is True
    assert rl.acquire("scout") is True
    assert rl.acquire("scout") is False


def test_refill_grants_tokens_over_time(db):
    rl = RateLimiter(db)
    rl.configure("scout", capacity=1, refill_per_second=10.0)
    assert rl.acquire("scout") is True
    assert rl.acquire("scout") is False
    time.sleep(0.2)
    assert rl.acquire("scout") is True


def test_status_returns_current_state(db):
    rl = RateLimiter(db)
    rl.configure("scout", capacity=5, refill_per_second=1.0)
    status = rl.status("scout")
    assert status["capacity"] == 5
    assert status["refill_per_second"] == 1.0
    assert 0 <= status["tokens"] <= 5


def test_configure_persists_via_settings(db):
    rl = RateLimiter(db)
    rl.configure("scout", capacity=7, refill_per_second=2.5)
    rl2 = RateLimiter(db)
    s = rl2.status("scout")
    assert s["capacity"] == 7
    assert s["refill_per_second"] == 2.5
