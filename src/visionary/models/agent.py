from .common import VisionaryModel


class Agent(VisionaryModel):
    id: str
    name: str
    role: str
    harness_chain: str
    current_harness: str
    health_status: str
    last_activity_at: str | None = None
    last_nudge_at: str | None = None
    expected_activity_within_seconds: int
    personality_path: str | None = None
    watchdog_role: str | None = None


class AgentList(VisionaryModel):
    agents: list[Agent]
