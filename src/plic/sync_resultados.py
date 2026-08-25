"""`plic sync resultados` — drains a user-requested queue of `item` rows
(marked via `resultados_solicitados_em`) and fetches the homologated result
(winner CNPJ + unit price) for each, upserting into `resultado`.

Endpoint (verified live 2026-08-24, HTTP 200, bare JSON array):
    GET /api/pncp/v1/orgaos/{cnpj}/compras/{ano}/{sequencial}/itens/{numeroItem}/resultados

This is deliberately demand-driven, never a speculative backlog crawl: a full
crawl of the ~4.06M homologated items would take ~23 days at PncpClient's
~2 req/s rate limit. Only items with `resultados_solicitados_em IS NOT NULL`
are ever fetched.

Same paging semantics as `sync_detalhes.py`'s itens/arquivos endpoints — a
404 on the first page means "nothing published" (empty list), and both HTTP
204 and a `200 []` page signal end-of-pagination. Reuse the paginator instead
of reimplementing it.

Discovered live 2026-08-24: unlike itens/arquivos, `/resultados` does not
actually implement pagination — page 2+ echoes page 1 forever (HTTP 200,
same content, never empty/204/404). `fetch_resultados` below wraps the
client so the shared paginator still runs unmodified but only ever issues
one real request per item; see `_FirstPageOnly` for the evidence and
reasoning.

`RecuperarCompraItemResultadoDTO` also has a nested `reservaRemanescente`
object (`{codigo, nome}`) — ignored, not stored (no `raw` column here; see
migrations/009_resultado.sql for why).
"""

from __future__ import annotations

import logging
from typing import Any

import httpx
import psycopg

from plic.pncp_client import PncpApiError, PncpClient
from plic.sync_detalhes import _fetch_bare_array_pages

logger = logging.getLogger(__name__)

BASE_URL_PNCP = "https://pncp.gov.br/api/pncp"

_SELECT_PENDING_SQL = """
SELECT i.numero_controle_pncp, i.numero_item,
       l.orgao_cnpj, l.ano_compra, l.sequencial_compra
FROM item i
JOIN licitacao l ON l.numero_controle_pncp = i.numero_controle_pncp
WHERE i.resultados_solicitados_em IS NOT NULL
  AND i.resultados_sincronizados_em IS NULL
ORDER BY i.resultados_solicitados_em ASC
"""

_UPSERT_RESULTADO_SQL = """
INSERT INTO resultado (
    numero_controle_pncp, numero_item, sequencial_resultado,
    ni_fornecedor, nome_razao_social_fornecedor, tipo_pessoa,
    porte_fornecedor_id, porte_fornecedor_nome,
    quantidade_homologada, valor_unitario_homologado, valor_total_homologado,
    percentual_desconto, ordem_classificacao_srp,
    situacao_compra_item_resultado_id, situacao_compra_item_resultado_nome,
    indicador_subcontratacao, data_resultado, data_cancelamento,
    motivo_cancelamento, data_inclusao, data_atualizacao
) VALUES (
    %(numero_controle_pncp)s, %(numero_item)s, %(sequencial_resultado)s,
    %(ni_fornecedor)s, %(nome_razao_social_fornecedor)s, %(tipo_pessoa)s,
    %(porte_fornecedor_id)s, %(porte_fornecedor_nome)s,
    %(quantidade_homologada)s, %(valor_unitario_homologado)s, %(valor_total_homologado)s,
    %(percentual_desconto)s, %(ordem_classificacao_srp)s,
    %(situacao_compra_item_resultado_id)s, %(situacao_compra_item_resultado_nome)s,
    %(indicador_subcontratacao)s, %(data_resultado)s, %(data_cancelamento)s,
    %(motivo_cancelamento)s, %(data_inclusao)s, %(data_atualizacao)s
)
ON CONFLICT (numero_controle_pncp, numero_item, sequencial_resultado) DO UPDATE SET
    ni_fornecedor = EXCLUDED.ni_fornecedor,
    nome_razao_social_fornecedor = EXCLUDED.nome_razao_social_fornecedor,
    tipo_pessoa = EXCLUDED.tipo_pessoa,
    porte_fornecedor_id = EXCLUDED.porte_fornecedor_id,
    porte_fornecedor_nome = EXCLUDED.porte_fornecedor_nome,
    quantidade_homologada = EXCLUDED.quantidade_homologada,
    valor_unitario_homologado = EXCLUDED.valor_unitario_homologado,
    valor_total_homologado = EXCLUDED.valor_total_homologado,
    percentual_desconto = EXCLUDED.percentual_desconto,
    ordem_classificacao_srp = EXCLUDED.ordem_classificacao_srp,
    situacao_compra_item_resultado_id = EXCLUDED.situacao_compra_item_resultado_id,
    situacao_compra_item_resultado_nome = EXCLUDED.situacao_compra_item_resultado_nome,
    indicador_subcontratacao = EXCLUDED.indicador_subcontratacao,
    data_resultado = EXCLUDED.data_resultado,
    data_cancelamento = EXCLUDED.data_cancelamento,
    motivo_cancelamento = EXCLUDED.motivo_cancelamento,
    data_inclusao = EXCLUDED.data_inclusao,
    data_atualizacao = EXCLUDED.data_atualizacao,
    updated_at = now()
"""


def row_from_resultado_dto(numero_controle_pncp: str, dto: dict[str, Any]) -> dict[str, Any]:
    """Flatten one `RecuperarCompraItemResultadoDTO` into `resultado` row
    params. `reservaRemanescente` is a nested `{codigo, nome}` object —
    ignored, not stored."""
    return {
        "numero_controle_pncp": numero_controle_pncp,
        "numero_item": dto["numeroItem"],
        "sequencial_resultado": dto["sequencialResultado"],
        "ni_fornecedor": dto.get("niFornecedor"),
        "nome_razao_social_fornecedor": dto.get("nomeRazaoSocialFornecedor"),
        "tipo_pessoa": dto.get("tipoPessoa"),
        "porte_fornecedor_id": dto.get("porteFornecedorId"),
        "porte_fornecedor_nome": dto.get("porteFornecedorNome"),
        "quantidade_homologada": dto.get("quantidadeHomologada"),
        "valor_unitario_homologado": dto.get("valorUnitarioHomologado"),
        "valor_total_homologado": dto.get("valorTotalHomologado"),
        "percentual_desconto": dto.get("percentualDesconto"),
        "ordem_classificacao_srp": dto.get("ordemClassificacaoSrp"),
        "situacao_compra_item_resultado_id": dto.get("situacaoCompraItemResultadoId"),
        "situacao_compra_item_resultado_nome": dto.get("situacaoCompraItemResultadoNome"),
        "indicador_subcontratacao": dto.get("indicadorSubcontratacao"),
        "data_resultado": dto.get("dataResultado"),
        "data_cancelamento": dto.get("dataCancelamento"),
        "motivo_cancelamento": dto.get("motivoCancelamento"),
        "data_inclusao": dto.get("dataInclusao"),
        "data_atualizacao": dto.get("dataAtualizacao"),
    }


def upsert_resultado(
    cursor: psycopg.Cursor, numero_controle_pncp: str, dto: dict[str, Any]
) -> None:
    row = row_from_resultado_dto(numero_controle_pncp, dto)
    cursor.execute(_UPSERT_RESULTADO_SQL, row)


class _FirstPageOnly:
    """Wraps a `PncpClient` so the shared paginator naturally stops after
    the first real page.

    Verified live 2026-08-24 against both a same-day result
    (42498600000171-1-002592/2026, itens 1-3) and a historical one from
    months earlier (46482865000132-1-000069/2026 item 114, `dataResultado`
    2026-04-15): unlike itens/arquivos, PNCP's `/resultados` endpoint does
    not implement real pagination — pages 2, 3, ... up to 200+ all echo
    page 1's exact content back with HTTP 200, never a 404/204/`200 []`
    the shared paginator would recognize as end-of-data. Reused unmodified,
    `_fetch_bare_array_pages` would loop forever on any item with at least
    one resultado. Since page 2+ never carries new data, short-circuiting
    it here (page 1's content is provably everything there is) is
    correctness-preserving, not a lossy shortcut — the paginator's own
    404/204/`200 []` termination logic is still exercised exactly as
    written, for page 1.
    """

    def __init__(self, client: PncpClient) -> None:
        self._client = client

    def _get(self, path: str, params: dict[str, Any]) -> httpx.Response:
        if params.get("pagina", 1) > 1:
            return httpx.Response(200, json=[])
        return self._client._get(path, params)


def fetch_resultados(
    client: PncpClient,
    *,
    orgao_cnpj: str,
    ano_compra: int,
    sequencial_compra: int,
    numero_item: int,
) -> list[dict[str, Any]]:
    path = (
        f"/v1/orgaos/{orgao_cnpj}/compras/{ano_compra}/{sequencial_compra}"
        f"/itens/{numero_item}/resultados"
    )
    return _fetch_bare_array_pages(_FirstPageOnly(client), path)


def _select_pending_itens(
    conn: psycopg.Connection, *, limit: int | None
) -> list[tuple[str, int, str, int, int]]:
    sql = _SELECT_PENDING_SQL
    params: dict[str, Any] = {}
    if limit is not None:
        sql += " LIMIT %(limit)s"
        params["limit"] = limit
    with conn.cursor() as cur:
        cur.execute(sql, params)
        return cur.fetchall()


def sync_resultados(
    conn: psycopg.Connection,
    *,
    limit: int | None = None,
    client: PncpClient | None = None,
) -> int:
    """Fetch and upsert `resultado` rows for items on the demand queue
    (`item.resultados_solicitados_em IS NOT NULL AND
    item.resultados_sincronizados_em IS NULL`), ordered oldest-requested
    first, optionally capped by `limit`.

    `resultados_sincronizados_em` is stamped even when the fetched array is
    empty (a valid, distinguishable answer from "never tried" — an item with
    genuinely no published result must not be re-fetched forever). One item
    failing after client retries is logged and skipped, not fatal.

    Returns the count of items successfully processed (stamped).
    """
    owns_client = client is None
    client = client or PncpClient(base_url=BASE_URL_PNCP)
    processed = 0
    try:
        rows = _select_pending_itens(conn, limit=limit)

        for numero_controle_pncp, numero_item, orgao_cnpj, ano_compra, sequencial_compra in rows:
            try:
                resultados = fetch_resultados(
                    client,
                    orgao_cnpj=orgao_cnpj,
                    ano_compra=ano_compra,
                    sequencial_compra=sequencial_compra,
                    numero_item=numero_item,
                )
            except PncpApiError:
                logger.exception(
                    "failed to fetch resultados for %s item %s, skipping",
                    numero_controle_pncp,
                    numero_item,
                )
                continue

            with conn.cursor() as cur:
                for dto in resultados:
                    upsert_resultado(cur, numero_controle_pncp, dto)
                cur.execute(
                    "UPDATE item SET resultados_sincronizados_em = now(), "
                    "updated_at = now() "
                    "WHERE numero_controle_pncp = %s AND numero_item = %s",
                    (numero_controle_pncp, numero_item),
                )
            conn.commit()
            processed += 1
            logger.info(
                "%s item %s: %d resultado(s)",
                numero_controle_pncp,
                numero_item,
                len(resultados),
            )
    finally:
        if owns_client:
            client.close()

    return processed
