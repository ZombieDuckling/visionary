from .common import VisionaryModel


class Schedule(VisionaryModel):
    id: int
    name: str
    cron: str
    agent_id: str
    prompt: str
    enabled: bool
    last_run_at: str | None = None


class ScheduleList(VisionaryModel):
    schedules: list[Schedule]
