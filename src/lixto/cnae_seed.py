"""Seeds the `cnae_codes` reference table from the IBGE subclasses API.

One-shot/idempotent tool: `lixto cnae seed` fetches the ~1359 IBGE CNAE
subclasses in a single GET and upserts them into `cnae_codes` (division +
subclass levels only — seção/grupo are out of scope). Re-running just
refreshes descriptions, it never duplicates rows (PK on `code`).
"""

from __future__ import annotations

import os
from typing import Any

import httpx
import psycopg

IBGE_CNAE_URL = os.environ.get(
    "LIXTO_IBGE_CNAE_URL",
    "https://servicodados.ibge.gov.br/api/v2/cnae/subclasses",
)
REQUEST_TIMEOUT = 60.0

_UPSERT_SQL = """
INSERT INTO cnae_codes (code, description, division, division_description)
VALUES (%(code)s, %(description)s, %(division)s, %(division_description)s)
ON CONFLICT (code) DO UPDATE SET
    description = EXCLUDED.description,
    division = EXCLUDED.division,
    division_description = EXCLUDED.division_description
"""


def entry_to_row(entry: dict[str, Any]) -> dict[str, str]:
    """Maps one IBGE subclasse JSON entry to `cnae_codes` row params.

    Entry shape: {"id": "6201500", "descricao": "...",
    "classe": {..., "grupo": {..., "divisao": {"id": "62", "descricao": "..."}}}}.
    """
    division = entry["classe"]["grupo"]["divisao"]
    return {
        "code": entry["id"],
        "description": entry["descricao"],
        "division": division["id"],
        "division_description": division["descricao"],
    }


def fetch_subclasses(client: httpx.Client) -> list[dict[str, Any]]:
    response = client.get(IBGE_CNAE_URL, timeout=REQUEST_TIMEOUT)
    response.raise_for_status()
    return response.json()


def seed(conn: psycopg.Connection, *, client: httpx.Client | None = None) -> dict[str, int]:
    """Fetches all IBGE CNAE subclasses and upserts them into `cnae_codes`.
    Returns {"seeded": row_count}."""
    owns_client = client is None
    client = client or httpx.Client()
    try:
        entries = fetch_subclasses(client)
        rows = [entry_to_row(entry) for entry in entries]
        with conn.cursor() as cur:
            for row in rows:
                cur.execute(_UPSERT_SQL, row)
        conn.commit()
    finally:
        if owns_client:
            client.close()
    return {"seeded": len(rows)}
