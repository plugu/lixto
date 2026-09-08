"""Unit tests for src/lixto/status.py.

Fully mocked psycopg connection/cursor — no network, no live database.
"""

from unittest.mock import MagicMock

import pytest

from lixto.fence import Fence
from lixto.status import StatusReport, format_status, get_status

# get_status runs one `with conn.cursor() as cur:` block and issues, in
# order: N table counts, by-modality, lifecycle, pending details, watermarks,
# newest source_global_updated_at, enriched-today, llm-today, llm-7d,
# fenced-pending, the email_messages regclass guard and (when it exists) the
# email stats query.
_TABLE_COUNT_QUERIES = 13  # len(COUNTED_TABLES)


def _conn(
    by_modality=None,
    lifecycle=(0, 0, 0),
    pending_details=0,
    watermarks=None,
    newest=None,
    enriched_today=(0, 0),
    llm_today=(0, 0, 0, 0),
    llm_7d=(0,),
    fenced_pending=0,
    email_messages_exists=True,
    email_stats=(0, 0, 0, 0, 0),
):
    cur = MagicMock()
    fetchone_results = (
        [(0,)] * _TABLE_COUNT_QUERIES  # table counts
        + [
            lifecycle,
            (pending_details,),
            (newest,),
            enriched_today,
            llm_today,
            llm_7d,
            (fenced_pending,),
            (email_messages_exists,),
        ]
    )
    if email_messages_exists:
        fetchone_results.append(email_stats)
    cur.fetchone.side_effect = fetchone_results
    cur.fetchall.side_effect = [
        list((by_modality or {}).items()),
        list((watermarks or {}).items()),
    ]

    conn = MagicMock()
    conn.cursor.return_value.__enter__.return_value = cur
    conn.cursor.return_value.__exit__.return_value = False
    return conn, cur


@pytest.fixture(autouse=True)
def _inert_fence(monkeypatch):
    """Most tests don't care about the fence; keep it inactive unless a
    test explicitly overrides it."""
    monkeypatch.setattr("lixto.status.get_fence", lambda: Fence((), (), False))


def test_get_status_reads_enriched_today_and_errors():
    conn, _cur = _conn(enriched_today=(42, 3))

    report = get_status(conn)

    assert report.enriched_today == 42
    assert report.enriched_today_errors == 3


def test_get_status_reads_llm_today_counters():
    conn, _cur = _conn(llm_today=(3, 1000, 200, 4500))

    report = get_status(conn)

    assert report.llm_today == {
        "calls": 3,
        "prompt_tokens": 1000,
        "completion_tokens": 200,
        "est_usd_micros": 4500,
    }


def test_get_status_reads_llm_last_7d_est_usd_micros():
    conn, _cur = _conn(llm_7d=(120000,))

    report = get_status(conn)

    assert report.llm_last_7d_est_usd_micros == 120000


def test_llm_today_and_7d_queries_cover_both_analyze_run_kinds():
    """Runs are recorded as 'analyze' (cron, lixto analyze run) and
    'analyze_jobs' (on-demand drain, lixto analyze jobs); both must count
    toward the LLM usage totals."""
    conn, cur = _conn()

    get_status(conn)

    executed_sql = [str(c.args[0]) for c in cur.execute.call_args_list]
    llm_today_sql = next(sql for sql in executed_sql if "llm_calls" in sql)
    llm_7d_sql = next(sql for sql in executed_sql if "interval '7 days'" in sql)
    assert "kind IN ('analyze', 'analyze_jobs')" in llm_today_sql
    assert "kind IN ('analyze', 'analyze_jobs')" in llm_7d_sql
    assert "kind = 'enrich'" not in llm_today_sql
    assert "kind = 'enrich'" not in llm_7d_sql


def test_get_status_reads_fenced_pending():
    conn, _cur = _conn(fenced_pending=17)

    report = get_status(conn)

    assert report.fenced_pending == 17


def test_get_status_reads_fence_description(monkeypatch):
    fence = Fence(portals=("compras.gov.br",), modalities=(6, 8), open_only=True)
    monkeypatch.setattr("lixto.status.get_fence", lambda: fence)
    conn, _cur = _conn()

    report = get_status(conn)

    assert report.fence == fence.describe()


def test_get_status_splices_fence_params_into_fenced_pending_query(monkeypatch):
    fence = Fence(portals=("compras.gov.br",), modalities=(6,), open_only=True)
    monkeypatch.setattr("lixto.status.get_fence", lambda: fence)
    conn, cur = _conn()

    get_status(conn)

    fenced_pending_call = next(
        c for c in cur.execute.call_args_list if "p.origin_system = ANY" in str(c.args[0])
    )
    sql, params = fenced_pending_call.args
    assert "p.origin_system = ANY(%(fence_portals)s)" in sql
    assert params["fence_portals"] == ["compras.gov.br"]
    assert params["fence_modalities"] == [6]


def test_get_status_reads_daily_cap_from_env(monkeypatch):
    monkeypatch.setenv("LIXTO_ENRICH_DAILY_CAP", "1500")
    conn, _cur = _conn()

    report = get_status(conn)

    assert report.enrich_daily_cap == 1500


def test_get_status_defaults_daily_cap_to_unlimited(monkeypatch):
    monkeypatch.delenv("LIXTO_ENRICH_DAILY_CAP", raising=False)
    conn, _cur = _conn()

    report = get_status(conn)

    assert report.enrich_daily_cap == 0


def test_get_status_reads_email_stats_when_email_messages_exists():
    conn, _cur = _conn(email_messages_exists=True, email_stats=(3, 4, 12, 2, 1))

    report = get_status(conn)

    assert report.email == {
        "queued": 3,
        "sending": 4,
        "sent_24h": 12,
        "failed_24h": 2,
        "suppressed": 1,
    }


def test_get_status_counts_in_flight_messages():
    """A queue stranded in 'sending' must not read as empty."""
    conn, cur = _conn(email_messages_exists=True, email_stats=(0, 9, 0, 0, 0))

    report = get_status(conn)

    assert report.email["sending"] == 9
    executed_sql = " ".join(str(c.args[0]) for c in cur.execute.call_args_list)
    assert "count(*) FILTER (WHERE status = 'sending') AS sending" in executed_sql


def test_get_status_reports_zero_email_stats_on_a_pre_003_database():
    conn, cur = _conn(email_messages_exists=False)

    report = get_status(conn)

    assert report.email == {
        "queued": 0,
        "sending": 0,
        "sent_24h": 0,
        "failed_24h": 0,
        "suppressed": 0,
    }
    # The stats query must never run against a database without the table.
    executed_sql = " ".join(str(c.args[0]) for c in cur.execute.call_args_list)
    assert "FROM email_messages" not in executed_sql


# --- format_status ---------------------------------------------------------


def _report(**overrides):
    defaults = {
        "table_counts": {},
        "by_modality": {},
        "open": 0,
        "upcoming": 0,
        "closed": 0,
        "pending_details": 0,
        "watermarks": {},
        "newest_source_global_updated_at": None,
        "fence": "fence: portals=[compras.gov.br] modalities=[6, 8] open_only=True",
        "enrich_daily_cap": 1500,
        "enriched_today": 120,
        "enriched_today_errors": 4,
        "llm_today": {
            "calls": 130,
            "prompt_tokens": 250000,
            "completion_tokens": 40000,
            "est_usd_micros": 45230,
        },
        "llm_last_7d_est_usd_micros": 810000,
        "fenced_pending": 980,
        "email": {
            "queued": 5,
            "sending": 1,
            "sent_24h": 40,
            "failed_24h": 2,
            "suppressed": 3,
        },
    }
    defaults.update(overrides)
    return StatusReport(**defaults)


def test_format_status_includes_the_enrichment_block():
    text = format_status(_report())

    assert "enrichment:" in text
    assert "  fence: portals=[compras.gov.br] modalities=[6, 8] open_only=True" in text
    assert "today: 120 enriched (4 errors) / cap 1500" in text
    assert "pending in fence: 980" in text
    assert "llm today: 130 calls, 250000 prompt + 40000 completion tokens, est US$ 0.0452" in text
    assert "llm last 7 days: est US$ 0.81" in text


def test_format_status_shows_unlimited_when_cap_is_zero():
    text = format_status(_report(enrich_daily_cap=0))

    assert "cap unlimited" in text


def test_format_status_includes_the_email_block():
    text = format_status(
        _report(
            email={
                "queued": 5,
                "sending": 7,
                "sent_24h": 40,
                "failed_24h": 2,
                "suppressed": 3,
            }
        )
    )

    assert "email:" in text
    assert "  queued: 5" in text
    assert "  sending: 7" in text
    assert "  sent (24h): 40" in text
    assert "  failed (24h): 2" in text
    assert "  suppressed: 3" in text
    # `sending` reads right after `queued`: the two halves of the backlog.
    lines = text.splitlines()
    assert lines[lines.index("  queued: 5") + 1] == "  sending: 7"


def test_format_status_shows_zeros_for_the_email_block_on_a_pre_003_database():
    text = format_status(
        _report(
            email={
                "queued": 0,
                "sending": 0,
                "sent_24h": 0,
                "failed_24h": 0,
                "suppressed": 0,
            }
        )
    )

    assert "email:" in text
    assert "  queued: 0" in text
    assert "  sending: 0" in text
    assert "  sent (24h): 0" in text
    assert "  failed (24h): 0" in text
    assert "  suppressed: 0" in text


def test_format_status_still_includes_existing_sections():
    report = _report(
        table_counts={"procurements": 10},
        by_modality={6: 8, 8: 2},
        open=5,
        upcoming=3,
        closed=2,
        pending_details=1,
        watermarks={"incremental:pncp": "2026-08-01T00:00:00"},
        newest_source_global_updated_at="2026-08-24T12:00:00",
    )

    text = format_status(report)

    assert "tables:" in text
    assert "  procurements: 10" in text
    assert "open: 5" in text
    assert "newest source_global_updated_at: 2026-08-24T12:00:00" in text
