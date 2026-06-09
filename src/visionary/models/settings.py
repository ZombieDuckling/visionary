from .common import VisionaryModel


class WatchdogSettings(VisionaryModel):
    auto_nudge_enabled: bool
    nudge_cooldown_seconds: int


class WatchdogResponse(VisionaryModel):
    watchdog: WatchdogSettings
