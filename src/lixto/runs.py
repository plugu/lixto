"""Run logging — every CLI/batch/chat run writes one `agent_runs` row.

Usage (every command from the sync/enrich/match tickets wraps its work here):

    with run(conn, "sync.procurements") as counters:
        ...
        counters.inc("procurements", 10)

On normal exit the row becomes `status='done'` with `finished_at` and the
counters as JSON; on exception it becomes `status='failed'` with `error` (the
exception is re-raised). The context manager commits its own INSERT/UPDATE so
the run row survives a rollback of the work itself.
"""

from __future__ import annotations

from collections.abc import Iterator
from contextlib import contextmanager

import psycopg
from psycopg.types.json import Json

_ERROR_MAX_CHARS = 2000


class RunCounters:
    """Dict-like counter bag persisted to `agent_runs.counters`."""

    def __init__(self) -> None:
        self._counters: dict[str, int] = {}

    def inc(self, key: str, n: int = 1) -> int:
        self._counters[key] = self._counters.get(key, 0) + n
        return self._counters[key]

    def __getitem__(self, key: str) -> int:
        return self._counters[key]

    def __setitem__(self, key: str, value: int) -> None:
        self._counters[key] = value

    def __contains__(self, key: str) -> bool:
        return key in self._counters

    def __len__(self) -> int:
        return len(self._counters)

    def __iter__(self) -> Iterator[str]:
        return iter(self._counters)

    def get(self, key: str, default: int = 0) -> int:
        return self._counters.get(key, default)

    def items(self):
        return self._counters.items()

    def as_dict(self) -> dict[str, int]:
        return dict(self._counters)

    def __repr__(self) -> str:
        return f"RunCounters({self._counters!r})"


@contextmanager
def run(
    conn: psycopg.Connection, kind: str, company_id: int | None = None
) -> Iterator[RunCounters]:
    """Record one `agent_runs` row around a unit of agent work.

    `kind` is a dotted verb ('sync.procurements', 'enrich', 'chat', ...).
    Yields a `RunCounters` the body fills in; it is written to the row on the
    way out, whether the body succeeded or raised.
    """
    counters = RunCounters()
    with conn.cursor() as cur:
        cur.execute(
            "INSERT INTO agent_runs (kind, company_id, status) "
            "VALUES (%s, %s, 'running') RETURNING id",
            (kind, company_id),
        )
        run_id = cur.fetchone()[0]
    conn.commit()

    try:
        yield counters
    except BaseException as exc:
        # Roll back first: the body's transaction may be aborted (a psycopg
        # error would make the UPDATE fail too), and its partial uncommitted
        # work must not be committed by the run-log commit below.
        conn.rollback()
        with conn.cursor() as cur:
            cur.execute(
                "UPDATE agent_runs SET status = 'failed', finished_at = now(), "
                "counters = %s, error = %s WHERE id = %s",
                (Json(counters.as_dict()), str(exc)[:_ERROR_MAX_CHARS], run_id),
            )
        conn.commit()
        raise

    with conn.cursor() as cur:
        cur.execute(
            "UPDATE agent_runs SET status = 'done', finished_at = now(), "
            "counters = %s WHERE id = %s",
            (Json(counters.as_dict()), run_id),
        )
    conn.commit()
