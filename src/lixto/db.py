"""Plain-SQL migration runner (no ORM, no Alembic).

Applies `migrations/*.sql` in filename order, tracking progress in the
`schema_migrations` table so re-running is a no-op for already-applied files.
The Lixto schema lives in `migrations/001_core.sql` (ADR 001); the legacy
`plic` migrations moved to `legacy/migrations/` and are never applied again.
"""

from __future__ import annotations

from pathlib import Path

import psycopg

from lixto.settings import get_database_url

MIGRATIONS_DIR = Path(__file__).resolve().parent.parent.parent / "migrations"

_ENSURE_MIGRATIONS_TABLE_SQL = """
CREATE TABLE IF NOT EXISTS schema_migrations (
    filename TEXT PRIMARY KEY,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
"""


def get_connection(database_url: str | None = None) -> psycopg.Connection:
    return psycopg.connect(database_url or get_database_url())


def list_migration_files(migrations_dir: Path = MIGRATIONS_DIR) -> list[Path]:
    """Return .sql migration files sorted by filename (ascending)."""
    if not migrations_dir.exists():
        return []
    return sorted(migrations_dir.glob("*.sql"), key=lambda p: p.name)


def ensure_migrations_table(cursor: psycopg.Cursor) -> None:
    cursor.execute(_ENSURE_MIGRATIONS_TABLE_SQL)


def get_applied_migrations(cursor: psycopg.Cursor) -> set[str]:
    cursor.execute("SELECT filename FROM schema_migrations")
    return {row[0] for row in cursor.fetchall()}


def apply_migration(cursor: psycopg.Cursor, filepath: Path) -> None:
    sql = filepath.read_text()
    cursor.execute(sql)
    cursor.execute(
        "INSERT INTO schema_migrations (filename) VALUES (%s)",
        (filepath.name,),
    )


def run_migrations(conn: psycopg.Connection, migrations_dir: Path = MIGRATIONS_DIR) -> list[str]:
    """Apply all pending migrations in filename order. Returns filenames applied.

    Already-applied migrations (by filename) are skipped, making repeated
    calls idempotent.
    """
    applied_now: list[str] = []
    with conn.cursor() as cur:
        ensure_migrations_table(cur)
        conn.commit()

        already_applied = get_applied_migrations(cur)

        for filepath in list_migration_files(migrations_dir):
            if filepath.name in already_applied:
                continue
            apply_migration(cur, filepath)
            conn.commit()
            applied_now.append(filepath.name)

    return applied_now
