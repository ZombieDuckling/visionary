from typing import Any


class Registry:
    def __init__(self) -> None:
        self._by_name: dict[str, Any] = {}

    def register(self, adapter: Any) -> None:
        self._by_name[adapter.name] = adapter

    def get(self, name: str) -> Any | None:
        return self._by_name.get(name)

    def has(self, name: str) -> bool:
        return name in self._by_name

    def names(self) -> list[str]:
        return sorted(self._by_name.keys())
