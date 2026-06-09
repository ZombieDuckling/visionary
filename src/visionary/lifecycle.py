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
        yield
    finally:
        db.close()
        logger.info("DB closed")
