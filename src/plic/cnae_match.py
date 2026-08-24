"""Two-stage CNAE tagging of licitações via a local LLM (Ollama).

Clones the structure of `classify.py` (batch select → Ollama OpenAI-compat
`/v1/chat/completions` → tolerant JSON parse → commit) but narrows the ~1359
IBGE CNAE subclasses hierarchically so a 12-20B local model can handle it:

- Stage 1 (per batch of `BATCH_SIZE`): given the objeto + item descriptions
  of every row in the batch and the full list of CNAE divisions (~87), the
  model returns up to 4 candidate division codes per licitação.
- Stage 2 (per licitação): given only the subclasses under that licitação's
  chosen divisions, the model returns the subclasses that actually apply,
  each with a confidence.

Resumable and offline-tolerant: only rows with `cnae_classificado_em IS NULL`
are selected. `licitacao_cnae` rows are inserted (ON CONFLICT DO NOTHING) and
the row is stamped with `cnae_classificado_em = now()` per-row, even when the
model finds zero tags, so a "clean" row leaves the queue too. If Ollama is
unreachable or errors mid-run, the row being processed at that moment is left
unstamped and the whole run aborts — already-committed rows before it stay
tagged, and the next run retries what's left.
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
MODEL = os.environ.get("PLIC_CNAE_MODEL", "gpt-oss:20b")
BATCH_SIZE = 10
REQUEST_TIMEOUT = 600.0
MAX_DIVISIONS_PER_ROW = 4

_SELECT_BATCH_SQL = """
SELECT l.numero_controle_pncp,
       left(l.objeto_compra, 300) AS objeto,
       (SELECT string_agg(left(i.descricao, 100), '; ')
        FROM (SELECT descricao FROM item
              WHERE numero_controle_pncp = l.numero_controle_pncp
              ORDER BY numero_item LIMIT 5) i) AS itens
FROM licitacao l
WHERE l.cnae_classificado_em IS NULL
  AND (l.data_encerramento_proposta >= now() OR l.data_abertura_proposta > now())
ORDER BY l.data_encerramento_proposta ASC NULLS LAST
LIMIT %(limit)s
"""

_DIVISIONS_SQL = """
SELECT DISTINCT divisao, divisao_descricao FROM cnae ORDER BY divisao
"""

_SUBCLASSES_SQL = """
SELECT codigo, descricao FROM cnae WHERE divisao = ANY(%(divisoes)s) ORDER BY codigo
"""

_INSERT_TAG_SQL = """
INSERT INTO licitacao_cnae (numero_controle_pncp, codigo, confidence)
VALUES (%(numero)s, %(codigo)s, %(confidence)s)
ON CONFLICT DO NOTHING
"""

_STAMP_SQL = """
UPDATE licitacao SET cnae_classificado_em = now()
WHERE numero_controle_pncp = %(numero)s
"""


def _row_label(row: dict[str, Any]) -> str:
    parts = [f"Objeto: {row['objeto'] or '(sem objeto)'}"]
    if row.get("itens"):
        parts.append(f" Itens: {row['itens']}")
    return "".join(parts)


def build_stage1_prompt(divisions: list[dict[str, Any]], rows: list[dict[str, Any]]) -> str:
    lines = [
        "Você é um classificador de licitações públicas por divisão CNAE (IBGE).",
        "Divisões disponíveis (código — descrição):",
    ]
    for d in divisions:
        lines.append(f"{d['divisao']} — {d['divisao_descricao']}")
    lines.append("")
    lines.append(
        f"Para cada licitação abaixo, escolha até {MAX_DIVISIONS_PER_ROW} códigos de "
        "divisão mais prováveis dentre a lista acima."
    )
    lines.append(
        'Responda APENAS um array JSON: [{"n":1,"divisoes":["47","62"]}] — '
        "um objeto por licitação, sem texto extra."
    )
    lines.append("")
    for i, row in enumerate(rows, start=1):
        lines.append(f"{i}. {_row_label(row)}")
    return "\n".join(lines)


def parse_stage1_response(
    content: str, expected: int, valid_divisoes: set[str]
) -> dict[int, list[str]]:
    """Returns {n: [divisao, ...]} — up to MAX_DIVISIONS_PER_ROW valid, deduped
    division codes per row. Tolerates ```json fences and stray prose; drops
    unknown divisions and out-of-range n."""
    match = re.search(r"\[.*\]", content, re.DOTALL)
    if not match:
        return {}
    try:
        entries = json.loads(match.group(0))
    except json.JSONDecodeError:
        return {}
    if not isinstance(entries, list):
        return {}
    result: dict[int, list[str]] = {}
    for entry in entries:
        if not isinstance(entry, dict):
            continue
        n = entry.get("n")
        divisoes = entry.get("divisoes")
        if not (isinstance(n, int) and 1 <= n <= expected):
            continue
        if not isinstance(divisoes, list):
            continue
        picked: list[str] = []
        for d in divisoes:
            if isinstance(d, str) and d in valid_divisoes and d not in picked:
                picked.append(d)
            if len(picked) == MAX_DIVISIONS_PER_ROW:
                break
        result[n] = picked
    return result


def build_stage2_prompt(row: dict[str, Any], subclasses: list[dict[str, Any]]) -> str:
    lines = [
        "Você é um classificador de licitações públicas por subclasse CNAE (IBGE).",
        "Subclasses candidatas (código — descrição):",
    ]
    for s in subclasses:
        lines.append(f"{s['codigo']} — {s['descricao']}")
    lines.append("")
    lines.append(f"Licitação — {_row_label(row)}")
    lines.append("")
    lines.append(
        "Escolha as subclasses (dentre as listadas acima) que melhor descrevem o objeto "
        "desta licitação, cada uma com um grau de confiança de 0.0 a 1.0."
    )
    lines.append(
        'Responda APENAS um array JSON: [{"codigo":"4711301","confidence":0.8}] — '
        "sem texto extra. Se nenhuma subclasse se aplicar, responda []."
    )
    return "\n".join(lines)


def parse_stage2_response(content: str, valid_codes: set[str]) -> list[dict[str, Any]]:
    """Returns [{"codigo": ..., "confidence": float|None}, ...] for valid,
    deduped entries only. Drops entries whose codigo isn't in `valid_codes`;
    confidence outside [0,1] or non-numeric is dropped to None (codigo still
    kept). Tolerates ```json fences/prose; garbage input returns []."""
    match = re.search(r"\[.*\]", content, re.DOTALL)
    if not match:
        return []
    try:
        entries = json.loads(match.group(0))
    except json.JSONDecodeError:
        return []
    if not isinstance(entries, list):
        return []
    result: list[dict[str, Any]] = []
    seen: set[str] = set()
    for entry in entries:
        if not isinstance(entry, dict):
            continue
        codigo = entry.get("codigo")
        if not isinstance(codigo, str) or codigo not in valid_codes or codigo in seen:
            continue
        confidence = entry.get("confidence")
        if (
            isinstance(confidence, bool)
            or not isinstance(confidence, int | float)
            or not (0.0 <= confidence <= 1.0)
        ):
            confidence = None
        seen.add(codigo)
        result.append({"codigo": codigo, "confidence": confidence})
    return result


def classify_stage1(
    client: httpx.Client, divisions: list[dict[str, Any]], rows: list[dict[str, Any]]
) -> dict[int, list[str]]:
    valid_divisoes = {d["divisao"] for d in divisions}
    response = client.post(
        f"{OLLAMA_URL}/v1/chat/completions",
        json={
            "model": MODEL,
            "temperature": 0,
            "messages": [{"role": "user", "content": build_stage1_prompt(divisions, rows)}],
        },
        timeout=REQUEST_TIMEOUT,
    )
    response.raise_for_status()
    content = response.json()["choices"][0]["message"]["content"]
    return parse_stage1_response(content, expected=len(rows), valid_divisoes=valid_divisoes)


def classify_stage2(
    client: httpx.Client, row: dict[str, Any], subclasses: list[dict[str, Any]]
) -> list[dict[str, Any]]:
    valid_codes = {s["codigo"] for s in subclasses}
    response = client.post(
        f"{OLLAMA_URL}/v1/chat/completions",
        json={
            "model": MODEL,
            "temperature": 0,
            "messages": [{"role": "user", "content": build_stage2_prompt(row, subclasses)}],
        },
        timeout=REQUEST_TIMEOUT,
    )
    response.raise_for_status()
    content = response.json()["choices"][0]["message"]["content"]
    return parse_stage2_response(content, valid_codes=valid_codes)


def classify(
    conn: psycopg.Connection,
    *,
    limit: int | None = None,
    client: httpx.Client | None = None,
) -> dict[str, int]:
    """Tags pending abertas/futuras with CNAE subclasses in batches until
    drained (or `limit` licitações processed). Commits per row, so a
    connection/HTTP error mid-run only leaves the in-flight row unstamped —
    the run then aborts (result carries "aborted": 1) so the next invocation
    retries it; already-committed rows in the same or prior batches stay
    tagged. Returns counters: processed, tagged (rows with >=1 tag), tags
    (total tag rows inserted), and aborted (1 if the run stopped early)."""
    owns_client = client is None
    client = client or httpx.Client()
    processed = 0
    tagged = 0
    tags_total = 0
    aborted = False
    try:
        with conn.cursor(row_factory=psycopg.rows.dict_row) as cur:
            cur.execute(_DIVISIONS_SQL)
            divisions = cur.fetchall()

        while not aborted and (limit is None or processed < limit):
            batch_limit = BATCH_SIZE if limit is None else min(BATCH_SIZE, limit - processed)
            with conn.cursor(row_factory=psycopg.rows.dict_row) as cur:
                cur.execute(_SELECT_BATCH_SQL, {"limit": batch_limit})
                rows = cur.fetchall()
            if not rows:
                break

            try:
                stage1 = classify_stage1(client, divisions, rows)
            except httpx.HTTPError:
                logger.exception(
                    "stage 1 request failed; aborting run, %d row(s) in this batch left unstamped",
                    len(rows),
                )
                aborted = True
                break

            for i, row in enumerate(rows, start=1):
                divisoes = stage1.get(i, [])
                tags: list[dict[str, Any]] = []
                if divisoes:
                    with conn.cursor(row_factory=psycopg.rows.dict_row) as cur:
                        cur.execute(_SUBCLASSES_SQL, {"divisoes": divisoes})
                        subclasses = cur.fetchall()
                    if subclasses:
                        try:
                            tags = classify_stage2(client, row, subclasses)
                        except httpx.HTTPError:
                            logger.exception(
                                "stage 2 request failed for %s; aborting run, row left unstamped",
                                row["numero_controle_pncp"],
                            )
                            aborted = True
                            break

                with conn.cursor() as cur:
                    for tag in tags:
                        cur.execute(
                            _INSERT_TAG_SQL,
                            {
                                "numero": row["numero_controle_pncp"],
                                "codigo": tag["codigo"],
                                "confidence": tag["confidence"],
                            },
                        )
                    cur.execute(_STAMP_SQL, {"numero": row["numero_controle_pncp"]})
                conn.commit()
                processed += 1
                tags_total += len(tags)
                if tags:
                    tagged += 1

            logger.info(
                "cnae classified %d (%d tagged, %d tags, aborted=%s)",
                processed,
                tagged,
                tags_total,
                aborted,
            )
    finally:
        if owns_client:
            client.close()

    result = {"processed": processed, "tagged": tagged, "tags": tags_total}
    if aborted:
        result["aborted"] = 1
    return result


def eval_pending(
    conn: psycopg.Connection,
    *,
    limit: int | None = None,
    client: httpx.Client | None = None,
) -> list[dict[str, Any]]:
    """Dry-run evaluation: tags pending abertas/futuras without persisting.
    Returns list of {numero, objeto, tags: [{codigo, descricao, confidence}]}.
    Use to compare model quality before fixing the default."""
    owns_client = client is None
    client = client or httpx.Client()
    results = []
    try:
        with conn.cursor(row_factory=psycopg.rows.dict_row) as cur:
            cur.execute(_DIVISIONS_SQL)
            divisions = cur.fetchall()

        processed = 0
        aborted = False
        while not aborted and (limit is None or processed < limit):
            batch_limit = BATCH_SIZE if limit is None else min(BATCH_SIZE, limit - processed)
            with conn.cursor(row_factory=psycopg.rows.dict_row) as cur:
                cur.execute(_SELECT_BATCH_SQL, {"limit": batch_limit})
                rows = cur.fetchall()
            if not rows:
                break

            try:
                stage1 = classify_stage1(client, divisions, rows)
            except httpx.HTTPError:
                logger.exception(
                    "stage 1 request failed; stopping eval, %d row(s) in this batch not evaluated",
                    len(rows),
                )
                aborted = True
                break

            for i, row in enumerate(rows, start=1):
                divisoes = stage1.get(i, [])
                tags: list[dict[str, Any]] = []
                if divisoes:
                    with conn.cursor(row_factory=psycopg.rows.dict_row) as cur:
                        cur.execute(_SUBCLASSES_SQL, {"divisoes": divisoes})
                        subclasses = cur.fetchall()
                    if subclasses:
                        try:
                            tags = classify_stage2(client, row, subclasses)
                        except httpx.HTTPError:
                            logger.exception("stage 2 request failed for %s; stopping eval", row["numero_controle_pncp"])
                            aborted = True
                            break

                        # Enhance tags with descriptions from subclasses
                        subclass_map = {s["codigo"]: s["descricao"] for s in subclasses}
                        for tag in tags:
                            tag["descricao"] = subclass_map.get(tag["codigo"], "")

                results.append(
                    {
                        "numero": row["numero_controle_pncp"],
                        "objeto": row["objeto"],
                        "tags": tags,
                    }
                )
                processed += 1

            if aborted:
                break

        logger.info("cnae eval: %d row(s) evaluated (not persisted)", processed)
    finally:
        if owns_client:
            client.close()

    return results
