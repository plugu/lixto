"""Label embeddings for the closed taxonomy (cycle 32).

Embeds every CNAE subclass (`cnae_code_embeddings`) and every classification
segment (`classification_segments.embedding`) so a tender can be classified by
cosine distance. Vectors travel as text and are cast with `::vector`.
"""

from __future__ import annotations

import logging
from typing import Any

import psycopg

from lixto.classify.taxonomy import SEGMENT_CODES
from lixto.enrich.embed import to_pgvector
from lixto.llm import LlmClient
from lixto.runs import RunCounters

logger = logging.getLogger(__name__)

BATCH_SIZE = 100

_SELECT_CNAES_SQL = """
SELECT c.code, c.description, c.division_description
FROM cnae_codes c
WHERE %(force)s
   OR NOT EXISTS (SELECT 1 FROM cnae_code_embeddings e WHERE e.cnae_code = c.code)
ORDER BY c.code
"""

_UPSERT_CNAE_SQL = """
INSERT INTO cnae_code_embeddings (cnae_code, model, embedding, embedded_at)
VALUES (%(code)s, %(model)s, %(embedding)s::vector, now())
ON CONFLICT (cnae_code) DO UPDATE
SET model = EXCLUDED.model,
    embedding = EXCLUDED.embedding,
    embedded_at = now()
"""

_SELECT_SEGMENTS_SQL = """
SELECT s.code, s.label, s.description
FROM classification_segments s
WHERE %(force)s OR s.embedding IS NULL
ORDER BY s.sort_order
"""

_UPDATE_SEGMENT_SQL = """
UPDATE classification_segments
SET embedding = %(embedding)s::vector,
    embedding_model = %(model)s,
    embedded_at = now()
WHERE code = %(code)s
"""


def cnae_text(row: dict[str, Any]) -> str:
    return f"{row['description']} ({row['division_description']})"


def segment_text(row: dict[str, Any]) -> str:
    return f"{row['label']}: {row['description']}"


def embed_labels(
    conn: psycopg.Connection,
    *,
    llm: LlmClient | None = None,
    counters: RunCounters | None = None,
    force: bool = False,
) -> dict[str, int]:
    """Embeds CNAE subclasses and segments lacking a vector (all with `force`),
    in batches of BATCH_SIZE with a commit per batch. The LlmClient is built
    lazily so a run with nothing to do needs no credentials."""
    counters = counters if counters is not None else RunCounters()
    for key in ("cnae_embedded", "segments_embedded"):
        counters[key] = counters.get(key)

    with conn.cursor(row_factory=psycopg.rows.dict_row) as cur:
        cur.execute(_SELECT_CNAES_SQL, {"force": force})
        cnaes = cur.fetchall()
    with conn.cursor(row_factory=psycopg.rows.dict_row) as cur:
        cur.execute(_SELECT_SEGMENTS_SQL, {"force": force})
        segments = cur.fetchall()

    llm = _embed_batches(conn, cnaes, cnae_text, _UPSERT_CNAE_SQL, llm, counters, "cnae_embedded")
    _embed_batches(
        conn, segments, segment_text, _UPDATE_SEGMENT_SQL, llm, counters, "segments_embedded"
    )
    return counters.as_dict()


def _embed_batches(
    conn: psycopg.Connection,
    rows: list[dict[str, Any]],
    text_for: Any,
    sql: str,
    llm: LlmClient | None,
    counters: RunCounters,
    counter_key: str,
) -> LlmClient | None:
    for start in range(0, len(rows), BATCH_SIZE):
        batch = rows[start : start + BATCH_SIZE]
        llm = llm or LlmClient()
        vectors, model = llm.embed([text_for(r) for r in batch])
        with conn.cursor() as cur:
            for row, vector in zip(batch, vectors):
                cur.execute(
                    sql,
                    {"code": row["code"], "model": model, "embedding": to_pgvector(vector)},
                )
                counters.inc(counter_key)
        conn.commit()
    return llm


def verify_taxonomy(conn: psycopg.Connection) -> list[str]:
    """Segment codes that differ between `SEGMENTS` and the seeded table:
    in code but missing from the table, and in the table but not in code."""
    with conn.cursor() as cur:
        cur.execute("SELECT code FROM classification_segments")
        in_db = {row[0] for row in cur.fetchall()}
    return sorted(SEGMENT_CODES - in_db) + sorted(in_db - SEGMENT_CODES)
