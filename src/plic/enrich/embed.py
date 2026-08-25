"""Embeddings for the canonical enrichment (cycle 17, ticket 71).

One vector per `enriquecimento` row, produced from a deterministic canonical
text (resumo + conceitos + palavras_chave + categorias) through the same
`LlmClient` abstraction the rest of the Python side uses. The worker embeds
inline while enriching; `embed_pending` (behind `plic enrich embed`) backfills
rows enriched before this cycle — or rows whose inline embed call failed.

psycopg has no pgvector adapter here, so vectors travel as the literal text
`[0.1,0.2,...]` and the SQL casts them with `::vector`.
"""

from __future__ import annotations

import logging
from typing import Any

import psycopg

from plic.llm import LlmClient

logger = logging.getLogger(__name__)

BATCH_SIZE = 50

_SELECT_PENDING_SQL = """
SELECT numero_controle_pncp, resumo, conceitos, palavras_chave, categorias
FROM enriquecimento
WHERE status = 'done' AND embedding IS NULL
ORDER BY enriquecido_em DESC
LIMIT %(limit)s
"""

_UPDATE_SQL = """
UPDATE enriquecimento
SET embedding = %(embedding)s::vector,
    embedding_modelo = %(modelo)s,
    embedding_em = now(),
    updated_at = now()
WHERE numero_controle_pncp = %(numero)s
"""


def build_embedding_text(payload_or_row: dict[str, Any]) -> str:
    """Canonical text embedded for a licitação — same composition whether it
    comes from a fresh LLM payload or from a persisted `enriquecimento` row,
    so backfilled vectors are comparable with inline ones."""
    parts: list[str] = []

    resumo = payload_or_row.get("resumo")
    if isinstance(resumo, str) and resumo.strip():
        parts.append(resumo.strip())

    for key in ("conceitos", "palavras_chave", "categorias"):
        values = [str(v).strip() for v in (payload_or_row.get(key) or []) if str(v).strip()]
        if values:
            parts.append(", ".join(values))

    return "\n".join(parts)


def to_pgvector(vec: list[float]) -> str:
    """`[0.1,0.2,...]` — the text form pgvector accepts via `::vector`."""
    return "[" + ",".join(repr(float(v)) for v in vec) + "]"


def embed_pending(
    conn: psycopg.Connection,
    *,
    limit: int | None = None,
    llm: LlmClient | None = None,
) -> dict[str, int]:
    """Fills `enriquecimento.embedding` for done-but-unembedded rows, in
    batches of BATCH_SIZE with a commit per batch (so a crash keeps whatever
    was already written). On an SDK error the run stops and returns its
    counters — rerunning retries the remaining rows.

    The LlmClient is built lazily, on the first batch, so a run with nothing
    pending is a true no-op and needs no provider credentials."""
    counters = {"processed": 0, "embedded": 0, "error": 0}

    with conn.cursor(row_factory=psycopg.rows.dict_row) as cur:
        cur.execute(_SELECT_PENDING_SQL, {"limit": limit})
        rows = cur.fetchall()

    for start in range(0, len(rows), BATCH_SIZE):
        batch = rows[start : start + BATCH_SIZE]
        texts = [build_embedding_text(row) for row in batch]
        try:
            llm = llm or LlmClient()
            vectors, modelo = llm.embed(texts)
        except Exception:
            logger.exception("embedding batch failed; stopping (rerun to retry)")
            counters["processed"] += len(batch)
            counters["error"] += len(batch)
            break

        with conn.cursor() as cur:
            for row, vector in zip(batch, vectors):
                cur.execute(
                    _UPDATE_SQL,
                    {
                        "embedding": to_pgvector(vector),
                        "modelo": modelo,
                        "numero": row["numero_controle_pncp"],
                    },
                )
                counters["embedded"] += 1
        conn.commit()
        counters["processed"] += len(batch)

    return counters
