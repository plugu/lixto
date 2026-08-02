"""`plic` CLI entrypoint (typer)."""

import logging
from datetime import date

import typer

from plic import db
from plic.sync_detalhes import sync_detalhes
from plic.sync_publicacao import ALL_MODALIDADES, sync_publicacao

_DATA_INICIAL_OPTION = typer.Option(..., "--data-inicial", help="YYYY-MM-DD")
_DATA_FINAL_OPTION = typer.Option(..., "--data-final", help="YYYY-MM-DD")
_MODALIDADE_OPTION = typer.Option(
    [],
    "--modalidade",
    help="Modalidade code(s) to sync; repeatable. Default: all 13 modalidades.",
)
_LIMIT_OPTION = typer.Option(
    None,
    "--limit",
    help="Max licitações to process; default no limit.",
)

app = typer.Typer(help="plic — PNCP ingestion agent")
db_app = typer.Typer(help="Database commands")
app.add_typer(db_app, name="db")
sync_app = typer.Typer(help="Sync commands")
app.add_typer(sync_app, name="sync")

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")


@db_app.command("init")
def db_init() -> None:
    """Apply all pending SQL migrations (idempotent)."""
    conn = db.get_connection()
    try:
        applied = db.run_migrations(conn)
    finally:
        conn.close()

    if applied:
        typer.echo(f"Applied {len(applied)} migration(s): {', '.join(applied)}")
    else:
        typer.echo("No pending migrations. Database is up to date.")


@sync_app.command("publicacao")
def sync_publicacao_cmd(
    data_inicial: str = _DATA_INICIAL_OPTION,
    data_final: str = _DATA_FINAL_OPTION,
    modalidade: list[int] = _MODALIDADE_OPTION,
) -> None:
    """Page PNCP's publicacao endpoint for a date range and upsert into Postgres."""
    modalidades = modalidade or ALL_MODALIDADES

    conn = db.get_connection()
    try:
        totals = sync_publicacao(
            conn,
            data_inicial=date.fromisoformat(data_inicial),
            data_final=date.fromisoformat(data_final),
            modalidades=modalidades,
        )
    finally:
        conn.close()

    for modalidade_id, total in totals.items():
        typer.echo(f"modalidade {modalidade_id}: totalRegistros={total}")


@sync_app.command("detalhes")
def sync_detalhes_cmd(limit: int = _LIMIT_OPTION) -> None:
    """Fetch items + edital/anexo metadata for licitações missing them."""
    conn = db.get_connection()
    try:
        processed = sync_detalhes(conn, limit=limit)
    finally:
        conn.close()

    typer.echo(f"processed {processed} licitação(ões)")


if __name__ == "__main__":
    app()
