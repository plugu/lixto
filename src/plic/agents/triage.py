"""Fit-triage agent (ticket 13).

For each new top-7-portal licitação (aberta/futura, no `analise` row yet),
asks gpt-5-mini whether it fits `company_profile.md` and persists a
fit_score/verdict/reasoning row. Mirrors classify.py's batch-select ->
LLM -> update -> commit shape so it's resumable and idempotent.
"""

from __future__ import annotations

import json
import logging
import os
from typing import Any

import psycopg
from openai import OpenAI

from plic.agents.profile import load_profile

logger = logging.getLogger(__name__)

MODEL = os.environ.get("PLIC_TRIAGE_MODEL", "gpt-5-mini")

# Top-7 portal allowlist (ticket 10), duplicated from web/lib/portais.ts
# PORTAIS_ATIVOS — keep both lists in sync if the allowlist ever changes.
PORTAIS_ATIVOS = [
    "Compras.gov.br",
    "ECustomize Consultoria em Software S.A",
    "IPM Sistemas",
    "Betha Sistemas",
    "Governançabrasil Tecnologia e Gestão em Serviços",
    "BLL Compras",
    "Megasoft Informática",
]

VERDICTS = {"fit", "no_fit", "borderline"}

BATCH_SIZE = 10
MAX_ITENS = 10
OBJETO_CHARS = 600
ITEM_CHARS = 100

TRIAGE_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "results": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "n": {"type": "integer"},
                    "fit_score": {"type": "integer"},
                    "verdict": {"type": "string", "enum": ["fit", "no_fit", "borderline"]},
                    "reasoning": {"type": "string"},
                },
                "required": ["n", "fit_score", "verdict", "reasoning"],
                "additionalProperties": False,
            },
        },
    },
    "required": ["results"],
    "additionalProperties": False,
}

_SELECT_BATCH_SQL = f"""
SELECT l.numero_controle_pncp,
       left(l.objeto_compra, {OBJETO_CHARS}) AS objeto,
       l.modalidade_nome,
       l.setor,
       l.uf,
       l.municipio_nome,
       l.valor_total_estimado,
       (SELECT string_agg(left(i.descricao, {ITEM_CHARS}), '; ')
        FROM (SELECT descricao FROM item
              WHERE numero_controle_pncp = l.numero_controle_pncp
              ORDER BY numero_item LIMIT {MAX_ITENS}) i) AS itens
FROM licitacao l
WHERE l.usuario_nome = ANY(%(portais)s)
  AND NOT EXISTS (
      SELECT 1 FROM analise a WHERE a.numero_controle_pncp = l.numero_controle_pncp
  )
  AND (l.data_encerramento_proposta >= now() OR l.data_abertura_proposta > now())
ORDER BY l.data_encerramento_proposta ASC NULLS LAST
LIMIT %(limit)s OFFSET %(offset)s
"""

_INSERT_SQL = """
INSERT INTO analise (
    numero_controle_pncp, fit_score, verdict, reasoning, triage_model, triaged_at
) VALUES (
    %(numero)s, %(fit_score)s, %(verdict)s, %(reasoning)s, %(model)s, now()
)
ON CONFLICT (numero_controle_pncp) DO UPDATE SET
    fit_score = EXCLUDED.fit_score,
    verdict = EXCLUDED.verdict,
    reasoning = EXCLUDED.reasoning,
    triage_model = EXCLUDED.triage_model,
    triaged_at = EXCLUDED.triaged_at,
    updated_at = now()
"""


def build_instructions(profile_text: str) -> str:
    return (
        "Você é um agente de triagem que avalia se licitações públicas são "
        "aderentes ao perfil de uma empresa. Para CADA licitação da lista, "
        "produza um fit_score de 0 (nenhuma aderência) a 100 (aderência "
        "total), um verdict ('fit', 'no_fit' ou 'borderline') e uma "
        "justificativa curta (até 300 caracteres) em português explicando o "
        "motivo do score.\n\n"
        f"## Perfil da empresa\n\n{profile_text}"
    )


def build_prompt(rows: list[dict[str, Any]]) -> str:
    lines = [
        (
            "Avalie cada licitação abaixo e responda com um resultado por item, "
            "numerado conforme a lista (campo n)."
        ),
        "",
    ]
    for i, row in enumerate(rows, start=1):
        parts = [f"{i}. Objeto: {row.get('objeto') or '(sem objeto)'}"]
        if row.get("modalidade_nome"):
            parts.append(f" | Modalidade: {row['modalidade_nome']}")
        if row.get("setor"):
            parts.append(f" | Setor: {row['setor']}")
        if row.get("uf"):
            parts.append(f" | UF: {row['uf']}")
        if row.get("municipio_nome"):
            parts.append(f" | Município: {row['municipio_nome']}")
        if row.get("valor_total_estimado") is not None:
            parts.append(f" | Valor estimado: {row['valor_total_estimado']}")
        if row.get("itens"):
            parts.append(f" | Itens: {row['itens']}")
        lines.append("".join(parts))
    return "\n".join(lines)


def parse_response(content: str, expected: int) -> dict[int, dict[str, Any]]:
    """Returns {n: {fit_score, verdict, reasoning}} for valid entries only.
    Strict structured outputs should always be well-formed, but we still
    guard against a degenerate/truncated response so bad entries just skip
    (row stays queued) instead of blowing up the whole batch."""
    try:
        payload = json.loads(content)
    except json.JSONDecodeError:
        return {}
    if not isinstance(payload, dict):
        return {}
    entries = payload.get("results")
    if not isinstance(entries, list):
        return {}

    result: dict[int, dict[str, Any]] = {}
    for entry in entries:
        if not isinstance(entry, dict):
            continue
        n = entry.get("n")
        fit_score = entry.get("fit_score")
        verdict = entry.get("verdict")
        reasoning = entry.get("reasoning")
        if (
            isinstance(n, int)
            and 1 <= n <= expected
            and isinstance(fit_score, int)
            and not isinstance(fit_score, bool)
            and 0 <= fit_score <= 100
            and verdict in VERDICTS
            and isinstance(reasoning, str)
        ):
            result[n] = {
                "fit_score": fit_score,
                "verdict": verdict,
                "reasoning": reasoning[:300],
            }
    return result


def triage_batch(
    client: OpenAI, instructions: str, rows: list[dict[str, Any]], model: str
) -> dict[int, dict[str, Any]]:
    response = client.responses.create(
        model=model,
        instructions=instructions,
        input=build_prompt(rows),
        text={
            "format": {
                "type": "json_schema",
                "name": "triage",
                "strict": True,
                "schema": TRIAGE_SCHEMA,
            }
        },
    )
    return parse_response(response.output_text, expected=len(rows))


def triage(
    conn: psycopg.Connection,
    *,
    limit: int | None = None,
    client: OpenAI | None = None,
    model: str | None = None,
    profile_text: str | None = None,
) -> dict[str, int]:
    """Triage pending abertas/futuras top-7 licitações in batches until
    drained (or `limit` processed). Returns counters. On any OpenAI API
    error, logs and stops the run without marking the in-flight batch."""
    client = client or OpenAI()
    model = model or MODEL
    instructions = build_instructions(profile_text or load_profile())

    processed = 0
    triaged = 0
    # mvp shortcut: rows that fail to parse stay eligible (no analise row),
    # so within a single run we track how many were skipped and OFFSET past
    # them to avoid re-fetching the same stuck batch forever. Successfully
    # triaged rows leave the WHERE-eligible set on their own (NOT EXISTS),
    # so they don't need an offset. Skipped rows get retried on the next
    # `plic agents run` invocation (offset resets to 0).
    skipped_offset = 0

    while limit is None or processed < limit:
        batch_limit = BATCH_SIZE if limit is None else min(BATCH_SIZE, limit - processed)
        with conn.cursor(row_factory=psycopg.rows.dict_row) as cur:
            cur.execute(
                _SELECT_BATCH_SQL,
                {"portais": PORTAIS_ATIVOS, "limit": batch_limit, "offset": skipped_offset},
            )
            rows = cur.fetchall()
        if not rows:
            break

        try:
            results = triage_batch(client, instructions, rows, model)
        except Exception:
            logger.exception("triage API call failed; stopping run")
            break

        batch_skipped = 0
        with conn.cursor() as cur:
            for i, row in enumerate(rows, start=1):
                result = results.get(i)
                if result is None:
                    batch_skipped += 1
                    continue
                cur.execute(
                    _INSERT_SQL,
                    {
                        "numero": row["numero_controle_pncp"],
                        "fit_score": result["fit_score"],
                        "verdict": result["verdict"],
                        "reasoning": result["reasoning"],
                        "model": model,
                    },
                )
                triaged += 1
        conn.commit()

        processed += len(rows)
        skipped_offset += batch_skipped
        logger.info(
            "triaged %d (%d ok, %d skipped/unparseable)", processed, triaged, processed - triaged
        )

    return {"processed": processed, "triaged": triaged}
