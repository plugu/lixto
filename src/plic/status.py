"""`plic status` — operator-facing report of the current mirror state.

mvp mode: one straight-line query set, plain text output — no JSON/rich
formatting framework.
"""

from __future__ import annotations

from dataclasses import dataclass, field

import psycopg


@dataclass
class StatusReport:
    total_licitacoes: int
    por_modalidade: dict[int, int] = field(default_factory=dict)
    abertas: int = 0
    futuras: int = 0
    encerradas: int = 0
    pendentes_detalhes: int = 0
    total_itens: int = 0
    total_documentos: int = 0
    data_atualizacao_global_mais_recente: str | None = None


def get_status(conn: psycopg.Connection) -> StatusReport:
    """Gather counts (total/per-modalidade, view rows, pending detalhes,
    item/documento counts, newest data_atualizacao_global) for the report."""
    with conn.cursor() as cur:
        cur.execute("SELECT count(*) FROM licitacao")
        total_licitacoes = cur.fetchone()[0]

        cur.execute(
            "SELECT modalidade_id, count(*) FROM licitacao "
            "GROUP BY modalidade_id ORDER BY modalidade_id"
        )
        por_modalidade = {row[0]: row[1] for row in cur.fetchall()}

        cur.execute("SELECT count(*) FROM v_abertas")
        abertas = cur.fetchone()[0]

        cur.execute("SELECT count(*) FROM v_futuras")
        futuras = cur.fetchone()[0]

        cur.execute("SELECT count(*) FROM v_encerradas")
        encerradas = cur.fetchone()[0]

        cur.execute(
            "SELECT count(*) FROM licitacao "
            "WHERE itens_sincronizados_em IS NULL OR arquivos_sincronizados_em IS NULL"
        )
        pendentes_detalhes = cur.fetchone()[0]

        cur.execute("SELECT count(*) FROM item")
        total_itens = cur.fetchone()[0]

        cur.execute("SELECT count(*) FROM documento")
        total_documentos = cur.fetchone()[0]

        cur.execute("SELECT max(data_atualizacao_global) FROM licitacao")
        newest = cur.fetchone()[0]

    return StatusReport(
        total_licitacoes=total_licitacoes,
        por_modalidade=por_modalidade,
        abertas=abertas,
        futuras=futuras,
        encerradas=encerradas,
        pendentes_detalhes=pendentes_detalhes,
        total_itens=total_itens,
        total_documentos=total_documentos,
        data_atualizacao_global_mais_recente=newest.isoformat() if newest else None,
    )


def format_status(report: StatusReport) -> str:
    lines = [
        f"total licitações: {report.total_licitacoes}",
        "por modalidade:",
    ]
    for modalidade_id, count in sorted(report.por_modalidade.items()):
        lines.append(f"  {modalidade_id}: {count}")
    lines += [
        f"abertas: {report.abertas}",
        f"futuras: {report.futuras}",
        f"encerradas: {report.encerradas}",
        f"pendentes de detalhes (itens/arquivos): {report.pendentes_detalhes}",
        f"itens: {report.total_itens}",
        f"documentos: {report.total_documentos}",
        f"data_atualizacao_global mais recente: {report.data_atualizacao_global_mais_recente}",
    ]
    return "\n".join(lines)
