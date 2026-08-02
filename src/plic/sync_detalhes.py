"""`plic sync detalhes` — fetches items + edital/anexo metadata (arquivos)
for licitações that don't have them yet, and upserts into `item` / `documento`.

Endpoints (docs/PNCP_API.md):
    GET /api/pncp/v1/orgaos/{cnpj}/compras/{ano}/{sequencial}/itens
    GET /api/pncp/v1/orgaos/{cnpj}/compras/{ano}/{sequencial}/arquivos
Both return a bare JSON array (no page envelope) — page until an empty array
is returned. A 404 on the first page means "nothing published" and counts as
synced-empty, same as a genuinely empty array. Verified live (2026-08-01):
end-of-pagination on a page past the first can also come back as HTTP 204
(empty body) rather than `200` with `[]` — both are treated as "no more
data".

Verified live (2026-08-01) against a real item response: `situacaoCompraItem`
and `tipoBeneficio` are integers with separate `...Nome` string fields (e.g.
`"situacaoCompraItem": 1, "situacaoCompraItemNome": "Em andamento"`), matching
the `situacao_compra_item_id/nome` and `tipo_beneficio_id/nome` columns
already in migrations/001_schema.sql — no schema mismatch found, so no
migration 002 was needed for ticket 03.

mvp mode: for a selected licitação we always (re)fetch and upsert both itens
and arquivos, regardless of which one was actually missing — simpler than
independently tracking two fetch states, and harmless since upserts are
idempotent. That's the shortcut this ticket allows.
"""

from __future__ import annotations

import logging
from typing import Any

import psycopg
from psycopg.types.json import Json

from plic.pncp_client import PncpApiError, PncpClient

logger = logging.getLogger(__name__)

BASE_URL_PNCP = "https://pncp.gov.br/api/pncp"

_SELECT_PENDING_SQL = """
SELECT numero_controle_pncp, orgao_cnpj, ano_compra, sequencial_compra
FROM licitacao
WHERE itens_sincronizados_em IS NULL OR arquivos_sincronizados_em IS NULL
ORDER BY data_publicacao_pncp
"""

_UPSERT_ITEM_SQL = """
INSERT INTO item (
    numero_controle_pncp, numero_item, descricao, material_ou_servico,
    material_ou_servico_nome, quantidade, unidade_medida,
    valor_unitario_estimado, valor_total,
    criterio_julgamento_id, criterio_julgamento_nome,
    situacao_compra_item_id, situacao_compra_item_nome,
    tipo_beneficio_id, tipo_beneficio_nome,
    ncm_nbs_codigo, catalogo_codigo_item,
    data_inclusao, data_atualizacao, raw
) VALUES (
    %(numero_controle_pncp)s, %(numero_item)s, %(descricao)s, %(material_ou_servico)s,
    %(material_ou_servico_nome)s, %(quantidade)s, %(unidade_medida)s,
    %(valor_unitario_estimado)s, %(valor_total)s,
    %(criterio_julgamento_id)s, %(criterio_julgamento_nome)s,
    %(situacao_compra_item_id)s, %(situacao_compra_item_nome)s,
    %(tipo_beneficio_id)s, %(tipo_beneficio_nome)s,
    %(ncm_nbs_codigo)s, %(catalogo_codigo_item)s,
    %(data_inclusao)s, %(data_atualizacao)s, %(raw)s
)
ON CONFLICT (numero_controle_pncp, numero_item) DO UPDATE SET
    descricao = EXCLUDED.descricao,
    material_ou_servico = EXCLUDED.material_ou_servico,
    material_ou_servico_nome = EXCLUDED.material_ou_servico_nome,
    quantidade = EXCLUDED.quantidade,
    unidade_medida = EXCLUDED.unidade_medida,
    valor_unitario_estimado = EXCLUDED.valor_unitario_estimado,
    valor_total = EXCLUDED.valor_total,
    criterio_julgamento_id = EXCLUDED.criterio_julgamento_id,
    criterio_julgamento_nome = EXCLUDED.criterio_julgamento_nome,
    situacao_compra_item_id = EXCLUDED.situacao_compra_item_id,
    situacao_compra_item_nome = EXCLUDED.situacao_compra_item_nome,
    tipo_beneficio_id = EXCLUDED.tipo_beneficio_id,
    tipo_beneficio_nome = EXCLUDED.tipo_beneficio_nome,
    ncm_nbs_codigo = EXCLUDED.ncm_nbs_codigo,
    catalogo_codigo_item = EXCLUDED.catalogo_codigo_item,
    data_inclusao = EXCLUDED.data_inclusao,
    data_atualizacao = EXCLUDED.data_atualizacao,
    raw = EXCLUDED.raw,
    updated_at = now()
"""

_UPSERT_DOCUMENTO_SQL = """
INSERT INTO documento (
    numero_controle_pncp, sequencial_documento, titulo, tipo_documento_id,
    tipo_documento_nome, tipo_documento_descricao, url, status_ativo,
    data_publicacao_pncp, cnpj, ano_compra, sequencial_compra, raw
) VALUES (
    %(numero_controle_pncp)s, %(sequencial_documento)s, %(titulo)s, %(tipo_documento_id)s,
    %(tipo_documento_nome)s, %(tipo_documento_descricao)s, %(url)s, %(status_ativo)s,
    %(data_publicacao_pncp)s, %(cnpj)s, %(ano_compra)s, %(sequencial_compra)s, %(raw)s
)
ON CONFLICT (numero_controle_pncp, sequencial_documento) DO UPDATE SET
    titulo = EXCLUDED.titulo,
    tipo_documento_id = EXCLUDED.tipo_documento_id,
    tipo_documento_nome = EXCLUDED.tipo_documento_nome,
    tipo_documento_descricao = EXCLUDED.tipo_documento_descricao,
    url = EXCLUDED.url,
    status_ativo = EXCLUDED.status_ativo,
    data_publicacao_pncp = EXCLUDED.data_publicacao_pncp,
    cnpj = EXCLUDED.cnpj,
    ano_compra = EXCLUDED.ano_compra,
    sequencial_compra = EXCLUDED.sequencial_compra,
    raw = EXCLUDED.raw,
    updated_at = now()
"""


def row_from_item_dto(numero_controle_pncp: str, dto: dict[str, Any]) -> dict[str, Any]:
    """Flatten one `RecuperarCompraItemSigiloDTO` into `item` row params."""
    return {
        "numero_controle_pncp": numero_controle_pncp,
        "numero_item": dto["numeroItem"],
        "descricao": dto.get("descricao"),
        "material_ou_servico": dto.get("materialOuServico"),
        "material_ou_servico_nome": dto.get("materialOuServicoNome"),
        "quantidade": dto.get("quantidade"),
        "unidade_medida": dto.get("unidadeMedida"),
        "valor_unitario_estimado": dto.get("valorUnitarioEstimado"),
        "valor_total": dto.get("valorTotal"),
        "criterio_julgamento_id": dto.get("criterioJulgamentoId"),
        "criterio_julgamento_nome": dto.get("criterioJulgamentoNome"),
        "situacao_compra_item_id": dto.get("situacaoCompraItem"),
        "situacao_compra_item_nome": dto.get("situacaoCompraItemNome"),
        "tipo_beneficio_id": dto.get("tipoBeneficio"),
        "tipo_beneficio_nome": dto.get("tipoBeneficioNome"),
        "ncm_nbs_codigo": dto.get("ncmNbsCodigo"),
        "catalogo_codigo_item": dto.get("catalogoCodigoItem"),
        "data_inclusao": dto.get("dataInclusao"),
        "data_atualizacao": dto.get("dataAtualizacao"),
        "raw": Json(dto),
    }


def row_from_documento_dto(numero_controle_pncp: str, dto: dict[str, Any]) -> dict[str, Any]:
    """Flatten one `RecuperarDadosDocumentoCompraDTO` into `documento` row params.

    `url` is stored exactly as given — the file itself is never downloaded.
    """
    return {
        "numero_controle_pncp": numero_controle_pncp,
        "sequencial_documento": dto["sequencialDocumento"],
        "titulo": dto.get("titulo"),
        "tipo_documento_id": dto.get("tipoDocumentoId"),
        "tipo_documento_nome": dto.get("tipoDocumentoNome"),
        "tipo_documento_descricao": dto.get("tipoDocumentoDescricao"),
        "url": dto.get("url"),
        "status_ativo": dto.get("statusAtivo"),
        "data_publicacao_pncp": dto.get("dataPublicacaoPncp"),
        "cnpj": dto.get("cnpj"),
        "ano_compra": dto.get("anoCompra"),
        "sequencial_compra": dto.get("sequencialCompra"),
        "raw": Json(dto),
    }


def upsert_item(cursor: psycopg.Cursor, numero_controle_pncp: str, dto: dict[str, Any]) -> None:
    row = row_from_item_dto(numero_controle_pncp, dto)
    cursor.execute(_UPSERT_ITEM_SQL, row)


def upsert_documento(
    cursor: psycopg.Cursor, numero_controle_pncp: str, dto: dict[str, Any]
) -> None:
    row = row_from_documento_dto(numero_controle_pncp, dto)
    cursor.execute(_UPSERT_DOCUMENTO_SQL, row)


def _fetch_bare_array_pages(
    client: PncpClient, path: str, *, tamanho_pagina: int = 50
) -> list[dict[str, Any]]:
    """Page a bare-array endpoint (itens/arquivos) until an empty page.

    A 404 on the first page is treated as "nothing published" (empty list) —
    the endpoint has no page envelope to signal that otherwise. A 404 on any
    later page (shouldn't happen, but data is data) is an error, not silently
    swallowed.

    Verified live (2026-08-01): PNCP signals "no more pages" on a page past
    the first with an HTTP 204 (empty body), not a `200` with a bare `[]` —
    handle both as end-of-pagination.
    """
    results: list[dict[str, Any]] = []
    pagina = 1
    while True:
        params = {"pagina": pagina, "tamanhoPagina": tamanho_pagina}
        response = client._get(path, params)

        if response.status_code == 404:
            if pagina == 1:
                return []
            raise PncpApiError(f"unexpected 404 on page {pagina} for {path}")

        if response.status_code == 204:
            break

        if response.status_code != 200:
            raise PncpApiError(f"PNCP returned {response.status_code} for {path}")

        page = response.json()
        if not page:
            break
        results.extend(page)
        pagina += 1

    return results


def fetch_itens(
    client: PncpClient, *, orgao_cnpj: str, ano_compra: int, sequencial_compra: int
) -> list[dict[str, Any]]:
    path = f"/v1/orgaos/{orgao_cnpj}/compras/{ano_compra}/{sequencial_compra}/itens"
    return _fetch_bare_array_pages(client, path)


def fetch_arquivos(
    client: PncpClient, *, orgao_cnpj: str, ano_compra: int, sequencial_compra: int
) -> list[dict[str, Any]]:
    path = f"/v1/orgaos/{orgao_cnpj}/compras/{ano_compra}/{sequencial_compra}/arquivos"
    return _fetch_bare_array_pages(client, path)


def _select_pending_licitacoes(
    conn: psycopg.Connection, *, limit: int | None
) -> list[tuple[str, str, int, int]]:
    sql = _SELECT_PENDING_SQL
    params: dict[str, Any] = {}
    if limit is not None:
        sql += " LIMIT %(limit)s"
        params["limit"] = limit
    with conn.cursor() as cur:
        cur.execute(sql, params)
        return cur.fetchall()


def sync_detalhes(
    conn: psycopg.Connection,
    *,
    limit: int | None = None,
    client: PncpClient | None = None,
) -> int:
    """Fetch itens + arquivos for licitações missing either sync stamp.

    Selection: `itens_sincronizados_em IS NULL OR arquivos_sincronizados_em
    IS NULL`, ordered by `data_publicacao_pncp`, optionally capped by
    `limit`. Both `*_sincronizados_em` stamps are set even when the fetched
    array is empty (a valid, distinguishable answer from "never tried"). One
    licitação failing after retries is logged and skipped, not fatal.

    Returns the count of licitações successfully processed (stamped).
    """
    owns_client = client is None
    client = client or PncpClient(base_url=BASE_URL_PNCP)
    processed = 0
    try:
        rows = _select_pending_licitacoes(conn, limit=limit)

        for numero_controle_pncp, orgao_cnpj, ano_compra, sequencial_compra in rows:
            try:
                itens = fetch_itens(
                    client,
                    orgao_cnpj=orgao_cnpj,
                    ano_compra=ano_compra,
                    sequencial_compra=sequencial_compra,
                )
                arquivos = fetch_arquivos(
                    client,
                    orgao_cnpj=orgao_cnpj,
                    ano_compra=ano_compra,
                    sequencial_compra=sequencial_compra,
                )
            except PncpApiError:
                logger.exception(
                    "failed to fetch detalhes for %s, skipping", numero_controle_pncp
                )
                continue

            with conn.cursor() as cur:
                for dto in itens:
                    upsert_item(cur, numero_controle_pncp, dto)
                for dto in arquivos:
                    upsert_documento(cur, numero_controle_pncp, dto)
                cur.execute(
                    "UPDATE licitacao SET itens_sincronizados_em = now(), "
                    "arquivos_sincronizados_em = now(), updated_at = now() "
                    "WHERE numero_controle_pncp = %s",
                    (numero_controle_pncp,),
                )
            conn.commit()
            processed += 1
            logger.info(
                "%s: %d item(ns), %d documento(s)",
                numero_controle_pncp,
                len(itens),
                len(arquivos),
            )
    finally:
        if owns_client:
            client.close()

    return processed
