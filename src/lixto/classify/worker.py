"""Ingest-time classification of open tenders (cycle 32).

For every open/upcoming tender with a raw-text embedding and no finished
classification at the current schema version: take the nearest CNAE subclasses
and segments by cosine distance, let one CHEAP LLM call choose among them, and
persist the validated choice (`procurement_classifications` plus
`procurement_cnaes` rows with origin 'ingest').
"""

from __future__ import annotations

import logging
import os
from typing import Any

import psycopg
from psycopg.types.json import Json

from lixto.classify.schema import (
    CLASSIFICATION_SCHEMA,
    INSTRUCTIONS,
    MAX_ITEMS,
    SCHEMA_VERSION,
    build_prompt,
    validate_payload,
)
from lixto.classify.taxonomy import segment_by_code
from lixto.enrich.embed import PNCP_STATUS_PUBLISHED
from lixto.llm import LlmClient
from lixto.runs import RunCounters

logger = logging.getLogger(__name__)

BATCH_LIMIT_DEFAULT = 1000
CNAE_CANDIDATES = 15
SEGMENT_CANDIDATES = 6
FALLBACK_SEGMENT = "outros"

LIXTO_CLASSIFY_DAILY_CAP = "LIXTO_CLASSIFY_DAILY_CAP"
LIXTO_CLASSIFY_MODALITIES = "LIXTO_CLASSIFY_MODALITIES"
DEFAULT_MODALITIES = (6, 8)

_USED_TODAY_SQL = (
    "SELECT count(*) FROM procurement_classifications "
    "WHERE classified_at >= date_trunc('day', now())"
)

_READY_SQL = """
SELECT (SELECT count(*) FROM cnae_code_embeddings),
       (SELECT count(*) FROM classification_segments WHERE embedding IS NULL)
"""

_SELECT_PENDING_SQL = """
SELECT p.id AS procurement_id,
       p.description,
       pe.embedding::text AS embedding,
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
JOIN procurement_embeddings pe ON pe.procurement_id = p.id
WHERE p.status_id = %(active_status_id)s
  AND (p.proposal_closes_at >= now() OR p.proposal_opens_at > now())
  AND btrim(coalesce(p.description, '')) <> ''
  AND p.modality_id = ANY(%(modalities)s)
  AND NOT EXISTS (
        SELECT 1 FROM procurement_classifications c
        WHERE c.procurement_id = p.id
          AND c.schema_version = %(schema_version)s
          AND (c.status = 'done' OR NOT %(retry_errors)s)
      )
ORDER BY p.published_at DESC NULLS LAST, p.id DESC
LIMIT %(limit)s
"""

_CNAE_CANDIDATES_SQL = f"""
SELECT ce.cnae_code, c.description, 1 - (ce.embedding <=> %(v)s::vector) AS similarity
FROM cnae_code_embeddings ce
JOIN cnae_codes c ON c.code = ce.cnae_code
ORDER BY ce.embedding <=> %(v)s::vector
LIMIT {CNAE_CANDIDATES}
"""

_SEGMENT_CANDIDATES_SQL = f"""
SELECT code, label, description, 1 - (embedding <=> %(v)s::vector) AS similarity
FROM classification_segments
WHERE embedding IS NOT NULL
ORDER BY embedding <=> %(v)s::vector
LIMIT {SEGMENT_CANDIDATES}
"""

_DELETE_INGEST_CNAES_SQL = (
    "DELETE FROM procurement_cnaes WHERE procurement_id = %(id)s AND origin = 'ingest'"
)

# A dossier row (origin 'enrichment') for the same code wins.
_INSERT_CNAE_SQL = """
INSERT INTO procurement_cnaes (procurement_id, cnae_code, confidence, origin)
VALUES (%(id)s, %(code)s, %(confidence)s, 'ingest')
ON CONFLICT DO NOTHING
"""

_UPSERT_CLASSIFICATION_SQL = """
INSERT INTO procurement_classifications (
    procurement_id, schema_version, model, status, error, segment,
    segment_confidence, segment_source, nature, keywords, data, classified_at
) VALUES (
    %(id)s, %(schema_version)s, %(model)s, %(status)s, %(error)s, %(segment)s,
    %(segment_confidence)s, %(segment_source)s, %(nature)s, %(keywords)s, %(data)s, now()
)
ON CONFLICT (procurement_id) DO UPDATE SET
    schema_version = EXCLUDED.schema_version,
    model = EXCLUDED.model,
    status = EXCLUDED.status,
    error = EXCLUDED.error,
    segment = EXCLUDED.segment,
    segment_confidence = EXCLUDED.segment_confidence,
    segment_source = EXCLUDED.segment_source,
    nature = EXCLUDED.nature,
    keywords = EXCLUDED.keywords,
    data = EXCLUDED.data,
    classified_at = now(),
    updated_at = now()
"""


def _daily_cap() -> int:
    """`LIXTO_CLASSIFY_DAILY_CAP` rows/day; 0 or unset means unlimited."""
    try:
        return int(os.environ.get(LIXTO_CLASSIFY_DAILY_CAP, "0"))
    except ValueError:
        return 0


def _modalities() -> list[int]:
    """`LIXTO_CLASSIFY_MODALITIES` comma-separated modality ids (default 6,8)."""
    raw = os.environ.get(LIXTO_CLASSIFY_MODALITIES, "")
    ids = [int(p) for p in (x.strip() for x in raw.split(",")) if p.isdigit()]
    return ids or list(DEFAULT_MODALITIES)


def _ensure_ready(conn: psycopg.Connection) -> None:
    with conn.cursor() as cur:
        cur.execute(_READY_SQL)
        cnae_count, segments_missing = cur.fetchone()
    if cnae_count == 0 or segments_missing > 0:
        raise RuntimeError(
            "label embeddings are missing (run `lixto classify embed-labels` first): "
            f"{cnae_count} CNAE vectors, {segments_missing} segments without a vector"
        )


def _fetch_candidates(
    conn: psycopg.Connection, vector: str
) -> tuple[list[tuple[str, str, float]], list[tuple[str, str, str, float]]]:
    """Nearest CNAEs as (code, description, similarity) and segments as
    (code, label, description, similarity); `outros` is always offered."""
    with conn.cursor() as cur:
        cur.execute(_CNAE_CANDIDATES_SQL, {"v": vector})
        cnaes = [(str(r[0]), r[1], float(r[2])) for r in cur.fetchall()]
        cur.execute(_SEGMENT_CANDIDATES_SQL, {"v": vector})
        segments = [(r[0], r[1], r[2], float(r[3])) for r in cur.fetchall()]
    if all(code != FALLBACK_SEGMENT for code, *_ in segments):
        other = segment_by_code(FALLBACK_SEGMENT)
        segments.append((other.code, other.label, other.description, 0.0))
    return cnaes, segments


def _persist(conn: psycopg.Connection, params: dict[str, Any], cnaes: list[dict[str, Any]]) -> None:
    with conn.cursor() as cur:
        if params["status"] == "done":
            cur.execute(_DELETE_INGEST_CNAES_SQL, {"id": params["id"]})
            for cnae in cnaes:
                cur.execute(
                    _INSERT_CNAE_SQL,
                    {"id": params["id"], "code": cnae["code"], "confidence": cnae["confidence"]},
                )
        cur.execute(_UPSERT_CLASSIFICATION_SQL, params)
    conn.commit()


def classify_one(conn: psycopg.Connection, row: dict[str, Any], *, llm: LlmClient) -> str:
    """Classify one tender; returns 'done' or 'error'. LLM/SDK errors
    propagate (the run stops); a persistence failure is rolled back and
    reported as 'error'."""
    procurement_id = row["procurement_id"]
    cnae_cands, seg_cands = _fetch_candidates(conn, row["embedding"])

    prompt = build_prompt(
        row["description"],
        list(row.get("items") or [])[:MAX_ITEMS],
        [(code, desc) for code, desc, _ in cnae_cands],
        [(code, label, desc) for code, label, desc, _ in seg_cands],
    )
    raw, model = llm.complete_json_text(
        tier="cheap",
        instructions=INSTRUCTIONS,
        prompt=prompt,
        schema=CLASSIFICATION_SCHEMA,
        name="tender_classification",
    )
    payload = validate_payload(
        raw,
        cnae_candidates={code for code, _, _ in cnae_cands},
        segment_candidates=[(code, sim) for code, _, _, sim in seg_cands],
    )

    data = {
        "candidates": {
            "cnaes": [{"code": c, "similarity": s} for c, _, s in cnae_cands],
            "segments": [{"code": c, "similarity": s} for c, _, _, s in seg_cands],
        },
        "raw": raw,
        "model": model,
    }
    params: dict[str, Any] = {
        "id": procurement_id,
        "schema_version": SCHEMA_VERSION,
        "model": model,
        "status": "done" if payload else "error",
        "error": None if payload else "no valid classification in the model response",
        "segment": payload["segment"] if payload else None,
        "segment_confidence": payload["segment_confidence"] if payload else None,
        "segment_source": payload["segment_source"] if payload else None,
        "nature": payload["nature"] if payload else None,
        "keywords": payload["keywords"] if payload else [],
        "data": Json(data),
    }
    try:
        _persist(conn, params, payload["cnaes"] if payload else [])
    except psycopg.Error:
        logger.exception("failed to persist classification for %s", procurement_id)
        conn.rollback()
        return "error"
    return params["status"]


def _apply_usage(counters: RunCounters, llm: LlmClient) -> dict[str, Any]:
    s = llm.usage_summary()
    counters["llm_calls"] = s["calls"]
    counters["llm_prompt_tokens"] = s["prompt_tokens"]
    counters["llm_completion_tokens"] = s["completion_tokens"]
    counters["llm_est_usd_micros"] = s["est_usd_micros"]
    if s["unpriced_models"]:
        counters["llm_unpriced_models"] = len(s["unpriced_models"])
        logger.warning("unpriced models in usage: %s", s["unpriced_models"])
    result = counters.as_dict()
    result["est_usd"] = s["est_usd_micros"] / 1_000_000
    return result


def classify(
    conn: psycopg.Connection,
    *,
    limit: int | None = None,
    retry_errors: bool = False,
    llm: LlmClient | None = None,
    counters: RunCounters | None = None,
) -> dict[str, Any]:
    """Classify pending open tenders one at a time (commit per row), up to
    min(`limit`, what is left of the daily cap). Returns counters (processed,
    classified, error, cap, used_today_at_start, cap_reached, llm_*) plus
    `est_usd`. Stops on the first LLM/SDK error; rerunning resumes."""
    _ensure_ready(conn)
    llm = llm or LlmClient()
    counters = counters if counters is not None else RunCounters()
    for key in ("processed", "classified", "error"):
        counters[key] = counters.get(key)

    cap = _daily_cap()
    counters["cap"] = cap
    counters["cap_reached"] = 0
    used_today = 0
    if cap > 0:
        with conn.cursor() as cur:
            cur.execute(_USED_TODAY_SQL)
            used_today = cur.fetchone()[0]
    counters["used_today_at_start"] = used_today

    effective_limit = limit if limit is not None else BATCH_LIMIT_DEFAULT
    cap_limited = False
    if cap > 0:
        remaining = cap - used_today
        if remaining <= 0:
            counters["cap_reached"] = 1
            logger.info("daily cap %d reached (%d classified today)", cap, used_today)
            return _apply_usage(counters, llm)
        cap_limited = remaining < effective_limit
        effective_limit = min(effective_limit, remaining)

    with conn.cursor(row_factory=psycopg.rows.dict_row) as cur:
        cur.execute(
            _SELECT_PENDING_SQL,
            {
                "max_items": MAX_ITEMS,
                "active_status_id": PNCP_STATUS_PUBLISHED,
                "modalities": _modalities(),
                "schema_version": SCHEMA_VERSION,
                "retry_errors": retry_errors,
                "limit": effective_limit,
            },
        )
        rows = cur.fetchall()

    for row in rows:
        counters.inc("processed")
        try:
            outcome = classify_one(conn, row, llm=llm)
        except Exception:
            logger.exception("classification failed for %s; stopping", row["procurement_id"])
            conn.rollback()
            counters.inc("error")
            break
        counters.inc("classified" if outcome == "done" else "error")

    if cap_limited and counters["processed"] >= effective_limit:
        counters["cap_reached"] = 1

    return _apply_usage(counters, llm)
