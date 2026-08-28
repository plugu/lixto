"""Global enrichment worker.

Produces one canonical enrichment per pending open procurement — once,
globally, reused by every company. Select → per-row LLM → persist → commit
per row, so a crash only loses the in-flight procurement, and each row is
routed to the cheapest tier that can actually answer:

- edital text extracted by pypdf  → `input_kind='text'`, cheap tier on the text;
- only scanned/insufficient PDFs  → `input_kind='pdf'`, doc tier with the PDFs;
- no usable document at all       → `input_kind='structured'`, cheap tier on the
  structured metadata alone.

One transaction per procurement writes `procurement_enrichments` plus the
facet tables (`procurement_categories`, `procurement_requirements`,
`procurement_cnaes`, `procurement_embeddings`), so a reader never sees an
enrichment whose facets are half-written.
"""

from __future__ import annotations

import json
import logging
import os
from typing import Any

import httpx
import psycopg

from lixto.enrich.documents import DOWNLOAD_TIMEOUT, extract_for_procurement, pick_documents
from lixto.enrich.embed import build_embedding_text, to_pgvector
from lixto.enrich.schema import ENRICHMENT_SCHEMA, SCHEMA_VERSION, validate_payload
from lixto.fence import Fence, get_fence
from lixto.llm import LlmClient
from lixto.runs import RunCounters

logger = logging.getLogger(__name__)

BATCH_LIMIT_DEFAULT = 200

# Rows/day across every `enrich run` invocation; 0 or unset means unlimited.
LIXTO_ENRICH_DAILY_CAP = "LIXTO_ENRICH_DAILY_CAP"
MAX_ITEMS = 40
ITEM_CHARS = 160
DESCRIPTION_CHARS = 2000
CONTEXT_TEXT_CHARS = 60_000

MAX_PDFS = 2
MAX_PDF_BYTES = 30 * 1024 * 1024  # 30 MB combined

INSTRUCTIONS = """Você é um analista de licitações públicas brasileiras. \
Extraia do edital e dos dados estruturados uma representação canônica da \
licitação. Essa representação é global: ela será reutilizada por todas as \
empresas, então nunca avalie o encaixe de uma empresa específica nem invente \
informação que não esteja no material recebido.

Os nomes dos campos e os valores de enumeração são em inglês (use exatamente \
os valores listados); o conteúdo textual é em português.

Campos:
- summary: 1 a 3 frases descrevendo objetivamente o que está sendo comprado.
- categories: categorias amplas de compra (ex.: "material escolar", \
"servicos de limpeza", "equipamentos de informatica").
- concepts: os conceitos/objetos centrais da compra, mais específicos que as \
categories (ex.: "lapis", "caderno", "toner").
- keywords: termos de busca, incluindo sinônimos e variações que compradores \
e fornecedores realmente usam (ex.: "lapis", "lapis preto", "lapis grafite", \
"material escolar").
- cnae_candidates: subclasses CNAE do IBGE no formato 0000-0/00 que um \
fornecedor deste objeto provavelmente possui, cada uma com code e confidence \
de 0 a 1.
- requirements: exigências de habilitação/participação, cada uma com kind \
(legal_qualification, tax_compliance, technical_qualification, \
economic_qualification, document, certification, sample, site_visit, other) e \
description curta em português.
- requires_certification: true se o edital exige certificação/registro \
específico do produto ou do fornecedor.
- requires_technical_certificate: true se exige atestado de capacidade técnica.
- me_epp_exclusive: true SOMENTE quando o edital diz que a participação é \
exclusiva de microempresas e empresas de pequeno porte (Lei 123/2006, \
art. 48, I). Cota reservada ou empate ficto não contam.
- me_epp_preference: true quando há benefício/preferência a ME/EPP sem \
exclusividade (cota de 25%, direito de preferência, empate ficto).
- delivery: location (local de entrega/execução) e deadline_days (prazo em \
dias). Use location "" e deadline_days -1 quando o edital não informar.
- risks: cláusulas restritivas, exigências incomuns, prazos apertados ou \
qualquer ponto de atenção para um fornecedor.
- complexity: low, medium ou high, considerando exigências, volume e prazo.
- confidence: 0 a 1, refletindo quanto da resposta veio do texto do edital em \
vez de suposição a partir dos metadados.

Regras de normalização: categories, concepts e keywords devem ser \
substantivos em português, minúsculos, SEM acentos, no singular quando fizer \
sentido, sem pontuação e sem nomes de órgãos, cidades ou números de processo."""

# `%(retry_errors)s` flips the pending predicate: normally any existing
# enrichment row excludes the procurement; with --retry-errors, rows whose
# last run failed become eligible again.
_SELECT_PENDING_SQL = """
SELECT p.id,
       p.source_id,
       p.description,
       p.additional_info,
       p.modality_name,
       p.state,
       p.city_name,
       p.estimated_value,
       p.proposal_closes_at,
       p.is_price_registry,
       a.name AS agency_name
FROM procurements p
JOIN agencies a ON a.tax_id = p.agency_tax_id
WHERE (p.proposal_closes_at >= now() OR p.proposal_opens_at > now())
  AND NOT EXISTS (
        SELECT 1 FROM procurement_enrichments e
        WHERE e.procurement_id = p.id
          AND (NOT %(retry_errors)s OR e.status <> 'error')
      )
  AND (%(days)s::int IS NULL
       OR p.published_at >= now() - make_interval(days => %(days)s))
ORDER BY p.proposal_closes_at ASC NULLS LAST
LIMIT %(limit)s
"""

_SELECT_ITEMS_SQL = """
SELECT description, quantity, unit, estimated_unit_price, kind
FROM procurement_items
WHERE procurement_id = %(procurement_id)s
ORDER BY item_number
LIMIT %(max_items)s
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

_DELETE_CNAES_SQL = "DELETE FROM procurement_cnaes WHERE procurement_id = %(id)s"
_INSERT_CNAE_SQL = """
INSERT INTO procurement_cnaes (procurement_id, cnae_code, confidence, origin)
VALUES (%(procurement_id)s, %(cnae_code)s, %(confidence)s, 'enrichment')
ON CONFLICT DO NOTHING
"""

_UPSERT_EMBEDDING_SQL = """
INSERT INTO procurement_embeddings (procurement_id, model, embedding, embedded_at)
VALUES (%(procurement_id)s, %(model)s, %(embedding)s::vector, now())
ON CONFLICT (procurement_id) DO UPDATE
SET model = EXCLUDED.model,
    embedding = EXCLUDED.embedding,
    embedded_at = now()
"""

# Re-enrichment rewrites the canonical text, so any previous vector is stale:
# drop it when no new one was produced, which puts the row back in
# `lixto enrich embed`'s queue.
_DELETE_EMBEDDING_SQL = "DELETE FROM procurement_embeddings WHERE procurement_id = %(id)s"

# All statuses count against the cap — a row that errored still cost tokens.
_USED_TODAY_SQL = (
    "SELECT count(*) FROM procurement_enrichments WHERE enriched_at >= date_trunc('day', now())"
)


def _daily_cap() -> int:
    """`LIXTO_ENRICH_DAILY_CAP` rows/day across all `enrich run` invocations;
    0 or unset means unlimited."""
    raw = os.environ.get(LIXTO_ENRICH_DAILY_CAP, "0")
    try:
        return int(raw)
    except ValueError:
        return 0


def _pending_sql(fence: Fence) -> str:
    """`_SELECT_PENDING_SQL` with the fence predicate spliced in before
    `ORDER BY`; unchanged when the fence is inactive."""
    fragment, _ = fence.sql("p")
    if not fragment:
        return _SELECT_PENDING_SQL
    return _SELECT_PENDING_SQL.replace("\nORDER BY", fragment + "\nORDER BY", 1)


def fetch_items(conn: psycopg.Connection, procurement_id: int) -> list[dict[str, Any]]:
    with conn.cursor(row_factory=psycopg.rows.dict_row) as cur:
        cur.execute(_SELECT_ITEMS_SQL, {"procurement_id": procurement_id, "max_items": MAX_ITEMS})
        return cur.fetchall()


def _format_item(index: int, item: dict[str, Any]) -> str:
    description = (item.get("description") or "(sem descrição)").strip()[:ITEM_CHARS]
    parts = [f"{index}. {description}"]
    quantity = item.get("quantity")
    unit = (item.get("unit") or "").strip()
    if quantity is not None or unit:
        parts.append(f"{quantity if quantity is not None else '?'} {unit}".strip())
    price = item.get("estimated_unit_price")
    if price is not None:
        parts.append(f"R$ {price}")
    return " — ".join(parts)


def build_prompt(
    row: dict[str, Any], items: list[dict[str, Any]], docs: list[dict[str, Any]]
) -> str:
    """Structured summary of the procurement plus, when available, the pypdf
    text of its edital documents capped at CONTEXT_TEXT_CHARS."""
    lines = ["## Dados estruturados", ""]
    lines.append(f"Objeto: {(row.get('description') or '(sem objeto)')[:DESCRIPTION_CHARS]}")
    if row.get("additional_info"):
        lines.append(f"Informação complementar: {row['additional_info'][:DESCRIPTION_CHARS]}")
    if row.get("modality_name"):
        lines.append(f"Modalidade: {row['modality_name']}")
    if row.get("agency_name"):
        lines.append(f"Órgão: {row['agency_name']}")
    location = " / ".join(str(x) for x in (row.get("state"), row.get("city_name")) if x)
    if location:
        lines.append(f"Local: {location}")
    if row.get("estimated_value") is not None:
        lines.append(f"Valor total estimado: {row['estimated_value']}")
    if row.get("is_price_registry") is not None:
        lines.append(f"SRP (registro de preços): {'sim' if row['is_price_registry'] else 'não'}")
    if row.get("proposal_closes_at"):
        lines.append(f"Encerramento das propostas: {row['proposal_closes_at']}")

    if items:
        lines.append("")
        lines.append("## Itens")
        for i, item in enumerate(items[:MAX_ITEMS], start=1):
            lines.append(_format_item(i, item))

    texts = [d.get("text") for d in docs if d.get("method") == "pypdf" and d.get("text")]
    if texts:
        lines.append("")
        lines.append("## Texto do edital")
        lines.append("\n\n".join(texts)[:CONTEXT_TEXT_CHARS])

    return "\n".join(lines)


def _collect_pdfs(
    conn: psycopg.Connection,
    procurement_id: int,
    docs: list[dict[str, Any]],
    http_client: httpx.Client,
) -> list[dict[str, Any]] | None:
    """PDF bytes for the docs pypdf couldn't read, reusing the freshly
    downloaded bytes when the extractor still has them. Returns None when
    nothing is usable or the cap (MAX_PDFS / MAX_PDF_BYTES) is exceeded — the
    caller then falls back to the structured route."""
    candidates = [d for d in docs if d.get("method") == "insufficient"]
    if not candidates:
        return None
    if len(candidates) > MAX_PDFS:
        logger.info("%s has %d insufficient docs, over cap", procurement_id, len(candidates))
        return None

    urls = {d.get("sequence"): d.get("url") for d in pick_documents(conn, procurement_id)}

    pdfs: list[dict[str, Any]] = []
    total = 0
    for doc in candidates:
        seq = doc.get("sequence")
        content = doc.get("pdf_bytes")
        if content is None:
            url = urls.get(seq)
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
    embedding: str | None = None,
    embedding_model: str | None = None,
) -> None:
    """Writes the enrichment row and its four facet tables in one
    transaction, so readers never see half an enrichment."""
    payload = payload or {}
    delivery = payload.get("delivery") or {}
    params = {
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
        "risks": payload.get("risks") or [],
        "complexity": payload.get("complexity"),
        "requires_certification": payload.get("requires_certification"),
        "requires_technical_certificate": payload.get("requires_technical_certificate"),
        "me_epp_exclusive": payload.get("me_epp_exclusive"),
        "me_epp_preference": payload.get("me_epp_preference"),
        "delivery_location": delivery.get("location"),
        "delivery_deadline_days": delivery.get("deadline_days"),
        "data": json.dumps(payload),
    }

    with conn.cursor() as cur:
        cur.execute(_UPSERT_ENRICHMENT_SQL, params)

        cur.execute(_DELETE_CATEGORIES_SQL, {"id": procurement_id})
        for category in payload.get("categories") or []:
            cur.execute(
                _INSERT_CATEGORY_SQL,
                {"procurement_id": procurement_id, "category": category},
            )

        cur.execute(_DELETE_REQUIREMENTS_SQL, {"id": procurement_id})
        for sequence, requirement in enumerate(payload.get("requirements") or [], start=1):
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
    conn.commit()


def _embed_payload(
    llm: LlmClient, procurement_id: int, payload: dict[str, Any]
) -> tuple[str | None, str | None]:
    """Vector of the payload's canonical text, or (None, None) when the embed
    call fails. An embedding is a nice-to-have here: never let it cost us the
    enrichment itself — `lixto enrich embed` backfills whatever is missing."""
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


def enrich_one(
    conn: psycopg.Connection,
    row: dict[str, Any],
    *,
    llm: LlmClient,
    http_client: httpx.Client,
) -> str:
    """Enriches a single procurement end-to-end and commits. Returns
    'done' | 'error'; never raises for per-row failures — those are persisted
    as status='error' so the row leaves the queue (rerun with --retry-errors
    to pick it back up)."""
    procurement_id = row["id"]
    input_kind = "structured"
    try:
        docs = extract_for_procurement(conn, procurement_id, http_client)
        items = fetch_items(conn, procurement_id)
        prompt = build_prompt(row, items, docs)

        pdfs: list[dict[str, Any]] | None = None
        if any(d.get("method") == "pypdf" for d in docs):
            input_kind = "text"
        else:
            pdfs = _collect_pdfs(conn, procurement_id, docs, http_client)
            if pdfs:
                input_kind = "pdf"

        if input_kind == "pdf" and pdfs:
            result, model = llm.complete_json_pdf(
                instructions=INSTRUCTIONS,
                prompt=prompt,
                pdfs=pdfs,
                schema=ENRICHMENT_SCHEMA,
                name="enrichment",
            )
        else:
            result, model = llm.complete_json_text(
                tier="cheap",
                instructions=INSTRUCTIONS,
                prompt=prompt,
                schema=ENRICHMENT_SCHEMA,
                name="enrichment",
            )

        payload = validate_payload(result)
        if payload is None:
            _persist(
                conn,
                procurement_id,
                status="error",
                input_kind=input_kind,
                model=model,
                error="resposta inválida",
                payload=None,
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
            embedding=embedding,
            embedding_model=embedding_model,
        )
        return "done"
    except Exception as exc:
        logger.exception("enrichment failed for %s", procurement_id)
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


def enrich(
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
    """Enriches pending open procurements in the fence, one at a time,
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
                    "daily cap %d reached (%d enriched today); nothing to do",
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
            status = enrich_one(conn, row, llm=llm, http_client=http_client)
            counters.inc("processed")
            counters.inc(status)
            logger.info(
                "enriched %s -> %s (%d/%d)",
                row.get("source_id") or row["id"],
                status,
                counters["processed"],
                len(rows),
            )
    finally:
        if owns_http_client:
            http_client.close()

    return _apply_usage(counters, llm)
