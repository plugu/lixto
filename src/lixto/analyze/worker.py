"""The tender-analysis worker behind `lixto analyze run`.

Replaces the cycle-18 enrichment worker: one pass per pending open
procurement, select → per-row LLM → persist → commit, so a crash only loses
the in-flight procurement. Each row is routed to the cheapest input the
material allows:

- any document with extracted page text → `input_kind='text'`, doc tier on the
  page-tagged text of every PDF;
- only scanned/insufficient PDFs (at most MAX_PDFS) → `input_kind='pdf'`, doc
  tier with the PDFs inline;
- nothing usable → `input_kind='structured'`, cheap tier on the PNCP metadata
  alone.

One transaction per procurement writes `procurement_enrichments` and its facet
tables (unchanged 1.0 contract, `schema_version` 2.0) *plus* `tender_analyses`
and its children, so a reader never sees a dossier whose facts are
half-written or facets that disagree with the dossier they came from.

The daily cap keeps its cycle-18 env var name (`LIXTO_ENRICH_DAILY_CAP`) on
purpose: renaming it would break every deployed schedule for no gain.
"""

from __future__ import annotations

import json
import logging
import os
from typing import Any

import httpx
import psycopg

from lixto.analyze.prompt import DEFAULT_MAX_CHARS, INSTRUCTIONS, MAX_ITEMS, build_prompt
from lixto.analyze.schema import ANALYSIS_SCHEMA, SCHEMA_VERSION, validate_analysis
from lixto.enrich.documents import DOWNLOAD_TIMEOUT, extract_for_procurement
from lixto.enrich.embed import build_embedding_text, to_pgvector
from lixto.fence import Fence, get_fence
from lixto.llm import LlmClient
from lixto.runs import RunCounters

logger = logging.getLogger(__name__)

BATCH_LIMIT_DEFAULT = 200

# Rows/day across every `analyze run` invocation; 0 or unset means unlimited.
# Name kept from cycle 18 so deployed schedules/env need no change.
LIXTO_ENRICH_DAILY_CAP = "LIXTO_ENRICH_DAILY_CAP"
LIXTO_ANALYZE_MAX_CHARS = "LIXTO_ANALYZE_MAX_CHARS"

MAX_PDFS = 2
MAX_PDF_BYTES = 30 * 1024 * 1024  # 30 MB combined

# Identity of the document set an analysis was produced from. Ticket 134
# copies this text verbatim into the web read side, so a dossier can be
# marked stale the moment a document is added, replaced or republished —
# keep the two implementations byte-identical.
DOCUMENT_SET_HASH_SQL = """
SELECT md5(coalesce(string_agg(
    sequence || ':' || coalesce(to_char(published_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS'), '') || ':' || coalesce(url, ''),
    E'\\n' ORDER BY sequence), ''))
FROM procurement_documents
WHERE procurement_id = %(procurement_id)s AND is_active IS TRUE
"""

# `%(retry_errors)s` flips the pending predicate: normally any existing
# analysis row excludes the procurement; with --retry-errors, rows whose last
# run failed become eligible again.
_SELECT_PENDING_SQL = """
SELECT p.id,
       p.source_id,
       p.description,
       p.additional_info,
       p.modality_name,
       p.state,
       p.city_name,
       p.estimated_value,
       p.published_at,
       p.proposal_opens_at,
       p.proposal_closes_at,
       p.is_price_registry,
       a.name AS agency_name
FROM procurements p
JOIN agencies a ON a.tax_id = p.agency_tax_id
WHERE (p.proposal_closes_at >= now() OR p.proposal_opens_at > now())
  AND NOT EXISTS (
        SELECT 1 FROM tender_analyses t
        WHERE t.procurement_id = p.id
          AND (NOT %(retry_errors)s OR t.status <> 'error')
      )
  AND (%(days)s::int IS NULL
       OR p.published_at >= now() - make_interval(days => %(days)s))
ORDER BY p.proposal_closes_at ASC NULLS LAST
LIMIT %(limit)s
"""

_SELECT_ITEMS_SQL = """
SELECT description, quantity, unit, estimated_unit_price, kind, benefit_type_id
FROM procurement_items
WHERE procurement_id = %(procurement_id)s
ORDER BY item_number
LIMIT %(max_items)s
"""

# Unlike _SELECT_ITEMS_SQL (capped for the prompt), the ME/EPP flags are
# derived from every item on the procurement, so this has no LIMIT.
_SELECT_BENEFITS_SQL = """
SELECT benefit_type_id FROM procurement_items WHERE procurement_id = %(procurement_id)s
"""

_UPSERT_ENRICHMENT_SQL = """
INSERT INTO procurement_enrichments (
    procurement_id, schema_version, model, confidence, status, error, input_kind,
    summary, concepts, keywords, risks, complexity,
    requires_certification, requires_technical_certificate,
    me_epp_exclusive, me_epp_preference, delivery_location, delivery_deadline_days,
    data, enriched_at, updated_at
) VALUES (
    %(procurement_id)s, %(schema_version)s, %(model)s, %(confidence)s, %(status)s, %(error)s,
    %(input_kind)s, %(summary)s, %(concepts)s, %(keywords)s, %(risks)s, %(complexity)s,
    %(requires_certification)s, %(requires_technical_certificate)s,
    %(me_epp_exclusive)s, %(me_epp_preference)s, %(delivery_location)s,
    %(delivery_deadline_days)s, %(data)s, now(), now()
)
ON CONFLICT (procurement_id) DO UPDATE
SET schema_version = EXCLUDED.schema_version,
    model = EXCLUDED.model,
    confidence = EXCLUDED.confidence,
    status = EXCLUDED.status,
    error = EXCLUDED.error,
    input_kind = EXCLUDED.input_kind,
    summary = EXCLUDED.summary,
    concepts = EXCLUDED.concepts,
    keywords = EXCLUDED.keywords,
    risks = EXCLUDED.risks,
    complexity = EXCLUDED.complexity,
    requires_certification = EXCLUDED.requires_certification,
    requires_technical_certificate = EXCLUDED.requires_technical_certificate,
    me_epp_exclusive = EXCLUDED.me_epp_exclusive,
    me_epp_preference = EXCLUDED.me_epp_preference,
    delivery_location = EXCLUDED.delivery_location,
    delivery_deadline_days = EXCLUDED.delivery_deadline_days,
    data = EXCLUDED.data,
    enriched_at = now(),
    updated_at = now()
"""

_DELETE_CATEGORIES_SQL = "DELETE FROM procurement_categories WHERE procurement_id = %(id)s"
_INSERT_CATEGORY_SQL = """
INSERT INTO procurement_categories (procurement_id, category)
VALUES (%(procurement_id)s, %(category)s)
ON CONFLICT DO NOTHING
"""

_DELETE_REQUIREMENTS_SQL = "DELETE FROM procurement_requirements WHERE procurement_id = %(id)s"
_INSERT_REQUIREMENT_SQL = """
INSERT INTO procurement_requirements (procurement_id, sequence, kind, description)
VALUES (%(procurement_id)s, %(sequence)s, %(kind)s, %(description)s)
"""

# Ingest CNAEs (origin='ingest', from `lixto classify run`) are owned by the
# classifier and never deleted by deep analysis. The dossier's CNAEs (origin=
# 'enrichment') are replaced: a shared code gets confidence upgraded, and new
# codes are added; ingest rows with the same code are left in place.
_DELETE_CNAES_SQL = (
    "DELETE FROM procurement_cnaes WHERE procurement_id = %(id)s AND origin = 'enrichment'"
)
_INSERT_CNAE_SQL = """
INSERT INTO procurement_cnaes (procurement_id, cnae_code, confidence, origin)
VALUES (%(procurement_id)s, %(cnae_code)s, %(confidence)s, 'enrichment')
ON CONFLICT (procurement_id, cnae_code) DO UPDATE SET confidence = EXCLUDED.confidence, origin = 'enrichment'
"""

_UPSERT_EMBEDDING_SQL = """
INSERT INTO procurement_embeddings (procurement_id, model, embedding, embedded_at)
VALUES (%(procurement_id)s, %(model)s, %(embedding)s::vector, now())
ON CONFLICT (procurement_id) DO UPDATE
SET model = EXCLUDED.model,
    embedding = EXCLUDED.embedding,
    embedded_at = now()
"""

# Re-analysis rewrites the canonical text, so any previous vector is stale:
# drop it when no new one was produced, which puts the row back in
# `lixto enrich embed`'s queue.
_DELETE_EMBEDDING_SQL = "DELETE FROM procurement_embeddings WHERE procurement_id = %(id)s"

# `version` counts how many times this procurement was analysed; the web app
# shows it and ticket 133 re-runs on a changed document set hash.
_UPSERT_ANALYSIS_SQL = """
INSERT INTO tender_analyses (
    procurement_id, version, status, error, model, schema_version, document_set_hash,
    input_kind, input_chars, input_truncated,
    executive_summary, object_text, overall_risk, data, analyzed_at, created_at, updated_at
) VALUES (
    %(procurement_id)s, 1, %(status)s, %(error)s, %(model)s, %(schema_version)s,
    %(document_set_hash)s, %(input_kind)s, %(input_chars)s, %(input_truncated)s,
    %(executive_summary)s, %(object_text)s, %(overall_risk)s, %(data)s, now(), now(), now()
)
ON CONFLICT (procurement_id) DO UPDATE
SET version = tender_analyses.version + 1,
    status = EXCLUDED.status,
    error = EXCLUDED.error,
    model = EXCLUDED.model,
    schema_version = EXCLUDED.schema_version,
    document_set_hash = EXCLUDED.document_set_hash,
    input_kind = EXCLUDED.input_kind,
    input_chars = EXCLUDED.input_chars,
    input_truncated = EXCLUDED.input_truncated,
    executive_summary = EXCLUDED.executive_summary,
    object_text = EXCLUDED.object_text,
    overall_risk = EXCLUDED.overall_risk,
    data = EXCLUDED.data,
    analyzed_at = now(),
    updated_at = now()
"""

_DELETE_FACTS_SQL = "DELETE FROM tender_analysis_facts WHERE procurement_id = %(id)s"
_INSERT_FACT_SQL = """
INSERT INTO tender_analysis_facts (
    procurement_id, "group", key, label, value, statement_kind, confidence, citations
) VALUES (
    %(procurement_id)s, %(group)s, %(key)s, %(label)s, %(value)s,
    %(statement_kind)s, %(confidence)s, %(citations)s
)
"""

_DELETE_DATES_SQL = "DELETE FROM tender_analysis_dates WHERE procurement_id = %(id)s"
_INSERT_DATE_SQL = """
INSERT INTO tender_analysis_dates (
    procurement_id, sequence, kind, label, occurs_at, raw_text, confidence, citations
) VALUES (
    %(procurement_id)s, %(sequence)s, %(kind)s, %(label)s, %(occurs_at)s,
    %(raw_text)s, %(confidence)s, %(citations)s
)
"""

_DELETE_ANALYSIS_REQUIREMENTS_SQL = (
    "DELETE FROM tender_analysis_requirements WHERE procurement_id = %(id)s"
)
_INSERT_ANALYSIS_REQUIREMENT_SQL = """
INSERT INTO tender_analysis_requirements (
    procurement_id, sequence, category, title, description, mandatory, severity,
    statement_kind, confidence, citations
) VALUES (
    %(procurement_id)s, %(sequence)s, %(category)s, %(title)s, %(description)s,
    %(mandatory)s, %(severity)s, %(statement_kind)s, %(confidence)s, %(citations)s
)
"""

_DELETE_PENALTIES_SQL = "DELETE FROM tender_analysis_penalties WHERE procurement_id = %(id)s"
_INSERT_PENALTY_SQL = """
INSERT INTO tender_analysis_penalties (
    procurement_id, sequence, description, basis, confidence, citations
) VALUES (
    %(procurement_id)s, %(sequence)s, %(description)s, %(basis)s, %(confidence)s, %(citations)s
)
"""

_DELETE_RISKS_SQL = "DELETE FROM tender_analysis_risks WHERE procurement_id = %(id)s"
_INSERT_RISK_SQL = """
INSERT INTO tender_analysis_risks (
    procurement_id, sequence, kind, severity, title, description, recommendation, citations
) VALUES (
    %(procurement_id)s, %(sequence)s, %(kind)s, %(severity)s, %(title)s,
    %(description)s, %(recommendation)s, %(citations)s
)
"""

_DELETE_MISSING_SQL = "DELETE FROM tender_analysis_missing WHERE procurement_id = %(id)s"
_INSERT_MISSING_SQL = """
INSERT INTO tender_analysis_missing (procurement_id, sequence, field, note)
VALUES (%(procurement_id)s, %(sequence)s, %(field)s, %(note)s)
"""

# All statuses count against the cap — a row that errored still cost tokens.
_USED_TODAY_SQL = (
    "SELECT count(*) FROM tender_analyses WHERE analyzed_at >= date_trunc('day', now())"
)


def _json_default(value: Any) -> str:
    """`json.dumps` fallback: the only non-primitive the payload carries is
    the parsed `occurs_at` datetime, which belongs in JSONB as ISO-8601."""
    isoformat = getattr(value, "isoformat", None)
    if callable(isoformat):
        return isoformat()
    raise TypeError(f"{type(value).__name__} is not JSON serializable")


def to_json(value: Any) -> str:
    return json.dumps(value, default=_json_default)


def _daily_cap() -> int:
    """`LIXTO_ENRICH_DAILY_CAP` rows/day across all `analyze run`
    invocations; 0 or unset means unlimited."""
    raw = os.environ.get(LIXTO_ENRICH_DAILY_CAP, "0")
    try:
        return int(raw)
    except ValueError:
        return 0


def _max_chars() -> int:
    """`LIXTO_ANALYZE_MAX_CHARS` — how much document text one prompt may
    carry; anything beyond it is reported as truncated."""
    raw = os.environ.get(LIXTO_ANALYZE_MAX_CHARS)
    if not raw:
        return DEFAULT_MAX_CHARS
    try:
        return int(raw)
    except ValueError:
        return DEFAULT_MAX_CHARS


def _pending_sql(fence: Fence) -> str:
    """`_SELECT_PENDING_SQL` with the fence predicate spliced in before
    `ORDER BY`; unchanged when the fence is inactive."""
    fragment, _ = fence.sql("p")
    if not fragment:
        return _SELECT_PENDING_SQL
    return _SELECT_PENDING_SQL.replace("\nORDER BY", fragment + "\nORDER BY", 1)


def document_set_hash(conn: psycopg.Connection, procurement_id: int) -> str | None:
    """md5 over the active document set (sequence, publication instant, url).
    Stored on the analysis so a later run can tell whether the package the
    dossier was built from still stands."""
    with conn.cursor() as cur:
        cur.execute(DOCUMENT_SET_HASH_SQL, {"procurement_id": procurement_id})
        row = cur.fetchone()
    return row[0] if row else None


def fetch_items(conn: psycopg.Connection, procurement_id: int) -> list[dict[str, Any]]:
    with conn.cursor(row_factory=psycopg.rows.dict_row) as cur:
        cur.execute(_SELECT_ITEMS_SQL, {"procurement_id": procurement_id, "max_items": MAX_ITEMS})
        return cur.fetchall()


def fetch_benefit_ids(conn: psycopg.Connection, procurement_id: int) -> list[int | None]:
    """`benefit_type_id` of every item on the procurement (no cap), the input
    to `derive_me_epp`."""
    with conn.cursor() as cur:
        cur.execute(_SELECT_BENEFITS_SQL, {"procurement_id": procurement_id})
        return [row[0] for row in cur.fetchall()]


def derive_me_epp(benefit_ids: list[int | None]) -> tuple[bool | None, bool | None]:
    """`(me_epp_exclusive, me_epp_preference)` from PNCP `tipoBeneficioId`
    per item (1 = participação exclusiva, 2 = subcontratação, 3 = cota
    reservada, 4 = sem benefício, 5 = não se aplica):

    - no items, or every id is null -> (None, None): nothing to derive from.
    - every non-null id == 1 -> (True, False): whole procurement is exclusive.
    - otherwise -> (False, preference), where preference is True when any
      item carries id 1, 2 or 3 — a benefit exists somewhere, just not on
      every item, so it reads as a preference rather than exclusivity.
    """
    ids = [b for b in benefit_ids if b is not None]
    if not ids:
        return None, None
    if all(b == 1 for b in ids):
        return True, False
    return False, any(b in (1, 2, 3) for b in ids)


def _collect_pdfs(
    procurement_id: int,
    docs: list[dict[str, Any]],
    http_client: httpx.Client,
) -> list[dict[str, Any]] | None:
    """PDF bytes for the docs pypdf couldn't read, reusing the freshly
    downloaded bytes when the extractor still has them and re-downloading
    from the document's own `url` otherwise. Returns None when nothing is
    usable or the cap (MAX_PDFS / MAX_PDF_BYTES) is exceeded — the caller
    then falls back to the structured route."""
    candidates = [d for d in docs if d.get("method") == "insufficient"]
    if not candidates:
        return None
    if len(candidates) > MAX_PDFS:
        logger.info("%s has %d insufficient docs, over cap", procurement_id, len(candidates))
        return None

    pdfs: list[dict[str, Any]] = []
    total = 0
    for doc in candidates:
        seq = doc.get("sequence")
        content = doc.get("pdf_bytes")
        if content is None:
            url = doc.get("url")
            if not url:
                continue
            resp = http_client.get(url, timeout=DOWNLOAD_TIMEOUT, follow_redirects=True)
            resp.raise_for_status()
            content = resp.content
        total += len(content)
        if total > MAX_PDF_BYTES:
            logger.info("%s PDFs exceed %d bytes, over cap", procurement_id, MAX_PDF_BYTES)
            return None
        pdfs.append({"filename": f"documento-{seq}.pdf", "content": content})

    return pdfs or None


def _persist(
    conn: psycopg.Connection,
    procurement_id: int,
    *,
    status: str,
    input_kind: str,
    model: str | None,
    error: str | None,
    payload: dict[str, Any] | None,
    me_epp: tuple[bool | None, bool | None] = (None, None),
    embedding: str | None = None,
    embedding_model: str | None = None,
    document_set_hash: str | None = None,
    input_chars: int = 0,
    input_truncated: bool = False,
) -> None:
    """Writes the enrichment row, its four facet tables, the analysis row and
    its six child tables in one transaction, so readers never see half a
    dossier. `me_epp` — from `derive_me_epp(fetch_benefit_ids(...))` — is
    written regardless of what the payload says, since those two flags are
    Tier-0 (deterministic from `procurement_items.benefit_type_id`)."""
    payload = payload or {}
    delivery = payload.get("delivery") or {}
    me_epp_exclusive, me_epp_preference = me_epp
    enrichment_params = {
        "procurement_id": procurement_id,
        "schema_version": SCHEMA_VERSION,
        "model": model,
        "confidence": payload.get("confidence"),
        "status": status,
        "error": error,
        "input_kind": input_kind,
        "summary": payload.get("summary"),
        "concepts": payload.get("concepts") or [],
        "keywords": payload.get("keywords") or [],
        # Facet lists derived from the dossier (see analyze.schema): the
        # `risks`/`requirements` keys themselves hold the rich cited shapes.
        "risks": payload.get("facet_risks") or [],
        "complexity": payload.get("complexity"),
        "requires_certification": payload.get("requires_certification"),
        "requires_technical_certificate": payload.get("requires_technical_certificate"),
        "me_epp_exclusive": me_epp_exclusive,
        "me_epp_preference": me_epp_preference,
        "delivery_location": delivery.get("location"),
        "delivery_deadline_days": delivery.get("deadline_days"),
        "data": to_json(payload),
    }

    analysis_params = {
        "procurement_id": procurement_id,
        "status": status,
        "error": error,
        "model": model,
        "schema_version": SCHEMA_VERSION,
        "document_set_hash": document_set_hash,
        "input_kind": input_kind,
        "input_chars": input_chars,
        "input_truncated": input_truncated,
        "executive_summary": payload.get("executive_summary"),
        "object_text": payload.get("object"),
        "overall_risk": payload.get("overall_risk"),
        "data": to_json(payload),
    }

    with conn.cursor() as cur:
        cur.execute(_UPSERT_ENRICHMENT_SQL, enrichment_params)

        cur.execute(_DELETE_CATEGORIES_SQL, {"id": procurement_id})
        for category in payload.get("categories") or []:
            cur.execute(
                _INSERT_CATEGORY_SQL,
                {"procurement_id": procurement_id, "category": category},
            )

        cur.execute(_DELETE_REQUIREMENTS_SQL, {"id": procurement_id})
        for sequence, requirement in enumerate(payload.get("facet_requirements") or [], start=1):
            cur.execute(
                _INSERT_REQUIREMENT_SQL,
                {
                    "procurement_id": procurement_id,
                    "sequence": sequence,
                    "kind": requirement["kind"],
                    "description": requirement["description"],
                },
            )

        cur.execute(_DELETE_CNAES_SQL, {"id": procurement_id})
        for cnae in payload.get("cnae_candidates") or []:
            cur.execute(
                _INSERT_CNAE_SQL,
                {
                    "procurement_id": procurement_id,
                    "cnae_code": cnae["code"],
                    "confidence": cnae["confidence"],
                },
            )

        if embedding:
            cur.execute(
                _UPSERT_EMBEDDING_SQL,
                {
                    "procurement_id": procurement_id,
                    "model": embedding_model,
                    "embedding": embedding,
                },
            )
        else:
            cur.execute(_DELETE_EMBEDDING_SQL, {"id": procurement_id})

        # The dossier: parent first (the children reference it), then a full
        # replace of each child list.
        cur.execute(_UPSERT_ANALYSIS_SQL, analysis_params)
        _persist_dossier(cur, procurement_id, payload)
    conn.commit()


def _persist_dossier(cur: psycopg.Cursor, procurement_id: int, payload: dict[str, Any]) -> None:
    """Replaces the six child lists of one analysis. `sequence` is the 1-based
    index in the payload list, which is also the display order."""
    cur.execute(_DELETE_FACTS_SQL, {"id": procurement_id})
    for fact in payload.get("facts") or []:
        cur.execute(
            _INSERT_FACT_SQL,
            {
                "procurement_id": procurement_id,
                "group": fact["group"],
                "key": fact["key"],
                "label": fact["label"],
                "value": fact["value"],
                "statement_kind": fact["statement_kind"],
                "confidence": fact["confidence"],
                "citations": to_json(fact["citations"]),
            },
        )

    cur.execute(_DELETE_DATES_SQL, {"id": procurement_id})
    for sequence, date in enumerate(payload.get("dates") or [], start=1):
        cur.execute(
            _INSERT_DATE_SQL,
            {
                "procurement_id": procurement_id,
                "sequence": sequence,
                "kind": date["kind"],
                "label": date["label"],
                "occurs_at": date["occurs_at"],
                "raw_text": date["raw_text"],
                "confidence": date["confidence"],
                "citations": to_json(date["citations"]),
            },
        )

    cur.execute(_DELETE_ANALYSIS_REQUIREMENTS_SQL, {"id": procurement_id})
    for sequence, requirement in enumerate(payload.get("requirements") or [], start=1):
        cur.execute(
            _INSERT_ANALYSIS_REQUIREMENT_SQL,
            {
                "procurement_id": procurement_id,
                "sequence": sequence,
                "category": requirement["category"],
                "title": requirement["title"],
                "description": requirement["description"],
                "mandatory": requirement["mandatory"],
                "severity": requirement["severity"],
                "statement_kind": requirement["statement_kind"],
                "confidence": requirement["confidence"],
                "citations": to_json(requirement["citations"]),
            },
        )

    cur.execute(_DELETE_PENALTIES_SQL, {"id": procurement_id})
    for sequence, penalty in enumerate(payload.get("penalties") or [], start=1):
        cur.execute(
            _INSERT_PENALTY_SQL,
            {
                "procurement_id": procurement_id,
                "sequence": sequence,
                "description": penalty["description"],
                "basis": penalty["basis"],
                "confidence": penalty["confidence"],
                "citations": to_json(penalty["citations"]),
            },
        )

    cur.execute(_DELETE_RISKS_SQL, {"id": procurement_id})
    for sequence, risk in enumerate(payload.get("risks") or [], start=1):
        cur.execute(
            _INSERT_RISK_SQL,
            {
                "procurement_id": procurement_id,
                "sequence": sequence,
                "kind": risk["kind"],
                "severity": risk["severity"],
                "title": risk["title"],
                "description": risk["description"],
                "recommendation": risk["recommendation"],
                "citations": to_json(risk["citations"]),
            },
        )

    cur.execute(_DELETE_MISSING_SQL, {"id": procurement_id})
    for sequence, missing in enumerate(payload.get("missing") or [], start=1):
        cur.execute(
            _INSERT_MISSING_SQL,
            {
                "procurement_id": procurement_id,
                "sequence": sequence,
                "field": missing["field"],
                "note": missing["note"],
            },
        )


def _embed_payload(
    llm: LlmClient, procurement_id: int, payload: dict[str, Any]
) -> tuple[str | None, str | None]:
    """Vector of the payload's canonical text, or (None, None) when the embed
    call fails. An embedding is a nice-to-have here: never let it cost us the
    analysis itself — `lixto enrich embed` backfills whatever is missing."""
    text = build_embedding_text(payload)
    if not text:
        return None, None
    try:
        vectors, embed_model = llm.embed([text])
    except Exception:
        logger.exception("embedding failed for %s; persisting without vector", procurement_id)
        return None, None
    if not vectors:
        return None, None
    return to_pgvector(vectors[0]), embed_model


def _doc_pages(docs: list[dict[str, Any]]) -> dict[int, int]:
    """`{sequence: page_count}` for the documents whose text was actually fed
    to the model — the allowlist every citation is checked against."""
    pages: dict[int, int] = {}
    for doc in docs:
        page_texts = doc.get("page_texts")
        if not page_texts:
            continue
        sequence = doc.get("sequence")
        if not isinstance(sequence, int):
            continue
        pages[sequence] = doc.get("pages") or len(page_texts)
    return pages


def analyze_one(
    conn: psycopg.Connection,
    row: dict[str, Any],
    *,
    llm: LlmClient,
    http_client: httpx.Client,
) -> str:
    """Analyses a single procurement end-to-end and commits. Returns
    'done' | 'error'; never raises for per-row failures — those are persisted
    as status='error' so the row leaves the queue (rerun with --retry-errors
    to pick it back up)."""
    procurement_id = row["id"]
    input_kind = "structured"
    me_epp: tuple[bool | None, bool | None] = (None, None)
    doc_hash: str | None = None
    input_chars = 0
    truncated = False
    try:
        doc_hash = document_set_hash(conn, procurement_id)
        me_epp = derive_me_epp(fetch_benefit_ids(conn, procurement_id))
        docs = extract_for_procurement(conn, procurement_id, http_client)
        items = fetch_items(conn, procurement_id)
        prompt, input_chars, truncated = build_prompt(
            row, items, docs, me_epp=me_epp, max_chars=_max_chars()
        )
        doc_pages = _doc_pages(docs)

        pdfs: list[dict[str, Any]] | None = None
        if doc_pages:
            input_kind = "text"
        else:
            pdfs = _collect_pdfs(procurement_id, docs, http_client)
            if pdfs:
                input_kind = "pdf"

        if input_kind == "pdf" and pdfs:
            result, model = llm.complete_json_pdf(
                instructions=INSTRUCTIONS,
                prompt=prompt,
                pdfs=pdfs,
                schema=ANALYSIS_SCHEMA,
                name="tender_analysis",
            )
        else:
            result, model = llm.complete_json_text(
                tier="doc" if input_kind == "text" else "cheap",
                instructions=INSTRUCTIONS,
                prompt=prompt,
                schema=ANALYSIS_SCHEMA,
                name="tender_analysis",
            )

        payload = validate_analysis(result, doc_pages=doc_pages)
        if payload is None:
            _persist(
                conn,
                procurement_id,
                status="error",
                input_kind=input_kind,
                model=model,
                error="resposta inválida",
                payload=None,
                me_epp=me_epp,
                document_set_hash=doc_hash,
                input_chars=input_chars,
                input_truncated=truncated,
            )
            return "error"

        embedding, embedding_model = _embed_payload(llm, procurement_id, payload)
        _persist(
            conn,
            procurement_id,
            status="done",
            input_kind=input_kind,
            model=model,
            error=None,
            payload=payload,
            me_epp=me_epp,
            embedding=embedding,
            embedding_model=embedding_model,
            document_set_hash=doc_hash,
            input_chars=input_chars,
            input_truncated=truncated,
        )
        return "done"
    except Exception as exc:
        logger.exception("analysis failed for %s", procurement_id)
        try:
            # The failure may have aborted an open transaction; clear it
            # before writing the error row.
            conn.rollback()
            _persist(
                conn,
                procurement_id,
                status="error",
                input_kind=input_kind,
                model=None,
                error=str(exc)[:2000],
                payload=None,
                me_epp=me_epp,
                document_set_hash=doc_hash,
                input_chars=input_chars,
                input_truncated=truncated,
            )
        except Exception:
            logger.exception("failed to persist error status for %s", procurement_id)
            conn.rollback()
        return "error"


def _apply_usage(counters: RunCounters, llm: LlmClient) -> dict[str, Any]:
    """Folds `llm.usage_summary()` into `counters` and returns the run's
    final result dict (counters plus `est_usd`, a float — USD stays as
    integer micros in the persisted counters so they remain whole numbers)."""
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


def analyze(
    conn: psycopg.Connection,
    *,
    limit: int | None = None,
    days: int | None = None,
    retry_errors: bool = False,
    llm: LlmClient | None = None,
    http_client: httpx.Client | None = None,
    counters: RunCounters | None = None,
    fence: Fence | None = None,
) -> dict[str, Any]:
    """Analyses pending open procurements in the fence, one at a time,
    committing after each so the run is resumable, until the effective limit
    (min of `--limit` and what's left of the daily cap) is exhausted. Returns
    counters (processed, done, error, cap, used_today_at_start, cap_reached,
    llm_*) plus `est_usd`."""
    llm = llm or LlmClient()
    owns_http_client = http_client is None
    http_client = http_client or httpx.Client()
    fence = fence if fence is not None else get_fence()

    counters = counters if counters is not None else RunCounters()
    for key in ("processed", "done", "error"):
        counters[key] = counters.get(key)

    cap = _daily_cap()
    counters["cap"] = cap
    counters["cap_reached"] = 0

    try:
        used_today = 0
        if cap > 0:
            with conn.cursor() as cur:
                cur.execute(_USED_TODAY_SQL)
                used_today = cur.fetchone()[0]
        counters["used_today_at_start"] = used_today

        requested_limit = limit if limit is not None else BATCH_LIMIT_DEFAULT
        effective_limit = requested_limit
        cap_limited = False

        if cap > 0:
            remaining = cap - used_today
            if remaining <= 0:
                counters["cap_reached"] = 1
                logger.info(
                    "daily cap %d reached (%d analysed today); nothing to do",
                    cap,
                    used_today,
                )
                return _apply_usage(counters, llm)
            effective_limit = min(requested_limit, remaining)
            cap_limited = effective_limit < requested_limit

        sql = _pending_sql(fence)
        _, fence_params = fence.sql("p")
        with conn.cursor(row_factory=psycopg.rows.dict_row) as cur:
            cur.execute(
                sql,
                {
                    "limit": effective_limit,
                    "days": days,
                    "retry_errors": retry_errors,
                    **fence_params,
                },
            )
            rows = cur.fetchall()

        if cap_limited and len(rows) >= effective_limit:
            counters["cap_reached"] = 1

        for row in rows:
            status = analyze_one(conn, row, llm=llm, http_client=http_client)
            counters.inc("processed")
            counters.inc(status)
            logger.info(
                "analysed %s -> %s (%d/%d)",
                row.get("source_id") or row["id"],
                status,
                counters["processed"],
                len(rows),
            )
    finally:
        if owns_http_client:
            http_client.close()

    return _apply_usage(counters, llm)
