from typing import Any

from pydantic import BaseModel, ConfigDict


class VisionaryModel(BaseModel):
    """Base for all pydantic models in the project.

    Permissive on extras at the parsing boundary (we trust DB rows) but strict
    on validation errors at serialization (caller bugs surface immediately).
    """

    model_config = ConfigDict(extra="ignore", frozen=False)


def row_to_dict(row: Any) -> dict[str, Any]:
    """Convert a sqlite3.Row (already dict-coerced by Database.query) to plain dict."""
    if isinstance(row, dict):
        return row
    return dict(row)
