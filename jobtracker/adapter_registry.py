"""Adapter registry shared by the synchronizer and source configuration."""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any, Callable

Adapter = Callable[[dict[str, Any], int, int], list[Any]]


class AdapterRegistry(dict[str, Adapter]):
    """Small typed registry; unknown source types fail at the orchestration boundary."""

    def resolve(self, source_type: str) -> Adapter:
        adapter = self.get(source_type)
        if adapter is None:
            raise ValueError(f"Неизвестный тип источника: {source_type}")
        return adapter


def build_registry(adapters: Mapping[str, Adapter]) -> AdapterRegistry:
    return AdapterRegistry(adapters)
