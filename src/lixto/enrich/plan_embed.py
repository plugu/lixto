"""Embeddings for in-horizon PCA (Annual Procurement Plan) items.

Mirrors `lixto.enrich.embed`: one vector per plan item in
`plan_item_embeddings`, produced from a deterministic canonical text through
the same `LlmClient` abstraction. Unlike procurement enrichment there is no
inline embed call — `lixto plans sync` only ingests rows, so this backfill
(behind `lixto plans embed`) is the only path that ever fills the table.

Only items inside the Radar horizon (PRODUCT.md, cycle 24) are candidates:
future plan years, a desired date that has not passed and is not further out
than `horizon_days` — mirroring the horizon query in
`web/lib/radar-batch.ts` so the two stay in step. Items whose desired date is
NULL are always in horizon (never known to have passed).

psycopg has no pgvector adapter here, so vectors travel as the literal text
`[0.1,0.2,...]` and the SQL casts them with `::vector` — `to_pgvector` is
reused from `lixto.enrich.embed` rather than duplicated.
"""

from __future__ import annotations

import logging
from typing import Any

import psycopg

from lixto.enrich.embed import to_pgvector
from lixto.llm import LlmClient
from lixto.runs import RunCounters

logger = logging.getLogger(__name__)

BATCH_SIZE = 50

DEFAULT_HORIZON_DAYS = 365

_SELECT_PENDING_SQL = """
SELECT i.plan_id,
       i.item_number,
       i.description,
       i.pdm_description,
       i.category_name,
       i.catalog_classification_name
FROM procurement_plan_items i
JOIN procurement_plans p ON p.id = i.plan_id
WHERE p.year >= extract(year from current_date)
  AND (i.desired_date IS NULL OR i.desired_date >= current_date)
  AND (i.desired_date IS NULL OR i.desired_date <= current_date + %(horizon_days)s)
  AND NOT EXISTS (
        SELECT 1 FROM plan_item_embeddings pe
        WHERE pe.plan_id = i.plan_id AND pe.item_number = i.item_number
      )
  AND coalesce(i.description, '') <> ''
ORDER BY i.desired_date ASC NULLS LAST, p.id, i.item_number
LIMIT %(limit)s
"""

_UPSERT_SQL = """
INSERT INTO plan_item_embeddings (plan_id, item_number, model, embedding, embedded_at)
VALUES (%(plan_id)s, %(item_number)s, %(model)s, %(embedding)s::vector, now())
ON CONFLICT (plan_id, item_number) DO UPDATE
SET model = EXCLUDED.model,
    embedding = EXCLUDED.embedding,
    embedded_at = now()
"""


def build_plan_item_text(row: dict[str, Any]) -> str:
    """Canonical text embedded for a PCA item: description, then the PDM
    description (unless already contained in the description, case-insensitive
    — the two are frequently near-duplicates), then the category/catalog
    classification names. Deterministic, empties skipped."""
    parts: list[str] = []

    description = row.get("description")
    description = description.strip() if isinstance(description, str) else ""
    if description:
        parts.append(description)

    pdm_description = row.get("pdm_description")
    if isinstance(pdm_description, str) and pdm_description.strip():
        pdm_description = pdm_description.strip()
        if pdm_description.lower() not in description.lower():
            parts.append(pdm_description)

    for key in ("category_name", "catalog_classification_name"):
        value = row.get(key)
        if isinstance(value, str) and value.strip():
            parts.append(value.strip())

    return "\n".join(parts)


def embed_pending(
    conn: psycopg.Connection,
    *,
    horizon_days: int = DEFAULT_HORIZON_DAYS,
    limit: int | None = None,
    llm: LlmClient | None = None,
    counters: RunCounters | None = None,
) -> dict[str, int]:
    """Fills `plan_item_embeddings` for in-horizon PCA items that have none
    yet, in batches of BATCH_SIZE with a commit per batch (so a crash keeps
    whatever was already written). On an SDK error the run stops and returns
    its counters — rerunning retries the remaining rows.

    The LlmClient is built lazily, on the first batch, so a run with nothing
    pending is a true no-op and needs no provider credentials."""
    counters = counters if counters is not None else RunCounters()
    for key in ("processed", "embedded", "error"):
        counters[key] = counters.get(key)

    with conn.cursor(row_factory=psycopg.rows.dict_row) as cur:
        cur.execute(_SELECT_PENDING_SQL, {"horizon_days": horizon_days, "limit": limit})
        rows = cur.fetchall()

    for start in range(0, len(rows), BATCH_SIZE):
        batch = rows[start : start + BATCH_SIZE]
        texts = [build_plan_item_text(row) for row in batch]
        try:
            llm = llm or LlmClient()
            vectors, model = llm.embed(texts)
        except Exception:
            logger.exception("embedding batch failed; stopping (rerun to retry)")
            counters.inc("processed", len(batch))
            counters.inc("error", len(batch))
            break

        with conn.cursor() as cur:
            for row, vector in zip(batch, vectors):
                cur.execute(
                    _UPSERT_SQL,
                    {
                        "plan_id": row["plan_id"],
                        "item_number": row["item_number"],
                        "model": model,
                        "embedding": to_pgvector(vector),
                    },
                )
                counters.inc("embedded")
        conn.commit()
        counters.inc("processed", len(batch))

    return counters.as_dict()
