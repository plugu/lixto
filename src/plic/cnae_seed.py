"""Seeds the `cnae` reference table from the IBGE subclasses API.

One-shot/idempotent tool: `plic cnae seed` fetches the ~1359 IBGE CNAE
subclasses in a single GET and upserts them into `cnae` (division + subclass
levels only — seção/grupo are out of scope, see ticket 50). Re-running just
refreshes descriptions, it never duplicates rows (PK on `codigo`).
"""

from __future__ import annotations

import os
from typing import Any

import httpx
import psycopg

IBGE_CNAE_URL = os.environ.get(
    "PLIC_IBGE_CNAE_URL",
    "https://servicodados.ibge.gov.br/api/v2/cnae/subclasses",
)
REQUEST_TIMEOUT = 60.0

_UPSERT_SQL = """
INSERT INTO cnae (codigo, descricao, divisao, divisao_descricao)
VALUES (%(codigo)s, %(descricao)s, %(divisao)s, %(divisao_descricao)s)
ON CONFLICT (codigo) DO UPDATE SET
    descricao = EXCLUDED.descricao,
    divisao = EXCLUDED.divisao,
    divisao_descricao = EXCLUDED.divisao_descricao
"""


def entry_to_row(entry: dict[str, Any]) -> dict[str, str]:
    """Maps one IBGE subclasse JSON entry to `cnae` row params.

    Entry shape: {"id": "6201500", "descricao": "...",
    "classe": {..., "grupo": {..., "divisao": {"id": "62", "descricao": "..."}}}}.
    """
    divisao = entry["classe"]["grupo"]["divisao"]
    return {
        "codigo": entry["id"],
        "descricao": entry["descricao"],
        "divisao": divisao["id"],
        "divisao_descricao": divisao["descricao"],
    }


def fetch_subclasses(client: httpx.Client) -> list[dict[str, Any]]:
    response = client.get(IBGE_CNAE_URL, timeout=REQUEST_TIMEOUT)
    response.raise_for_status()
    return response.json()


def seed(conn: psycopg.Connection, *, client: httpx.Client | None = None) -> dict[str, int]:
    """Fetches all IBGE CNAE subclasses and upserts them into `cnae`.
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
