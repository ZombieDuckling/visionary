from .common import VisionaryModel


class OrgNode(VisionaryModel):
    """A node in the org chart. Recursive: an agent with optional reports."""

    id: str
    name: str
    role: str
    current_harness: str
    health_status: str
    last_activity_at: str | None = None
    last_nudge_at: str | None = None
    reports: list["OrgNode"] = []


OrgNode.model_rebuild()


class OrgChart(VisionaryModel):
    ceo: OrgNode
