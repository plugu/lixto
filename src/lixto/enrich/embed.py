"""Embeddings for the canonical enrichment.

One vector per enriched procurement in `procurement_embeddings`, produced
from a deterministic canonical text (summary + concepts + keywords +
categories) through the same `LlmClient` abstraction the rest of the Python
side uses. The worker embeds inline while enriching; `embed_pending` (behind
`lixto enrich embed`) backfills rows whose inline embed call failed — after a
clean `lixto enrich run` it is a no-op.

`embed_ingested` covers the tenders nobody analysed: analysis runs only on
demand, so most ingested procurements never get an enrichment. For open or
upcoming ones without a done enrichment it embeds the raw PNCP text (object +
distinct item descriptions). When an analysis later lands, the worker's upsert
replaces that vector with the enrichment one.

psycopg has no pgvector adapter here, so vectors travel as the literal text
`[0.1,0.2,...]` and the SQL casts them with `::vector`.
"""

from __future__ import annotations

import logging
from collections.abc import Callable
from typing import Any

import psycopg

from lixto.llm import LlmClient
from lixto.runs import RunCounters

logger = logging.getLogger(__name__)

BATCH_SIZE = 50

# categories live in their own table, so the canonical text is rebuilt with a
# join instead of reading an array column.
_SELECT_PENDING_SQL = """
SELECT e.procurement_id,
       e.summary,
       e.concepts,
       e.keywords,
       coalesce(
           array_remove(array_agg(c.category ORDER BY c.category), NULL),
           '{}'
       ) AS categories
FROM procurement_enrichments e
LEFT JOIN procurement_categories c ON c.procurement_id = e.procurement_id
WHERE e.status = 'done'
  AND NOT EXISTS (
        SELECT 1 FROM procurement_embeddings pe
        WHERE pe.procurement_id = e.procurement_id
      )
GROUP BY e.procurement_id
ORDER BY e.enriched_at DESC
LIMIT %(limit)s
"""

_UPSERT_SQL = """
INSERT INTO procurement_embeddings (procurement_id, model, embedding, embedded_at)
VALUES (%(procurement_id)s, %(model)s, %(embedding)s::vector, now())
ON CONFLICT (procurement_id) DO UPDATE
SET model = EXCLUDED.model,
    embedding = EXCLUDED.embedding,
    embedded_at = now()
"""


# Open/upcoming tenders with no vector and no finished analysis. Same "open"
# predicate as the cost fence's open_only; portals and modalities are not
# fenced because embeddings cost fractions of a cent per tender.
_SELECT_INGESTED_SQL = """
SELECT p.id AS procurement_id,
       p.description,
       coalesce(
           (SELECT array_agg(d.description ORDER BY d.description)
              FROM (SELECT DISTINCT i.description
                      FROM procurement_items i
                     WHERE i.procurement_id = p.id
                       AND btrim(coalesce(i.description, '')) <> ''
                     ORDER BY i.description
                     LIMIT %(max_items)s) d),
           '{}'
       ) AS items
FROM procurements p
WHERE (p.proposal_closes_at >= now() OR p.proposal_opens_at > now())
  AND btrim(coalesce(p.description, '')) <> ''
  AND NOT EXISTS (
        SELECT 1 FROM procurement_embeddings pe
        WHERE pe.procurement_id = p.id
      )
  AND NOT EXISTS (
        SELECT 1 FROM procurement_enrichments e
        WHERE e.procurement_id = p.id AND e.status = 'done'
      )
ORDER BY p.source_global_updated_at DESC NULLS LAST, p.id DESC
LIMIT %(limit)s
"""

# Item descriptions beyond this add little signal; LlmClient also truncates.
MAX_ITEMS = 20


def build_embedding_text(payload_or_row: dict[str, Any]) -> str:
    """Canonical text embedded for a procurement — same composition whether
    it comes from a fresh LLM payload or from persisted rows, so backfilled
    vectors are comparable with inline ones."""
    parts: list[str] = []

    summary = payload_or_row.get("summary")
    if isinstance(summary, str) and summary.strip():
        parts.append(summary.strip())

    for key in ("concepts", "keywords", "categories"):
        values = [str(v).strip() for v in (payload_or_row.get(key) or []) if str(v).strip()]
        if values:
            parts.append(", ".join(values))

    return "\n".join(parts)


def build_ingested_embedding_text(row: dict[str, Any]) -> str:
    """Raw-text counterpart of `build_embedding_text`: the PNCP object
    (`objetoCompra`) followed by the distinct item descriptions."""
    parts: list[str] = []
    description = row.get("description")
    if isinstance(description, str) and description.strip():
        parts.append(description.strip())
    items = [str(v).strip() for v in (row.get("items") or []) if str(v).strip()]
    if items:
        parts.append("; ".join(items))
    return "\n".join(parts)


def to_pgvector(vec: list[float]) -> str:
    """`[0.1,0.2,...]` — the text form pgvector accepts via `::vector`."""
    return "[" + ",".join(repr(float(v)) for v in vec) + "]"


def embed_pending(
    conn: psycopg.Connection,
    *,
    limit: int | None = None,
    llm: LlmClient | None = None,
    counters: RunCounters | None = None,
) -> dict[str, int]:
    """Fills `procurement_embeddings` for done-but-unembedded enrichments, in
    batches of BATCH_SIZE with a commit per batch (so a crash keeps whatever
    was already written). On an SDK error the run stops and returns its
    counters — rerunning retries the remaining rows.

    The LlmClient is built lazily, on the first batch, so a run with nothing
    pending is a true no-op and needs no provider credentials."""
    counters = counters if counters is not None else RunCounters()
    for key in ("processed", "embedded", "error"):
        counters[key] = counters.get(key)

    with conn.cursor(row_factory=psycopg.rows.dict_row) as cur:
        cur.execute(_SELECT_PENDING_SQL, {"limit": limit})
        rows = cur.fetchall()

    _embed_rows(conn, rows, build_embedding_text, llm, counters, prefix="")
    return counters.as_dict()


def embed_ingested(
    conn: psycopg.Connection,
    *,
    limit: int | None = None,
    llm: LlmClient | None = None,
    counters: RunCounters | None = None,
) -> dict[str, int]:
    """Fills `procurement_embeddings` for open/upcoming ingested tenders that
    have neither a vector nor a finished analysis, from their raw PNCP text.
    Same batching, commit and stop-on-error behaviour as `embed_pending`;
    counters are prefixed `ingested_` so one run can report both passes."""
    counters = counters if counters is not None else RunCounters()
    for key in ("ingested_processed", "ingested_embedded", "ingested_error"):
        counters[key] = counters.get(key)

    with conn.cursor(row_factory=psycopg.rows.dict_row) as cur:
        cur.execute(_SELECT_INGESTED_SQL, {"limit": limit, "max_items": MAX_ITEMS})
        rows = cur.fetchall()

    _embed_rows(conn, rows, build_ingested_embedding_text, llm, counters, prefix="ingested_")
    return {k: v for k, v in counters.as_dict().items() if k.startswith("ingested_")}


def _embed_rows(
    conn: psycopg.Connection,
    rows: list[dict[str, Any]],
    text_for: Callable[[dict[str, Any]], str],
    llm: LlmClient | None,
    counters: RunCounters,
    *,
    prefix: str,
) -> None:
    """Embed `rows` in batches of BATCH_SIZE, one commit per batch. The
    LlmClient is built lazily so an empty queue needs no credentials; an SDK
    error stops the run (rerun retries the remaining rows)."""
    for start in range(0, len(rows), BATCH_SIZE):
        batch = rows[start : start + BATCH_SIZE]
        texts = [text_for(row) for row in batch]
        try:
            llm = llm or LlmClient()
            vectors, model = llm.embed(texts)
        except Exception:
            logger.exception("embedding batch failed; stopping (rerun to retry)")
            counters.inc(f"{prefix}processed", len(batch))
            counters.inc(f"{prefix}error", len(batch))
            break

        with conn.cursor() as cur:
            for row, vector in zip(batch, vectors):
                cur.execute(
                    _UPSERT_SQL,
                    {
                        "procurement_id": row["procurement_id"],
                        "model": model,
                        "embedding": to_pgvector(vector),
                    },
                )
                counters.inc(f"{prefix}embedded")
        conn.commit()
        counters.inc(f"{prefix}processed", len(batch))
