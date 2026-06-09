import logging
from contextlib import asynccontextmanager
from typing import AsyncIterator

from fastapi import FastAPI

from visionary.db import Database
from visionary.db.migrations import run_migrations
from visionary.settings import Settings

logger = logging.getLogger("visionary.lifecycle")


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    """Phase 0 lifespan: open DB, run migrations, stash on app.state.

    Phase 3 will add watchdog + bridge + scheduler asyncio tasks here.
    """
    settings = Settings()
    db = Database(settings.db_path)
    try:
        version = run_migrations(db)
        logger.info("DB ready at %s (schema_version=%d)", settings.db_path, version)
        app.state.settings = settings
        app.state.db = db
        app.state.schema_version = version
        from visionary.sse import EventBus
        app.state.event_bus = EventBus()

        from visionary.orchestration.rate_limiter import RateLimiter
        from visionary.runtimes.claude import ClaudeAdapter
        from visionary.runtimes.openclaw import OpenClawAdapter
        from visionary.runtimes.registry import Registry

        registry = Registry()
        registry.register(ClaudeAdapter())
        registry.register(OpenClawAdapter())
        app.state.registry = registry
        app.state.rate_limiter = RateLimiter(db)
        from visionary.comm.facade import Comm
        app.state.comm = Comm(db, registry)
        yield
    finally:
        db.close()
        logger.info("DB closed")
