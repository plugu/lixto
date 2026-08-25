"""Global enrichment worker (cycle 16, ticket 64).

Produces one canonical `enriquecimento` row per pending open licitação —
once, globally, reused by every empresa. Mirrors `agents/deep.py`'s shape
(select → per-row LLM → persist → commit per row) so a crash only loses the
in-flight licitação, and routes each row to the cheapest tier that can
actually answer:

- edital text extracted by pypdf  → `fonte='texto'`, cheap tier on the text;
- only scanned/insufficient PDFs  → `fonte='pdf'`, doc tier with the PDFs;
- no usable document at all       → `fonte='estruturado'`, cheap tier on the
  structured metadata alone.

Nothing here imports `plic.agents.*` or reads `company_profile.md`: the
enrichment is empresa-agnostic by construction.
"""

from __future__ import annotations

import json
import logging
from typing import Any

import httpx
import psycopg

from plic.enrich.documents import DOWNLOAD_TIMEOUT, extract_for_licitacao, pick_documents
from plic.enrich.schema import ENRIQUECIMENTO_SCHEMA, SCHEMA_VERSION, validate_payload
from plic.llm import LlmClient

logger = logging.getLogger(__name__)

BATCH_LIMIT_DEFAULT = 200
MAX_ITENS = 40
ITEM_CHARS = 160
OBJETO_CHARS = 2000
CONTEXT_TEXT_CHARS = 60_000

MAX_PDFS = 2
MAX_PDF_BYTES = 30 * 1024 * 1024  # 30 MB combined

# Copy of agents/triage.py::PORTAIS_ATIVOS — deliberately duplicated so the
# enrichment path never imports the agents package (which loads
# company_profile.md). Keep the lists in sync if the allowlist changes.
PORTAIS_ATIVOS = [
    "Compras.gov.br",
    "ECustomize Consultoria em Software S.A",
    "IPM Sistemas",
    "Betha Sistemas",
    "Governançabrasil Tecnologia e Gestão em Serviços",
    "BLL Compras",
    "Megasoft Informática",
]

INSTRUCTIONS = """Você é um analista de licitações públicas brasileiras. \
Extraia do edital e dos dados estruturados uma representação canônica da \
licitação, em português. Essa representação é global: ela será reutilizada \
por todas as empresas, então nunca avalie o encaixe de uma empresa \
específica nem invente informação que não esteja no material recebido.

Campos:
- resumo: 1 a 3 frases descrevendo objetivamente o que está sendo comprado.
- categorias: categorias amplas de compra (ex.: "material escolar", \
"servicos de limpeza", "equipamentos de informatica").
- conceitos: os conceitos/objetos centrais da compra, mais específicos que \
as categorias (ex.: "lapis", "caderno", "toner").
- palavras_chave: termos de busca, incluindo sinônimos e variações que \
compradores e fornecedores realmente usam (ex.: "lapis", "lapis preto", \
"lapis grafite", "material escolar").
- cnae_candidatos: subclasses CNAE do IBGE no formato 0000-0/00 que um \
fornecedor deste objeto provavelmente possui, cada uma com confianca de 0 a 1.
- requisitos: exigências de habilitação/participação, cada uma com tipo \
(habilitacao_juridica, regularidade_fiscal, qualificacao_tecnica, \
qualificacao_economica, documento, certificacao, amostra, visita_tecnica, \
outro) e descricao curta.
- exige_certificacao: true se o edital exige certificação/registro \
específico do produto ou do fornecedor.
- exige_atestado_tecnico: true se exige atestado de capacidade técnica.
- me_epp_exclusivo: true SOMENTE quando o edital diz que a participação é \
exclusiva de microempresas e empresas de pequeno porte (Lei 123/2006, \
art. 48, I). Cota reservada ou empate ficto não contam.
- me_epp_preferencia: true quando há benefício/preferência a ME/EPP sem \
exclusividade (cota de 25%, direito de preferência, empate ficto).
- entrega: local de entrega/execução e prazo em dias. Use local "" e \
prazo_dias -1 quando o edital não informar.
- riscos: cláusulas restritivas, exigências incomuns, prazos apertados ou \
qualquer ponto de atenção para um fornecedor.
- complexidade: baixa, media ou alta, considerando exigências, volume e \
prazo.
- confianca: 0 a 1, refletindo quanto da resposta veio do texto do edital \
em vez de suposição a partir dos metadados.

Regras de normalização: categorias, conceitos e palavras_chave devem ser \
substantivos em português, minúsculos, SEM acentos, no singular quando fizer \
sentido, sem pontuação e sem nomes de órgãos, cidades ou números de processo."""

# `%(retry_errors)s` flips the pending predicate: normally any existing
# enriquecimento row excludes the licitação; with --retry-errors, rows whose
# last run failed become eligible again.
_SELECT_PENDING_SQL = """
SELECT l.numero_controle_pncp,
       l.objeto_compra,
       l.informacao_complementar,
       l.modalidade_nome,
       l.uf,
       l.municipio_nome,
       l.valor_total_estimado,
       l.data_encerramento_proposta,
       l.srp,
       l.orgao_razao_social
FROM licitacao l
WHERE l.usuario_nome = ANY(%(portais)s)
  AND (l.data_encerramento_proposta >= now() OR l.data_abertura_proposta > now())
  AND NOT EXISTS (
        SELECT 1 FROM enriquecimento e
        WHERE e.numero_controle_pncp = l.numero_controle_pncp
          AND (NOT %(retry_errors)s OR e.status <> 'error')
      )
  AND (%(days)s::int IS NULL
       OR l.data_publicacao_pncp >= now() - make_interval(days => %(days)s))
ORDER BY l.data_encerramento_proposta ASC NULLS LAST
LIMIT %(limit)s
"""

_SELECT_ITENS_SQL = """
SELECT descricao, quantidade, unidade_medida, valor_unitario_estimado, material_ou_servico
FROM item
WHERE numero_controle_pncp = %(numero)s
ORDER BY numero_item
LIMIT %(max_itens)s
"""

_UPSERT_SQL = """
INSERT INTO enriquecimento (
    numero_controle_pncp, schema_version, modelo, confianca, status, erro, fonte,
    resumo, categorias, conceitos, palavras_chave, cnae_candidatos, requisitos,
    exige_certificacao, exige_atestado_tecnico, me_epp_exclusivo, me_epp_preferencia,
    entrega, riscos, complexidade, dados, enriquecido_em, updated_at
) VALUES (
    %(numero)s, %(schema_version)s, %(modelo)s, %(confianca)s, %(status)s, %(erro)s, %(fonte)s,
    %(resumo)s, %(categorias)s, %(conceitos)s, %(palavras_chave)s, %(cnae_candidatos)s,
    %(requisitos)s, %(exige_certificacao)s, %(exige_atestado_tecnico)s, %(me_epp_exclusivo)s,
    %(me_epp_preferencia)s, %(entrega)s, %(riscos)s, %(complexidade)s, %(dados)s, now(), now()
)
ON CONFLICT (numero_controle_pncp) DO UPDATE
SET schema_version = EXCLUDED.schema_version,
    modelo = EXCLUDED.modelo,
    confianca = EXCLUDED.confianca,
    status = EXCLUDED.status,
    erro = EXCLUDED.erro,
    fonte = EXCLUDED.fonte,
    resumo = EXCLUDED.resumo,
    categorias = EXCLUDED.categorias,
    conceitos = EXCLUDED.conceitos,
    palavras_chave = EXCLUDED.palavras_chave,
    cnae_candidatos = EXCLUDED.cnae_candidatos,
    requisitos = EXCLUDED.requisitos,
    exige_certificacao = EXCLUDED.exige_certificacao,
    exige_atestado_tecnico = EXCLUDED.exige_atestado_tecnico,
    me_epp_exclusivo = EXCLUDED.me_epp_exclusivo,
    me_epp_preferencia = EXCLUDED.me_epp_preferencia,
    entrega = EXCLUDED.entrega,
    riscos = EXCLUDED.riscos,
    complexidade = EXCLUDED.complexidade,
    dados = EXCLUDED.dados,
    enriquecido_em = now(),
    updated_at = now()
"""


def fetch_itens(conn: psycopg.Connection, numero: str) -> list[dict[str, Any]]:
    with conn.cursor(row_factory=psycopg.rows.dict_row) as cur:
        cur.execute(_SELECT_ITENS_SQL, {"numero": numero, "max_itens": MAX_ITENS})
        return cur.fetchall()


def _format_item(index: int, item: dict[str, Any]) -> str:
    descricao = (item.get("descricao") or "(sem descrição)").strip()[:ITEM_CHARS]
    parts = [f"{index}. {descricao}"]
    quantidade = item.get("quantidade")
    unidade = (item.get("unidade_medida") or "").strip()
    if quantidade is not None or unidade:
        parts.append(f"{quantidade if quantidade is not None else '?'} {unidade}".strip())
    valor = item.get("valor_unitario_estimado")
    if valor is not None:
        parts.append(f"R$ {valor}")
    return " — ".join(parts)


def build_prompt(
    row: dict[str, Any], itens: list[dict[str, Any]], docs: list[dict[str, Any]]
) -> str:
    """Structured summary of the licitação plus, when available, the pypdf
    text of its edital documents capped at CONTEXT_TEXT_CHARS."""
    lines = ["## Dados estruturados", ""]
    lines.append(f"Objeto: {(row.get('objeto_compra') or '(sem objeto)')[:OBJETO_CHARS]}")
    if row.get("informacao_complementar"):
        lines.append(f"Informação complementar: {row['informacao_complementar'][:OBJETO_CHARS]}")
    if row.get("modalidade_nome"):
        lines.append(f"Modalidade: {row['modalidade_nome']}")
    if row.get("orgao_razao_social"):
        lines.append(f"Órgão: {row['orgao_razao_social']}")
    local = " / ".join(str(x) for x in (row.get("uf"), row.get("municipio_nome")) if x)
    if local:
        lines.append(f"Local: {local}")
    if row.get("valor_total_estimado") is not None:
        lines.append(f"Valor total estimado: {row['valor_total_estimado']}")
    if row.get("srp") is not None:
        lines.append(f"SRP (registro de preços): {'sim' if row['srp'] else 'não'}")
    if row.get("data_encerramento_proposta"):
        lines.append(f"Encerramento das propostas: {row['data_encerramento_proposta']}")

    if itens:
        lines.append("")
        lines.append("## Itens")
        for i, item in enumerate(itens[:MAX_ITENS], start=1):
            lines.append(_format_item(i, item))

    textos = [d.get("texto") for d in docs if d.get("metodo") == "pypdf" and d.get("texto")]
    if textos:
        lines.append("")
        lines.append("## Texto do edital")
        lines.append("\n\n".join(textos)[:CONTEXT_TEXT_CHARS])

    return "\n".join(lines)


def _collect_pdfs(
    conn: psycopg.Connection,
    numero: str,
    docs: list[dict[str, Any]],
    http_client: httpx.Client,
) -> list[dict[str, Any]] | None:
    """PDF bytes for the docs pypdf couldn't read, reusing the freshly
    downloaded bytes when the extractor still has them. Returns None when
    nothing is usable or the cap (MAX_PDFS / MAX_PDF_BYTES) is exceeded — the
    caller then falls back to the structured route."""
    candidates = [d for d in docs if d.get("metodo") == "insuficiente"]
    if not candidates:
        return None
    if len(candidates) > MAX_PDFS:
        logger.info("%s has %d insufficient docs, over cap", numero, len(candidates))
        return None

    urls = {d.get("sequencial_documento"): d.get("url") for d in pick_documents(conn, numero)}

    pdfs: list[dict[str, Any]] = []
    total = 0
    for doc in candidates:
        seq = doc.get("sequencial_documento")
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
            logger.info("%s PDFs exceed %d bytes, over cap", numero, MAX_PDF_BYTES)
            return None
        pdfs.append({"filename": f"documento-{seq}.pdf", "content": content})

    return pdfs or None


def _upsert(
    conn: psycopg.Connection,
    numero: str,
    *,
    status: str,
    fonte: str,
    modelo: str | None,
    erro: str | None,
    payload: dict[str, Any] | None,
) -> None:
    payload = payload or {}
    params = {
        "numero": numero,
        "schema_version": SCHEMA_VERSION,
        "modelo": modelo,
        "confianca": payload.get("confianca"),
        "status": status,
        "erro": erro,
        "fonte": fonte,
        "resumo": payload.get("resumo"),
        "categorias": payload.get("categorias") or [],
        "conceitos": payload.get("conceitos") or [],
        "palavras_chave": payload.get("palavras_chave") or [],
        "cnae_candidatos": json.dumps(payload.get("cnae_candidatos") or []),
        "requisitos": json.dumps(payload.get("requisitos") or []),
        "exige_certificacao": payload.get("exige_certificacao"),
        "exige_atestado_tecnico": payload.get("exige_atestado_tecnico"),
        "me_epp_exclusivo": payload.get("me_epp_exclusivo"),
        "me_epp_preferencia": payload.get("me_epp_preferencia"),
        "entrega": json.dumps(payload["entrega"]) if payload.get("entrega") else None,
        "riscos": payload.get("riscos") or [],
        "complexidade": payload.get("complexidade"),
        "dados": json.dumps(payload),
    }
    with conn.cursor() as cur:
        cur.execute(_UPSERT_SQL, params)
    conn.commit()


def enrich_one(
    conn: psycopg.Connection,
    row: dict[str, Any],
    *,
    llm: LlmClient,
    http_client: httpx.Client,
) -> str:
    """Enriches a single licitação end-to-end and commits. Returns
    'done' | 'error'; never raises for per-row failures — those are persisted
    as status='error' so the row leaves the queue (rerun with --retry-errors
    to pick it back up)."""
    numero = row["numero_controle_pncp"]
    fonte = "estruturado"
    try:
        docs = extract_for_licitacao(conn, numero, http_client)
        itens = fetch_itens(conn, numero)
        prompt = build_prompt(row, itens, docs)

        pdfs: list[dict[str, Any]] | None = None
        if any(d.get("metodo") == "pypdf" for d in docs):
            fonte = "texto"
        else:
            pdfs = _collect_pdfs(conn, numero, docs, http_client)
            if pdfs:
                fonte = "pdf"

        if fonte == "pdf" and pdfs:
            result, modelo = llm.complete_json_pdf(
                instructions=INSTRUCTIONS,
                prompt=prompt,
                pdfs=pdfs,
                schema=ENRIQUECIMENTO_SCHEMA,
                name="enriquecimento",
            )
        else:
            result, modelo = llm.complete_json_text(
                tier="cheap",
                instructions=INSTRUCTIONS,
                prompt=prompt,
                schema=ENRIQUECIMENTO_SCHEMA,
                name="enriquecimento",
            )

        payload = validate_payload(result)
        if payload is None:
            _upsert(
                conn,
                numero,
                status="error",
                fonte=fonte,
                modelo=modelo,
                erro="resposta inválida",
                payload=None,
            )
            return "error"

        _upsert(
            conn,
            numero,
            status="done",
            fonte=fonte,
            modelo=modelo,
            erro=None,
            payload=payload,
        )
        return "done"
    except Exception as exc:
        logger.exception("enrichment failed for %s", numero)
        try:
            _upsert(
                conn,
                numero,
                status="error",
                fonte=fonte,
                modelo=None,
                erro=str(exc)[:2000],
                payload=None,
            )
        except Exception:
            logger.exception("failed to persist error status for %s", numero)
            conn.rollback()
        return "error"


def enrich(
    conn: psycopg.Connection,
    *,
    limit: int | None = None,
    days: int | None = None,
    retry_errors: bool = False,
    llm: LlmClient | None = None,
    http_client: httpx.Client | None = None,
) -> dict[str, int]:
    """Enriches pending open licitações one at a time, committing after each
    so the run is resumable. Returns {processed, done, error}."""
    llm = llm or LlmClient()
    owns_http_client = http_client is None
    http_client = http_client or httpx.Client()

    counters = {"processed": 0, "done": 0, "error": 0}
    try:
        with conn.cursor(row_factory=psycopg.rows.dict_row) as cur:
            cur.execute(
                _SELECT_PENDING_SQL,
                {
                    "portais": PORTAIS_ATIVOS,
                    "limit": limit if limit is not None else BATCH_LIMIT_DEFAULT,
                    "days": days,
                    "retry_errors": retry_errors,
                },
            )
            rows = cur.fetchall()

        for row in rows:
            status = enrich_one(conn, row, llm=llm, http_client=http_client)
            counters["processed"] += 1
            counters[status] = counters.get(status, 0) + 1
            logger.info(
                "enriched %s -> %s (%d/%d)",
                row["numero_controle_pncp"],
                status,
                counters["processed"],
                len(rows),
            )
    finally:
        if owns_http_client:
            http_client.close()

    return counters
