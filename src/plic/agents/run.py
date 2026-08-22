"""`plic agents run` orchestration: fit-triage (ticket 13) then deep-analysis
(ticket 14)."""

from __future__ import annotations

import psycopg

from plic.agents.deep import deep_analyze as run_deep
from plic.agents.triage import triage as run_triage


def run_agents(
    conn: psycopg.Connection, *, max_triage: int = 200, max_deep: int = 20
) -> dict[str, int]:
    triage_result = run_triage(conn, limit=max_triage)
    deep_result = run_deep(conn, limit=max_deep)
    return {
        "triage_processed": triage_result["processed"],
        "triage_triaged": triage_result["triaged"],
        "deep_processed": deep_result["processed"],
    }
