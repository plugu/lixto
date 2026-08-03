"""`plic sync publicacao` — pages PNCP's `/contratacoes/publicacao` per
modalidade for a date range and upserts each licitação into Postgres.

mvp mode: one straight-line sync function, no backfill/watermark orchestration
(that's ticket 04) and no items/arquivos fetching (ticket 03) — those stamps
are just nulled here so a later ticket knows to re-fetch them.
"""

from __future__ import annotations

import logging
from collections.abc import Iterable
from datetime import date
from typing import Any

import psycopg
from psycopg.types.json import Json

from plic.pncp_client import PncpClient

logger = logging.getLogger(__name__)

ALL_MODALIDADES: list[int] = list(range(1, 14))  # 1..13, see docs/PNCP_API.md

_UPSERT_SQL = """
INSERT INTO licitacao (
    numero_controle_pncp, ano_compra, sequencial_compra, numero_compra, processo,
    orgao_cnpj, orgao_razao_social, poder_id, esfera_id,
    unidade_codigo, unidade_nome, uf, municipio_nome, codigo_ibge,
    modalidade_id, modalidade_nome, modo_disputa_id, modo_disputa_nome,
    situacao_compra_id, situacao_compra_nome,
    tipo_instrumento_convocatorio_codigo, tipo_instrumento_convocatorio_nome,
    amparo_legal_codigo, amparo_legal_nome,
    objeto_compra, informacao_complementar, srp,
    valor_total_estimado, valor_total_homologado,
    data_abertura_proposta, data_encerramento_proposta,
    data_publicacao_pncp, data_inclusao, data_atualizacao, data_atualizacao_global,
    link_sistema_origem, link_processo_eletronico, fontes_orcamentarias, usuario_nome,
    raw
) VALUES (
    %(numero_controle_pncp)s, %(ano_compra)s, %(sequencial_compra)s, %(numero_compra)s,
    %(processo)s,
    %(orgao_cnpj)s, %(orgao_razao_social)s, %(poder_id)s, %(esfera_id)s,
    %(unidade_codigo)s, %(unidade_nome)s, %(uf)s, %(municipio_nome)s, %(codigo_ibge)s,
    %(modalidade_id)s, %(modalidade_nome)s, %(modo_disputa_id)s, %(modo_disputa_nome)s,
    %(situacao_compra_id)s, %(situacao_compra_nome)s,
    %(tipo_instrumento_convocatorio_codigo)s, %(tipo_instrumento_convocatorio_nome)s,
    %(amparo_legal_codigo)s, %(amparo_legal_nome)s,
    %(objeto_compra)s, %(informacao_complementar)s, %(srp)s,
    %(valor_total_estimado)s, %(valor_total_homologado)s,
    %(data_abertura_proposta)s, %(data_encerramento_proposta)s,
    %(data_publicacao_pncp)s, %(data_inclusao)s, %(data_atualizacao)s,
    %(data_atualizacao_global)s,
    %(link_sistema_origem)s, %(link_processo_eletronico)s, %(fontes_orcamentarias)s,
    %(usuario_nome)s,
    %(raw)s
)
ON CONFLICT (numero_controle_pncp) DO UPDATE SET
    ano_compra = EXCLUDED.ano_compra,
    sequencial_compra = EXCLUDED.sequencial_compra,
    numero_compra = EXCLUDED.numero_compra,
    processo = EXCLUDED.processo,
    orgao_cnpj = EXCLUDED.orgao_cnpj,
    orgao_razao_social = EXCLUDED.orgao_razao_social,
    poder_id = EXCLUDED.poder_id,
    esfera_id = EXCLUDED.esfera_id,
    unidade_codigo = EXCLUDED.unidade_codigo,
    unidade_nome = EXCLUDED.unidade_nome,
    uf = EXCLUDED.uf,
    municipio_nome = EXCLUDED.municipio_nome,
    codigo_ibge = EXCLUDED.codigo_ibge,
    modalidade_id = EXCLUDED.modalidade_id,
    modalidade_nome = EXCLUDED.modalidade_nome,
    modo_disputa_id = EXCLUDED.modo_disputa_id,
    modo_disputa_nome = EXCLUDED.modo_disputa_nome,
    situacao_compra_id = EXCLUDED.situacao_compra_id,
    situacao_compra_nome = EXCLUDED.situacao_compra_nome,
    tipo_instrumento_convocatorio_codigo = EXCLUDED.tipo_instrumento_convocatorio_codigo,
    tipo_instrumento_convocatorio_nome = EXCLUDED.tipo_instrumento_convocatorio_nome,
    amparo_legal_codigo = EXCLUDED.amparo_legal_codigo,
    amparo_legal_nome = EXCLUDED.amparo_legal_nome,
    objeto_compra = EXCLUDED.objeto_compra,
    informacao_complementar = EXCLUDED.informacao_complementar,
    srp = EXCLUDED.srp,
    valor_total_estimado = EXCLUDED.valor_total_estimado,
    valor_total_homologado = EXCLUDED.valor_total_homologado,
    data_abertura_proposta = EXCLUDED.data_abertura_proposta,
    data_encerramento_proposta = EXCLUDED.data_encerramento_proposta,
    data_publicacao_pncp = EXCLUDED.data_publicacao_pncp,
    data_inclusao = EXCLUDED.data_inclusao,
    data_atualizacao = EXCLUDED.data_atualizacao,
    data_atualizacao_global = EXCLUDED.data_atualizacao_global,
    link_sistema_origem = EXCLUDED.link_sistema_origem,
    link_processo_eletronico = EXCLUDED.link_processo_eletronico,
    fontes_orcamentarias = EXCLUDED.fontes_orcamentarias,
    usuario_nome = EXCLUDED.usuario_nome,
    raw = EXCLUDED.raw,
    itens_sincronizados_em = NULL,
    arquivos_sincronizados_em = NULL,
    updated_at = now()
WHERE EXCLUDED.data_atualizacao_global > licitacao.data_atualizacao_global
"""


def row_from_publicacao_dto(dto: dict[str, Any]) -> dict[str, Any]:
    """Flatten one `RecuperarCompraPublicacaoDTO` into `licitacao` row params.

    Nested `orgaoEntidade`/`unidadeOrgao`/`amparoLegal` objects are flattened;
    everything else (including these nested objects) is preserved verbatim in
    `raw`. Optional fields (e.g. proposal window dates, absent for dispensa/
    inexigibilidade) map to `None` when missing.
    """
    orgao = dto.get("orgaoEntidade") or {}
    unidade = dto.get("unidadeOrgao") or {}
    amparo = dto.get("amparoLegal") or {}

    amparo_codigo = amparo.get("codigo")

    return {
        "numero_controle_pncp": dto["numeroControlePNCP"],
        "ano_compra": dto.get("anoCompra"),
        "sequencial_compra": dto.get("sequencialCompra"),
        "numero_compra": dto.get("numeroCompra"),
        "processo": dto.get("processo"),
        "orgao_cnpj": orgao.get("cnpj"),
        "orgao_razao_social": orgao.get("razaoSocial"),
        "poder_id": orgao.get("poderId"),
        "esfera_id": orgao.get("esferaId"),
        "unidade_codigo": unidade.get("codigoUnidade"),
        "unidade_nome": unidade.get("nomeUnidade"),
        "uf": unidade.get("ufSigla"),
        "municipio_nome": unidade.get("municipioNome"),
        "codigo_ibge": unidade.get("codigoIbge"),
        "modalidade_id": dto.get("modalidadeId"),
        "modalidade_nome": dto.get("modalidadeNome"),
        "modo_disputa_id": dto.get("modoDisputaId"),
        "modo_disputa_nome": dto.get("modoDisputaNome"),
        "situacao_compra_id": dto.get("situacaoCompraId"),
        "situacao_compra_nome": dto.get("situacaoCompraNome"),
        "tipo_instrumento_convocatorio_codigo": dto.get(
            "tipoInstrumentoConvocatorioCodigo"
        ),
        "tipo_instrumento_convocatorio_nome": dto.get(
            "tipoInstrumentoConvocatorioNome"
        ),
        "amparo_legal_codigo": str(amparo_codigo) if amparo_codigo is not None else None,
        "amparo_legal_nome": amparo.get("nome"),
        "objeto_compra": dto.get("objetoCompra"),
        "informacao_complementar": dto.get("informacaoComplementar"),
        "srp": dto.get("srp"),
        "valor_total_estimado": dto.get("valorTotalEstimado"),
        "valor_total_homologado": dto.get("valorTotalHomologado"),
        "data_abertura_proposta": dto.get("dataAberturaProposta"),
        "data_encerramento_proposta": dto.get("dataEncerramentoProposta"),
        "data_publicacao_pncp": dto.get("dataPublicacaoPncp"),
        "data_inclusao": dto.get("dataInclusao"),
        "data_atualizacao": dto.get("dataAtualizacao"),
        "data_atualizacao_global": dto.get("dataAtualizacaoGlobal"),
        "link_sistema_origem": dto.get("linkSistemaOrigem"),
        "link_processo_eletronico": dto.get("linkProcessoEletronico"),
        "fontes_orcamentarias": Json(dto.get("fontesOrcamentarias") or []),
        "usuario_nome": dto.get("usuarioNome"),
        "raw": Json(dto),
    }


def upsert_licitacao(cursor: psycopg.Cursor, dto: dict[str, Any]) -> None:
    """Map one publicacao DTO to a row and upsert it (freshness-guarded)."""
    row = row_from_publicacao_dto(dto)
    cursor.execute(_UPSERT_SQL, row)


def sync_publicacao(
    conn: psycopg.Connection,
    *,
    data_inicial: date,
    data_final: date,
    modalidades: Iterable[int] = ALL_MODALIDADES,
    client: PncpClient | None = None,
) -> dict[int, int]:
    """Page `/contratacoes/publicacao` for each modalidade and upsert results.

    Returns `{modalidade: totalRegistros}` as last reported by the API for
    that modalidade (same value on every page).
    """
    owns_client = client is None
    client = client or PncpClient()
    totals: dict[int, int] = {}
    try:
        for modalidade in modalidades:
            total_registros = 0
            for page in client.iter_publicacao_pages(
                data_inicial=data_inicial.strftime("%Y%m%d"),
                data_final=data_final.strftime("%Y%m%d"),
                codigo_modalidade_contratacao=modalidade,
            ):
                total_registros = page.get("totalRegistros", 0)
                with conn.cursor() as cur:
                    for dto in page.get("data", []):
                        upsert_licitacao(cur, dto)
                conn.commit()
                numero_pagina = page.get("numeroPagina", 0)
                total_paginas = page.get("totalPaginas", 0)
                if numero_pagina == 1 or numero_pagina % 25 == 0 or numero_pagina == total_paginas:
                    logger.info(
                        "modalidade %d: page %d/%d (%d rows this page, %d total in range)",
                        modalidade,
                        numero_pagina,
                        total_paginas,
                        len(page.get("data", [])),
                        total_registros,
                    )
            totals[modalidade] = total_registros
            logger.info("modalidade %d: totalRegistros=%d", modalidade, total_registros)
    finally:
        if owns_client:
            client.close()
    return totals
