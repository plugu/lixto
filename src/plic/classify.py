"""Sector classification of licitações via a local LLM (Ollama).

One-time/backlog tool: classifies abertas/futuras whose `setor` is NULL using
the objeto plus a few item descriptions, through Ollama's OpenAI-compatible
endpoint. Labels persist in `licitacao.setor`, so nothing at serving time
depends on any model — future records can be classified by other means.

Resumable and idempotent: only rows with `setor IS NULL` are selected, and
each batch commits on its own.
"""

from __future__ import annotations

import json
import logging
import os
import re
from typing import Any

import httpx
import psycopg

logger = logging.getLogger(__name__)

OLLAMA_URL = os.environ.get("PLIC_OLLAMA_URL", "http://localhost:11434")
MODEL = os.environ.get("PLIC_CLASSIFY_MODEL", "gpt-oss:20b")
BATCH_SIZE = 20
REQUEST_TIMEOUT = 600.0

SETORES = [
    "TI",
    "Saúde",
    "Obras e Engenharia",
    "Alimentação",
    "Veículos e Transporte",
    "Limpeza e Conservação",
    "Segurança",
    "Educação",
    "Mobiliário e Escritório",
    "Eventos e Comunicação",
    "Energia e Utilidades",
    "Agropecuária e Meio Ambiente",
    "Vestuário e EPI",
    "Outros",
]

_SELECT_BATCH_SQL = """
SELECT l.numero_controle_pncp,
       left(l.objeto_compra, 300) AS objeto,
       (SELECT string_agg(left(i.descricao, 100), '; ')
        FROM (SELECT descricao FROM item
              WHERE numero_controle_pncp = l.numero_controle_pncp
              ORDER BY numero_item LIMIT 3) i) AS itens
FROM licitacao l
WHERE l.setor IS NULL
  AND (l.data_encerramento_proposta >= now() OR l.data_abertura_proposta > now())
ORDER BY l.data_encerramento_proposta ASC NULLS LAST
LIMIT %(limit)s
"""

_UPDATE_SQL = """
UPDATE licitacao SET setor = %(setor)s, setor_classificado_em = now()
WHERE numero_controle_pncp = %(numero)s
"""


def build_prompt(rows: list[dict[str, Any]]) -> str:
    lines = [
        "Classifique cada licitação pública em UM setor desta lista exata: "
        + ", ".join(SETORES)
        + ".",
        "",
        'Responda APENAS um array JSON: [{"n":1,"setor":"..."}] — um objeto por licitação, sem texto extra.',
        "",
    ]
    for i, row in enumerate(rows, start=1):
        parts = [f"{i}. Objeto: {row['objeto'] or '(sem objeto)'}"]
        if row.get("itens"):
            parts.append(f" Itens: {row['itens']}")
        lines.append("".join(parts))
    return "\n".join(lines)


def parse_response(content: str, expected: int) -> dict[int, str]:
    """Returns {n: setor} for valid entries only. Tolerates ```json fences and
    stray text around the array; drops unknown labels and out-of-range n."""
    match = re.search(r"\[.*\]", content, re.DOTALL)
    if not match:
        return {}
    try:
        entries = json.loads(match.group(0))
    except json.JSONDecodeError:
        return {}
    result: dict[int, str] = {}
    if not isinstance(entries, list):
        return {}
    for entry in entries:
        if not isinstance(entry, dict):
            continue
        n = entry.get("n")
        setor = entry.get("setor")
        if isinstance(n, int) and 1 <= n <= expected and setor in SETORES:
            result[n] = setor
    return result


def classify_batch(client: httpx.Client, rows: list[dict[str, Any]]) -> dict[int, str]:
    response = client.post(
        f"{OLLAMA_URL}/v1/chat/completions",
        json={
            "model": MODEL,
            "temperature": 0,
            "messages": [{"role": "user", "content": build_prompt(rows)}],
        },
        timeout=REQUEST_TIMEOUT,
    )
    response.raise_for_status()
    content = response.json()["choices"][0]["message"]["content"]
    return parse_response(content, expected=len(rows))


def classify(
    conn: psycopg.Connection,
    *,
    limit: int | None = None,
    client: httpx.Client | None = None,
) -> dict[str, int]:
    """Classify pending abertas/futuras in batches until drained (or `limit`
    licitações processed). Returns counters."""
    owns_client = client is None
    client = client or httpx.Client()
    processed = 0
    classified = 0
    try:
        while limit is None or processed < limit:
            batch_limit = BATCH_SIZE if limit is None else min(BATCH_SIZE, limit - processed)
            with conn.cursor(row_factory=psycopg.rows.dict_row) as cur:
                cur.execute(_SELECT_BATCH_SQL, {"limit": batch_limit})
                rows = cur.fetchall()
            if not rows:
                break

            labels = classify_batch(client, rows)
            with conn.cursor() as cur:
                for i, row in enumerate(rows, start=1):
                    setor = labels.get(i)
                    if setor is None:
                        # Unparseable/missing entries fall to "Outros" so the
                        # row leaves the queue; rerun with setor=NULL to redo.
                        setor = "Outros"
                    else:
                        classified += 1
                    cur.execute(
                        _UPDATE_SQL,
                        {"setor": setor, "numero": row["numero_controle_pncp"]},
                    )
            conn.commit()
            processed += len(rows)
            logger.info("classified %d (%d ok, %d fallback)", processed, classified, processed - classified)
    finally:
        if owns_client:
            client.close()
    return {"processed": processed, "classified": classified}
