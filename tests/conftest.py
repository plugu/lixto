"""Shared pytest fixtures.

Everything else in `tests/` is mocked and needs no server; the only fixture
here provisions the scratch Postgres database `tests/test_sync_integration.py`
needs, and `pytest.skip`s the whole thing when no server is reachable so CI
without Postgres stays green.

The database named by `LIXTO_TEST_DATABASE_URL` (default
`postgresql://lixto:lixto@localhost:5433/lixto_test`) is **dropped and
recreated** from `migrations/001_core.sql` on every session, so it must never
be the development database: pointing it at the maintenance database `lixto`
is refused outright.
"""

from __future__ import annotations

import os
from collections.abc import Iterator
from urllib.parse import urlsplit, urlunsplit

import psycopg
import pytest

from lixto.db import run_migrations

DEFAULT_TEST_DATABASE_URL = "postgresql://lixto:lixto@localhost:5433/lixto_test"

# CREATE/DROP DATABASE cannot run inside the database being created, so the
# fixture connects to this one (created by docker-compose) to issue them.
MAINTENANCE_DATABASE = "lixto"

_CONNECT_TIMEOUT_SECONDS = 3


def resolve_test_database_url() -> str:
    return os.environ.get("LIXTO_TEST_DATABASE_URL", DEFAULT_TEST_DATABASE_URL)


def _maintenance_url(url: str) -> tuple[str, str]:
    """Split `url` into `(database name, same URL on the maintenance db)`."""
    parts = urlsplit(url)
    return parts.path.lstrip("/"), urlunsplit(parts._replace(path=f"/{MAINTENANCE_DATABASE}"))


@pytest.fixture(scope="session")
def migrated_database_url() -> Iterator[str]:
    """A freshly created database with `migrations/*.sql` applied.

    Session-scoped: the DDL is applied once, and each test gets a clean slate
    from the `db_conn` fixture below rather than a new database.
    """
    url = resolve_test_database_url()
    dbname, maintenance_url = _maintenance_url(url)

    if dbname in ("", MAINTENANCE_DATABASE):
        pytest.fail(
            f"LIXTO_TEST_DATABASE_URL must name a scratch database, not {MAINTENANCE_DATABASE!r}"
            " — this fixture drops it"
        )

    try:
        admin = psycopg.connect(
            maintenance_url, autocommit=True, connect_timeout=_CONNECT_TIMEOUT_SECONDS
        )
    except psycopg.OperationalError as exc:
        pytest.skip(f"no Postgres at {maintenance_url}: {exc}")

    try:
        with admin.cursor() as cur:
            cur.execute(f'DROP DATABASE IF EXISTS "{dbname}" WITH (FORCE)')
            cur.execute(f'CREATE DATABASE "{dbname}"')

        with psycopg.connect(url) as conn:
            run_migrations(conn)

        yield url

        with admin.cursor() as cur:
            cur.execute(f'DROP DATABASE IF EXISTS "{dbname}" WITH (FORCE)')
    finally:
        admin.close()


@pytest.fixture
def db_conn(migrated_database_url: str) -> Iterator[psycopg.Connection]:
    """A connection to the migrated scratch database, emptied before each test.

    `sources` is seeded by the migration and FK-referenced everywhere, so it
    is explicitly excluded from the truncate.
    """
    with psycopg.connect(migrated_database_url) as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT string_agg(format('%I.%I', schemaname, tablename), ', ')
                FROM pg_tables
                WHERE schemaname = 'public'
                  AND tablename NOT IN ('sources', 'schema_migrations', 'cnae_codes', 'classification_segments')
                """
            )
            tables = cur.fetchone()[0]
            if tables:
                cur.execute(f"TRUNCATE {tables} RESTART IDENTITY CASCADE")
        conn.commit()
        yield conn
        conn.rollback()
