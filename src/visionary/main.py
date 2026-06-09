import logging

from fastapi import FastAPI, Request
from fastapi.staticfiles import StaticFiles

from visionary.lifecycle import lifespan
from visionary.settings import Settings

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(name)s %(levelname)s %(message)s",
)
logger = logging.getLogger("visionary.main")


def create_app() -> FastAPI:
    settings = Settings()
    app = FastAPI(
        title="Visionary Mission Control",
        version="2.1.0-dev",
        lifespan=lifespan,
    )

    @app.get("/healthz")
    async def healthz(request: Request) -> dict:
        return {
            "ok": True,
            "schema_version": request.app.state.schema_version,
        }

    # StaticFiles mount must be LAST — it matches every unmatched path.
    app.mount("/", StaticFiles(directory=settings.public_dir, html=True), name="public")

    return app


app = create_app()
