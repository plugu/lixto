"""Deep edital-analysis agent (ticket 14).

For each fit/borderline licitação from triage (ticket 13), downloads up to 2
edital PDFs from the `documento` table's PNCP-hosted URLs and asks gpt-5.1 to
extract requirements/prazos/risks and refine the triage verdict, persisting
into `analise.deep_*` columns. Mirrors triage.py's select -> LLM -> update ->
commit shape, but processes one licitação per commit (PDFs make batching
impractical) so a crash mid-run only loses the in-flight row.
"""

from __future__ import annotations

import base64
import json
import logging
import os
from typing import Any

import httpx
import psycopg
from openai import OpenAI

from plic.agents.profile import load_profile

logger = logging.getLogger(__name__)

MODEL = os.environ.get("PLIC_ANALYSIS_MODEL", "gpt-5.1")

MAX_DOCS = 2
MAX_TOTAL_BYTES = 30 * 1024 * 1024  # 30 MB combined
DOWNLOAD_TIMEOUT = 60.0
CLIENT_TIMEOUT = 300.0

DEEP_VERDICTS = {"fit", "no_fit", "borderline"}

DEEP_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "deep_verdict": {"type": "string", "enum": ["fit", "no_fit", "borderline"]},
        "fit_score": {"type": "integer"},
        "reasoning": {"type": "string"},
        "requirements": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "tipo": {"type": "string"},
                    "descricao": {"type": "string"},
                    "atende": {"type": "string", "enum": ["sim", "nao", "incerto"]},
                },
                "required": ["tipo", "descricao", "atende"],
                "additionalProperties": False,
            },
        },
        "prazos": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "evento": {"type": "string"},
                    "data": {"type": "string"},
                },
                "required": ["evento", "data"],
                "additionalProperties": False,
            },
        },
        "risks": {"type": "array", "items": {"type": "string"}},
    },
    "required": ["deep_verdict", "fit_score", "reasoning", "requirements", "prazos", "risks"],
    "additionalProperties": False,
}

_SELECT_SQL = """
SELECT l.numero_controle_pncp,
       l.objeto_compra,
       l.modalidade_nome,
       l.setor,
       l.uf,
       l.municipio_nome,
       l.valor_total_estimado,
       l.data_encerramento_proposta,
       a.verdict AS triage_verdict,
       a.reasoning AS triage_reasoning
FROM analise a
JOIN licitacao l ON l.numero_controle_pncp = a.numero_controle_pncp
WHERE a.verdict IN ('fit', 'borderline')
  AND a.deep_status IS NULL
ORDER BY l.data_encerramento_proposta ASC NULLS LAST
LIMIT %(limit)s
"""

_SELECT_DOCS_SQL = """
SELECT sequencial_documento, titulo, tipo_documento_id, tipo_documento_nome, url
FROM documento
WHERE numero_controle_pncp = %(numero)s
  AND status_ativo IS TRUE
ORDER BY
    CASE WHEN tipo_documento_id = 2 THEN 0
         WHEN tipo_documento_nome ILIKE '%%edital%%' THEN 0
         WHEN titulo ILIKE '%%edital%%' THEN 0
         ELSE 1
    END,
    sequencial_documento ASC
"""

_SELECT_ITENS_SQL = """
SELECT descricao FROM item
WHERE numero_controle_pncp = %(numero)s
ORDER BY numero_item LIMIT 10
"""

_UPDATE_SQL = """
UPDATE analise
SET deep_verdict = %(deep_verdict)s,
    requirements = %(requirements)s,
    prazos = %(prazos)s,
    risks = %(risks)s,
    deep_model = %(model)s,
    deep_analyzed_at = now(),
    deep_status = %(deep_status)s,
    error = %(error)s,
    updated_at = now()
WHERE numero_controle_pncp = %(numero)s
"""


def _row_to_licitacao_summary(row: dict[str, Any], itens: list[str]) -> str:
    parts = [f"Objeto: {row.get('objeto_compra') or '(sem objeto)'}"]
    if row.get("modalidade_nome"):
        parts.append(f"Modalidade: {row['modalidade_nome']}")
    if row.get("setor"):
        parts.append(f"Setor: {row['setor']}")
    if row.get("uf"):
        parts.append(f"UF: {row['uf']}")
    if row.get("municipio_nome"):
        parts.append(f"Município: {row['municipio_nome']}")
    if row.get("valor_total_estimado") is not None:
        parts.append(f"Valor estimado: {row['valor_total_estimado']}")
    if row.get("data_encerramento_proposta"):
        parts.append(f"Encerramento das propostas: {row['data_encerramento_proposta']}")
    if itens:
        parts.append("Itens: " + "; ".join(itens))
    return "\n".join(parts)


def build_instructions(profile_text: str) -> str:
    return (
        "Você é um agente de análise profunda de editais de licitação. Você "
        "recebe o(s) PDF(s) do edital (quando disponíveis), o veredito e a "
        "justificativa da triagem inicial, e um resumo da licitação. Leia o "
        "edital e extraia: requisitos de habilitação/participação relevantes "
        "(com um julgamento se a empresa provavelmente atende), prazos-chave "
        "(datas de eventos como abertura, impugnação, esclarecimentos), e "
        "riscos (cláusulas restritivas, exigências incomuns, prazos "
        "apertados). Refine o veredito final (fit/no_fit/borderline) e um "
        "fit_score de 0 a 100 considerando o perfil da empresa abaixo. Se "
        "não houver PDF de edital disponível, baseie-se apenas no resumo da "
        "licitação e deixe requirements/prazos vazios se não houver base "
        "suficiente. Responda em português.\n\n"
        f"## Perfil da empresa\n\n{profile_text}"
    )


def build_context_text(
    row: dict[str, Any], itens: list[str], profile_instructions: str
) -> str:
    lines = [profile_instructions, ""]
    lines.append("## Triagem inicial")
    lines.append(f"Veredito: {row.get('triage_verdict')}")
    lines.append(f"Justificativa: {row.get('triage_reasoning')}")
    lines.append("")
    lines.append("## Resumo da licitação")
    lines.append(_row_to_licitacao_summary(row, itens))
    return "\n".join(lines)


def pick_documents(conn: psycopg.Connection, numero: str) -> list[dict[str, Any]]:
    with conn.cursor(row_factory=psycopg.rows.dict_row) as cur:
        cur.execute(_SELECT_DOCS_SQL, {"numero": numero})
        return cur.fetchall()


def fetch_itens(conn: psycopg.Connection, numero: str) -> list[str]:
    with conn.cursor() as cur:
        cur.execute(_SELECT_ITENS_SQL, {"numero": numero})
        return [r[0] for r in cur.fetchall() if r[0]]


def download_pdfs(
    docs: list[dict[str, Any]], http_client: httpx.Client
) -> tuple[list[dict[str, Any]], str | None]:
    """Downloads up to MAX_DOCS active documents as PDFs, following redirects.
    Skips non-PDF content-types. Returns (downloaded, skip_reason). If total
    size exceeds MAX_TOTAL_BYTES or nothing PDF-like was downloaded,
    `skip_reason` explains why (downloaded may still contain partial data,
    which callers should treat as unusable)."""
    downloaded: list[dict[str, Any]] = []
    total_bytes = 0
    attempted = 0
    for doc in docs:
        if len(downloaded) >= MAX_DOCS:
            break
        url = doc.get("url")
        if not url:
            continue
        attempted += 1
        try:
            resp = http_client.get(url, timeout=DOWNLOAD_TIMEOUT, follow_redirects=True)
            resp.raise_for_status()
        except Exception:
            logger.warning("failed to download document %s", url, exc_info=True)
            continue
        content_type = resp.headers.get("content-type", "")
        content = resp.content
        # PNCP (and other portal mirrors) frequently mislabel PDF downloads
        # as application/octet-stream, so content-type alone is unreliable;
        # fall back to sniffing the PDF magic bytes before giving up on it.
        is_pdf = "pdf" in content_type.lower() or content.lstrip()[:5] == b"%PDF-"
        if not is_pdf:
            logger.info("skipping non-PDF document %s (content-type=%s)", url, content_type)
            continue
        total_bytes += len(content)
        downloaded.append(
            {
                "filename": (doc.get("titulo") or f"documento-{doc.get('sequencial_documento')}")
                + ".pdf",
                "content": content,
            }
        )

    if total_bytes > MAX_TOTAL_BYTES:
        return [], f"combined PDF size {total_bytes} bytes exceeds {MAX_TOTAL_BYTES} byte limit"
    if not downloaded:
        reason = "no PDF documents downloadable" if attempted else "no active documents"
        return [], reason
    return downloaded, None


def build_input_content(
    pdfs: list[dict[str, Any]], context_text: str
) -> list[dict[str, Any]]:
    content: list[dict[str, Any]] = []
    for pdf in pdfs:
        b64 = base64.b64encode(pdf["content"]).decode("ascii")
        content.append(
            {
                "type": "input_file",
                "filename": pdf["filename"],
                "file_data": f"data:application/pdf;base64,{b64}",
            }
        )
    content.append({"type": "input_text", "text": context_text})
    return content


def parse_response(response: Any) -> dict[str, Any] | None:
    """Returns the parsed deep-analysis payload, or None if the response was
    refused or empty (caller should mark deep_status='error')."""
    for item in getattr(response, "output", None) or []:
        if getattr(item, "type", None) == "message":
            for block in getattr(item, "content", None) or []:
                if getattr(block, "type", None) == "refusal":
                    return None
        if getattr(item, "type", None) == "refusal":
            return None

    output_text = getattr(response, "output_text", None)
    if not output_text:
        return None
    try:
        payload = json.loads(output_text)
    except json.JSONDecodeError:
        return None
    if not isinstance(payload, dict):
        return None
    if payload.get("deep_verdict") not in DEEP_VERDICTS:
        return None
    return payload


def analyze_one(
    conn: psycopg.Connection,
    row: dict[str, Any],
    *,
    client: OpenAI,
    http_client: httpx.Client,
    model: str,
    profile_instructions: str,
) -> str:
    """Processes a single licitação row end-to-end, persisting the result
    and committing. Returns the resulting deep_status. Never raises for
    per-row failures — those are caught and persisted as deep_status='error'."""
    numero = row["numero_controle_pncp"]
    try:
        docs = pick_documents(conn, numero)
        itens = fetch_itens(conn, numero)

        pdfs: list[dict[str, Any]] = []
        skip_reason: str | None = None
        if docs:
            pdfs, skip_reason = download_pdfs(docs, http_client)
        else:
            skip_reason = "no active documents"

        context_text = build_context_text(row, itens, profile_instructions)
        content = build_input_content(pdfs, context_text)

        response = client.responses.create(
            model=model,
            input=[{"role": "user", "content": content}],
            text={
                "format": {
                    "type": "json_schema",
                    "name": "deep_analysis",
                    "strict": True,
                    "schema": DEEP_SCHEMA,
                }
            },
        )

        payload = parse_response(response)
        if payload is None:
            _update(
                conn,
                numero,
                deep_verdict=None,
                requirements=None,
                prazos=None,
                risks=None,
                model=model,
                deep_status="error",
                error="empty or refused model response",
            )
            return "error"

        deep_status = "skipped" if skip_reason and not pdfs else "done"
        error_note = skip_reason if deep_status == "skipped" else None

        _update(
            conn,
            numero,
            deep_verdict=payload["deep_verdict"],
            requirements=payload.get("requirements") or [],
            prazos=payload.get("prazos") or [],
            risks=payload.get("risks") or [],
            model=model,
            deep_status=deep_status,
            error=error_note,
        )
        return deep_status
    except Exception as exc:
        logger.exception("deep analysis failed for %s", numero)
        try:
            _update(
                conn,
                numero,
                deep_verdict=None,
                requirements=None,
                prazos=None,
                risks=None,
                model=model,
                deep_status="error",
                error=str(exc)[:2000],
            )
        except Exception:
            logger.exception("failed to persist error status for %s", numero)
            conn.rollback()
        return "error"


def _update(
    conn: psycopg.Connection,
    numero: str,
    *,
    deep_verdict: str | None,
    requirements: list | None,
    prazos: list | None,
    risks: list | None,
    model: str,
    deep_status: str,
    error: str | None,
) -> None:
    with conn.cursor() as cur:
        cur.execute(
            _UPDATE_SQL,
            {
                "numero": numero,
                "deep_verdict": deep_verdict,
                "requirements": json.dumps(requirements) if requirements is not None else None,
                "prazos": json.dumps(prazos) if prazos is not None else None,
                "risks": json.dumps(risks) if risks is not None else None,
                "model": model,
                "deep_status": deep_status,
                "error": error,
            },
        )
    conn.commit()


def deep_analyze(
    conn: psycopg.Connection,
    *,
    limit: int | None = None,
    client: OpenAI | None = None,
    http_client: httpx.Client | None = None,
    model: str | None = None,
    profile_text: str | None = None,
) -> dict[str, int]:
    """Deep-analyzes pending fit/borderline licitações one at a time,
    committing after each so the run is resumable. Returns counters."""
    client = client or OpenAI(timeout=CLIENT_TIMEOUT)
    model = model or MODEL
    owns_http_client = http_client is None
    http_client = http_client or httpx.Client()
    profile_instructions = build_instructions(profile_text or load_profile())

    counters = {"processed": 0, "done": 0, "skipped": 0, "error": 0}
    try:
        with conn.cursor(row_factory=psycopg.rows.dict_row) as cur:
            # LIMIT NULL in Postgres means "no limit", so passing limit=None
            # through as-is is fine.
            cur.execute(_SELECT_SQL, {"limit": limit})
            rows = cur.fetchall()

        for row in rows:
            status = analyze_one(
                conn,
                row,
                client=client,
                http_client=http_client,
                model=model,
                profile_instructions=profile_instructions,
            )
            counters["processed"] += 1
            counters[status] = counters.get(status, 0) + 1
            logger.info(
                "deep-analyzed %s -> %s (%d/%d)",
                row["numero_controle_pncp"],
                status,
                counters["processed"],
                len(rows),
            )
    finally:
        if owns_http_client:
            http_client.close()

    return counters
