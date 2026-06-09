import os
from pathlib import Path


class Settings:
    """Env-driven config. Re-reads env on every construction so tests using
    monkeypatch see the right values."""

    def __init__(self) -> None:
        repo_root = Path(__file__).resolve().parent.parent.parent
        self.host: str = os.environ.get("VISIONARY_HOST", "127.0.0.1")
        self.port: int = int(os.environ.get("VISIONARY_PORT", "3344"))
        self.db_path: str = os.environ.get(
            "VISIONARY_DB", str(repo_root / "visionary.sqlite")
        )
        self.public_dir: str = os.environ.get(
            "VISIONARY_PUBLIC", str(repo_root / "public")
        )
        self.org_chart_path: str = os.environ.get(
            "VISIONARY_ORG_CHART", str(repo_root / "personalities" / "org-chart.json")
        )
