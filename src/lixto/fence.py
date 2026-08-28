"""The cost fence — which procurements get expensive per-row work.

Ingestion of the procurement *list* stays unfenced (all portals/modalities
via `/atualizacao`); only per-row work (details here, enrichment in ticket
102) is limited to a configured slice: top-3 portals, modalities 6
(Pregão eletrônico) / 8 (Dispensa), open/upcoming only. The fence is env
config, not code — flip `LIXTO_FENCE_*` to widen or narrow it without a
deploy.
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from typing import Any

LIXTO_FENCE_PORTALS = "LIXTO_FENCE_PORTALS"
LIXTO_FENCE_MODALITIES = "LIXTO_FENCE_MODALITIES"
LIXTO_FENCE_OPEN_ONLY = "LIXTO_FENCE_OPEN_ONLY"

_TRUE_VALUES = {"1", "true"}


@dataclass(frozen=True)
class Fence:
    portals: tuple[str, ...]
    modalities: tuple[int, ...]
    open_only: bool

    def is_active(self) -> bool:
        """A fence with no portals, no modalities and no open_only predicate
        constrains nothing — treated as inactive so callers skip it."""
        return bool(self.portals) or bool(self.modalities) or self.open_only

    def sql(self, alias: str = "procurements") -> tuple[str, dict[str, Any]]:
        """`" AND (...)"` fragment (each active predicate AND-ed together)
        plus its named params; `("", {})` when the fence is inactive."""
        if not self.is_active():
            return "", {}

        predicates: list[str] = []
        params: dict[str, Any] = {}

        if self.portals:
            predicates.append(f"{alias}.origin_system = ANY(%(fence_portals)s)")
            params["fence_portals"] = list(self.portals)

        if self.modalities:
            predicates.append(f"{alias}.modality_id = ANY(%(fence_modalities)s)")
            params["fence_modalities"] = list(self.modalities)

        if self.open_only:
            predicates.append(
                f"({alias}.proposal_closes_at >= now() OR {alias}.proposal_opens_at > now())"
            )

        return " AND (" + " AND ".join(predicates) + ")", params

    def describe(self) -> str:
        if not self.is_active():
            return "fence: inactive (all portals, all modalities, all statuses)"
        portals = ", ".join(self.portals) if self.portals else "all"
        modalities = ", ".join(str(m) for m in self.modalities) if self.modalities else "all"
        return f"fence: portals=[{portals}] modalities=[{modalities}] open_only={self.open_only}"


def _parse_portals(raw: str | None) -> tuple[str, ...]:
    if not raw:
        return ()
    return tuple(p.strip() for p in raw.split(",") if p.strip())


def _parse_modalities(raw: str | None) -> tuple[int, ...]:
    if not raw:
        return ()
    return tuple(int(m.strip()) for m in raw.split(",") if m.strip())


def get_fence() -> Fence:
    """Build the fence from env: `LIXTO_FENCE_PORTALS` (comma-separated
    `origin_system` values), `LIXTO_FENCE_MODALITIES` (comma-separated
    `modality_id` ints), `LIXTO_FENCE_OPEN_ONLY` (`"1"`/`"true"`, default
    `"1"` when either list is set, else `"0"` — an unset fence stays fully
    inactive rather than silently filtering to open-only).
    """
    portals = _parse_portals(os.environ.get(LIXTO_FENCE_PORTALS))
    modalities = _parse_modalities(os.environ.get(LIXTO_FENCE_MODALITIES))

    default_open_only = "1" if (portals or modalities) else "0"
    open_only_raw = os.environ.get(LIXTO_FENCE_OPEN_ONLY, default_open_only)
    open_only = open_only_raw.strip().lower() in _TRUE_VALUES

    return Fence(portals=portals, modalities=modalities, open_only=open_only)
