"""`plic` CLI entrypoint (typer)."""

import logging
from datetime import date

import typer

from plic import db
from plic.agents.run import run_agents
from plic.backfill import DEFAULT_SINCE
from plic.backfill import backfill as run_backfill
from plic.classify import classify as run_classify
from plic.cnae_match import classify as run_cnae_classify
from plic.cnae_match import eval_pending as run_cnae_eval
from plic.cnae_seed import seed as run_cnae_seed
from plic.schedule import install as schedule_install
from plic.schedule import uninstall as schedule_uninstall
from plic.status import format_status, get_status
from plic.sync_detalhes import sync_detalhes
from plic.sync_incremental import sync_incremental as run_sync_incremental
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
_SINCE_OPTION = typer.Option(
    DEFAULT_SINCE.isoformat(),
    "--since",
    help="YYYY-MM-DD, backfill start date. Default 2026-01-01.",
)
_UNTIL_OPTION = typer.Option(
    None,
    "--until",
    help="YYYY-MM-DD, backfill end date (inclusive). Default today. "
    "Mainly for bounding test/probe runs — a real full backfill omits this.",
)
_INCREMENTAL_SINCE_OPTION = typer.Option(
    None,
    "--since",
    help="YYYY-MM-DD override for modalidades with no watermark yet "
    "(default: bootstrap from the newest data_atualizacao_global in the DB).",
)

app = typer.Typer(help="plic — PNCP ingestion agent")
db_app = typer.Typer(help="Database commands")
app.add_typer(db_app, name="db")
sync_app = typer.Typer(help="Sync commands")
app.add_typer(sync_app, name="sync")
schedule_app = typer.Typer(help="Scheduler commands")
app.add_typer(schedule_app, name="schedule")
agents_app = typer.Typer(help="Agent pipeline commands")
app.add_typer(agents_app, name="agents")
cnae_app = typer.Typer(help="CNAE reference table commands")
app.add_typer(cnae_app, name="cnae")

_MAX_TRIAGE_OPTION = typer.Option(
    200, "--max-triage", help="Max licitações to fit-triage in this run."
)
_MAX_DEEP_OPTION = typer.Option(
    20,
    "--max-deep",
    help="Max licitações to deep-analyze in this run (stub until ticket 14).",
)

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


@app.command("backfill")
def backfill_cmd(
    since: str = _SINCE_OPTION,
    until: str = _UNTIL_OPTION,
    modalidade: list[int] = _MODALIDADE_OPTION,
) -> None:
    """Resumable full backfill: every modalidade x 7-day date chunk from
    `--since` (default 2026-01-01) to `--until` (default today), then fetch
    itens/arquivos for every licitação found. `--until`/`--modalidade` exist
    to bound test/probe runs; a real full backfill is `plic backfill` bare.
    """
    modalidades = modalidade or ALL_MODALIDADES

    conn = db.get_connection()
    try:
        result = run_backfill(
            conn,
            since=date.fromisoformat(since),
            until=date.fromisoformat(until) if until else None,
            modalidades=modalidades,
        )
    finally:
        conn.close()

    typer.echo(
        f"units: {result['units_processed']} processed, "
        f"{result['units_skipped']} skipped, "
        f"{len(result['units_failed'])} failed of {result['units_total']} total; "
        f"detalhes: {result['detalhes_processed']} processed"
    )
    if result["units_failed"]:
        typer.echo("some units failed — re-run `plic backfill` to retry them", err=True)
        raise typer.Exit(1)


_MAX_DETALHES_OPTION = typer.Option(
    5000,
    "--max-detalhes",
    help="Max licitações to fetch detalhes for in this run (0 = unlimited). "
    "Bounds the drain so the watermark phase always runs on schedule.",
)


@sync_app.command("incremental")
def sync_incremental_cmd(
    since: str = _INCREMENTAL_SINCE_OPTION,
    max_detalhes: int = _MAX_DETALHES_OPTION,
) -> None:
    """Twice-daily run: pull everything changed since each modalidade's
    watermark (`/atualizacao`), then fetch itens/arquivos until drained.
    Exits non-zero if any modalidade failed after retries, so the scheduler
    surfaces it — the other modalidades still run to completion first.
    """
    conn = db.get_connection()
    try:
        result = run_sync_incremental(
            conn,
            since=date.fromisoformat(since) if since else None,
            max_detalhes=None if max_detalhes == 0 else max_detalhes,
        )
    finally:
        conn.close()

    typer.echo(
        f"modalidades: {result['modalidades_advanced']}/{result['modalidades_total']} advanced, "
        f"{len(result['modalidades_failed'])} failed; "
        f"rows seen: {result['rows_seen']}; "
        f"detalhes: {result['detalhes_processed']} processed"
    )
    if result["modalidades_failed"]:
        typer.echo(f"FAILED modalidades: {result['modalidades_failed']}", err=True)
        raise typer.Exit(code=1)


@app.command("classify")
def classify_cmd(limit: int = _LIMIT_OPTION) -> None:
    """Classify abertas/futuras licitações into setores (TI, Saúde, Obras...)
    using a local LLM via Ollama (PLIC_OLLAMA_URL / PLIC_CLASSIFY_MODEL).
    Resumable: only rows with setor IS NULL are processed.
    """
    conn = db.get_connection()
    try:
        result = run_classify(conn, limit=limit)
    finally:
        conn.close()
    typer.echo(
        f"classificadas: {result['processed']} "
        f"({result['classified']} pelo modelo, "
        f"{result['processed'] - result['classified']} fallback Outros)"
    )


@cnae_app.command("seed")
def cnae_seed_cmd() -> None:
    """Fetch the IBGE CNAE subclasses list and upsert it into `cnae`
    (idempotent — safe to rerun to refresh descriptions)."""
    conn = db.get_connection()
    try:
        result = run_cnae_seed(conn)
    finally:
        conn.close()
    typer.echo(f"cnae: {result['seeded']} row(s) seeded")


@cnae_app.command("classify")
def cnae_classify_cmd(
    limit: int = _LIMIT_OPTION,
    days: int = typer.Option(
        None, "--days", help="Só licitações com data_publicacao_pncp nos últimos N dias."
    ),
) -> None:
    """Two-stage CNAE tagging of abertas/futuras licitações via Ollama
    (PLIC_OLLAMA_URL / PLIC_CNAE_MODEL). Resumable: only rows with
    cnae_classificado_em IS NULL are processed. If Ollama is unreachable, the
    run aborts leaving the in-flight row unstamped and exits non-zero — a
    later rerun retries it.
    """
    conn = db.get_connection()
    try:
        result = run_cnae_classify(conn, limit=limit, days=days)
    finally:
        conn.close()
    typer.echo(
        f"cnae classify: {result['processed']} processadas, "
        f"{result['tagged']} com tags ({result['tags']} tags totais)"
    )
    if result.get("aborted"):
        typer.echo(
            "Ollama indisponível ou erro na requisição — execução abortada; "
            "linha(s) pendente(s) permanecem na fila",
            err=True,
        )
        raise typer.Exit(code=1)


@cnae_app.command("eval")
def cnae_eval_cmd(
    limit: int = _LIMIT_OPTION,
    days: int = typer.Option(
        None, "--days", help="Só licitações com data_publicacao_pncp nos últimos N dias."
    ),
) -> None:
    """Dry-run evaluation of CNAE tagging via Ollama. Runs the two-stage
    classification on pending licitações but persists nothing — prints
    per licitação: numero_controle_pncp, objeto (truncated 80 chars),
    and each chosen codigo — descricao (confidence). Use to compare model
    quality before fixing the default: run twice with different
    PLIC_CNAE_MODEL values to eyeball results.
    """
    conn = db.get_connection()
    try:
        results = run_cnae_eval(conn, limit=limit, days=days)
    finally:
        conn.close()

    for result in results:
        typer.echo(f"\n{result['numero']}")
        typer.echo(f"  Objeto: {result['objeto'][:80]}")
        if result["tags"]:
            for tag in result["tags"]:
                confidence = f"{tag['confidence']:.2f}" if tag["confidence"] is not None else "N/A"
                typer.echo(f"    {tag['codigo']} — {tag['descricao']} ({confidence})")
        else:
            typer.echo("    (nenhuma tag encontrada)")

    typer.echo(f"\nEvaluadas (sem persistência): {len(results)}")


@app.command("status")
def status_cmd() -> None:
    """Print counts/report of the current mirror state."""
    conn = db.get_connection()
    try:
        report = get_status(conn)
    finally:
        conn.close()

    typer.echo(format_status(report))


@schedule_app.command("install")
def schedule_install_cmd(dry_run: bool = typer.Option(False, "--dry-run")) -> None:
    """Install the macOS launchd job for twice-daily incremental syncs.

    With --dry-run, prints the plist and exits without installing.
    """
    schedule_install(dry_run=dry_run)


@schedule_app.command("uninstall")
def schedule_uninstall_cmd() -> None:
    """Uninstall the macOS launchd job."""
    schedule_uninstall()
    typer.echo("Launchd job uninstalled.")


@agents_app.command("run")
def agents_run_cmd(
    max_triage: int = _MAX_TRIAGE_OPTION,
    max_deep: int = _MAX_DEEP_OPTION,
) -> None:
    """Run the agent pipeline: fit-triage (gpt-5-mini vs. company_profile.md)
    then deep-analysis (stub — ticket 14). Resumable: only licitações without
    an `analise` row are considered.
    """
    conn = db.get_connection()
    try:
        result = run_agents(conn, max_triage=max_triage, max_deep=max_deep)
    finally:
        conn.close()

    typer.echo(
        f"triage: {result['triage_processed']} processed, "
        f"{result['triage_triaged']} triaged; "
        f"deep: {result['deep_processed']} processed"
    )


if __name__ == "__main__":
    app()
