# /// script
# requires-python = ">=3.12"
# dependencies = []
# ///
"""Pull LLM-labelled prod tables into experiments/ml-facets/data/*.csv (read-only, cycle 26).

Usage:
    uv run experiments/ml-facets/pull.py            # pulls all tables, prints counts + gate
    uv run experiments/ml-facets/pull.py --dry-run   # prints the SQL for every file, touches nothing

Exit codes:
    0  success (>= 1,000 labelled procurements)
    2  fewer than 1,000 labelled procurements — see REPORT.md
    3  Tailscale is in "check mode" — a human must open the printed URL, then re-run
"""

from __future__ import annotations

import argparse
import csv
import re
import subprocess
import sys
from collections import Counter
from pathlib import Path

SSH_HOST = "plugu-prod01"
DATA_DIR = Path(__file__).parent / "data"

# Every table is scoped to procurements with a 'done' enrichment row (except profiles,
# which is a global table with no procurement scope) — see tickets/137-mlbench-pull-data.md.
TABLE_SPECS: list[tuple[str, str]] = [
    (
        "enrichments",
        (
            "SELECT procurement_id, model, input_kind, confidence, concepts, keywords, complexity, "
            "requires_certification, requires_technical_certificate, enriched_at "
            "FROM procurement_enrichments WHERE status = 'done'"
        ),
    ),
    (
        "categories",
        (
            "SELECT c.procurement_id, c.category FROM procurement_categories c "
            "JOIN procurement_enrichments e ON e.procurement_id = c.procurement_id AND e.status = 'done'"
        ),
    ),
    (
        "cnaes",
        (
            "SELECT c.procurement_id, c.cnae_code, c.confidence FROM procurement_cnaes c "
            "JOIN procurement_enrichments e ON e.procurement_id = c.procurement_id AND e.status = 'done'"
        ),
    ),
    (
        "requirements",
        (
            "SELECT r.procurement_id, r.kind FROM procurement_requirements r "
            "JOIN procurement_enrichments e ON e.procurement_id = r.procurement_id AND e.status = 'done'"
        ),
    ),
    (
        "procurements",
        (
            "SELECT p.id, p.source_id, p.modality_id, p.modality_name, p.description, p.estimated_value "
            "FROM procurements p "
            "JOIN procurement_enrichments e ON e.procurement_id = p.id AND e.status = 'done'"
        ),
    ),
    (
        "items",
        (
            "SELECT i.procurement_id, i.item_number, i.description, i.kind, i.catalog_code, i.ncm_nbs_code "
            "FROM procurement_items i "
            "JOIN procurement_enrichments e ON e.procurement_id = i.procurement_id AND e.status = 'done'"
        ),
    ),
    (
        "doc_texts",
        (
            "SELECT t.procurement_id, t.sequence, t.chars, left(t.text, 20000) AS text "
            "FROM procurement_document_texts t "
            "JOIN procurement_enrichments e ON e.procurement_id = t.procurement_id AND e.status = 'done' "
            "WHERE t.method = 'pypdf' AND t.chars > 500"
        ),
    ),
    (
        "embeddings",
        (
            "SELECT em.procurement_id, em.model, em.embedding::text FROM procurement_embeddings em "
            "JOIN procurement_enrichments e ON e.procurement_id = em.procurement_id AND e.status = 'done'"
        ),
    ),
    (
        "profiles",
        (
            "SELECT company_id, terms, exclusion_terms, embedding_text, embedding::text "
            "FROM company_profiles"
        ),
    ),
    (
        "llm_cost",
        (
            "SELECT kind, started_at, counters::text FROM agent_runs "
            "WHERE (kind LIKE 'enrich%' OR kind LIKE 'analyze%') AND status = 'done'"
        ),
    ),
]


def build_copy_sql(select_sql: str) -> str:
    return f"COPY ({select_sql}) TO STDOUT WITH CSV HEADER"


def tailscale_reachable(timeout: int = 15) -> bool:
    try:
        subprocess.run(
            ["ssh", "-o", "BatchMode=yes", "-o", "ConnectTimeout=10", SSH_HOST, "true"],
            timeout=timeout,
            check=True,
            capture_output=True,
        )
        return True
    except (subprocess.TimeoutExpired, subprocess.CalledProcessError):
        return False


def tailscale_login_url() -> str | None:
    proc = subprocess.run(
        ["ssh", "-vvv", SSH_HOST, "true"],
        capture_output=True,
        text=True,
        timeout=20,
        check=False,
    )
    combined = proc.stdout + proc.stderr
    match = re.search(r"https://login\.tailscale\.com/a/[A-Za-z0-9]+", combined)
    return match.group(0) if match else None


def pull_table(select_sql: str, dest: Path) -> int:
    copy_sql = build_copy_sql(select_sql)
    # Identifiers here are all plain lowercase; SQL string literals use single quotes only,
    # so the whole COPY statement is safe to wrap in double quotes for psql -c.
    remote_cmd = (
        "set -euo pipefail; "
        "CID=$(docker ps -qf name=pg-shared); "
        f'docker exec "$CID" psql -U shared -d lixto -c "{copy_sql}"'
    )
    with dest.open("wb") as fh:
        subprocess.run(
            ["ssh", "-o", "BatchMode=yes", SSH_HOST, remote_cmd],
            stdout=fh,
            check=True,
        )
    with dest.open(newline="") as fh:
        # Fields (e.g. doc_texts.text) can contain embedded newlines inside CSV quoting,
        # so a naive line count overcounts — use csv.reader to count real records.
        return max(sum(1 for _ in csv.reader(fh)) - 1, 0)  # minus header row


def is_cloud_model(model: str) -> bool:
    return model.startswith(("gemini-", "gpt-"))


def write_insufficient_report(total: int, model_counts: Counter[str]) -> None:
    breakdown = "\n".join(f"- {model}: {count}" for model, count in model_counts.most_common())
    report = Path(__file__).parent / "REPORT.md"
    report.write_text(
        "# ml-facets: insufficient data\n\n"
        f"Only {total} procurements have a `done` enrichment row, below the 1,000-row floor "
        "set in PRODUCT.md for this benchmark. Per-model breakdown of pulled rows:\n\n"
        f"{breakdown}\n\n"
        "Let more `enrich-run` schedules complete in prod, then re-run "
        "`uv run experiments/ml-facets/pull.py`.\n"
    )


def gate_check(enrichments_csv: Path) -> int:
    model_counts: Counter[str] = Counter()
    procurement_ids: set[str] = set()
    with enrichments_csv.open(newline="") as fh:
        for row in csv.DictReader(fh):
            procurement_ids.add(row["procurement_id"])
            model_counts[row["model"] or "(null)"] += 1

    total = len(procurement_ids)
    cloud_rows = sum(count for model, count in model_counts.items() if is_cloud_model(model))

    print(f"\nenrichments: {total} distinct procurement_id ({sum(model_counts.values())} rows)")
    for model, count in model_counts.most_common():
        flag = "cloud" if is_cloud_model(model) else "local"
        print(f"  {model}: {count} ({flag})")

    if cloud_rows < 1000:
        print(f"WARNING: only {cloud_rows} cloud-labelled rows (<1000) — most rows are local/hallucinated")

    if total < 1000:
        write_insufficient_report(total, model_counts)
        print(f"ERROR: only {total} labelled procurements (<1000) — see REPORT.md")
        return 2

    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--dry-run", action="store_true", help="Print the SQL for every file; touch nothing."
    )
    args = parser.parse_args()

    if args.dry_run:
        for name, select_sql in TABLE_SPECS:
            print(f"-- {name}.csv --")
            print(build_copy_sql(select_sql))
            print()
        return 0

    if not tailscale_reachable():
        url = tailscale_login_url()
        if url:
            print(f"Tailscale is in check mode. A human must open this URL, then re-run:\n{url}")
        else:
            print(
                "Tailscale is in check mode and no login URL could be extracted. "
                f"Run `ssh -vvv {SSH_HOST} true` manually and look for the login.tailscale.com URL."
            )
        return 3

    DATA_DIR.mkdir(parents=True, exist_ok=True)
    print(f"Pulling {len(TABLE_SPECS)} tables from {SSH_HOST} (pg-shared/lixto) into {DATA_DIR} ...")
    for name, select_sql in TABLE_SPECS:
        dest = DATA_DIR / f"{name}.csv"
        rows = pull_table(select_sql, dest)
        print(f"  {name}.csv: {rows} rows")

    return gate_check(DATA_DIR / "enrichments.csv")


if __name__ == "__main__":
    try:
        sys.exit(main())
    except subprocess.CalledProcessError as exc:
        print(f"ERROR: remote command failed (exit {exc.returncode}): {exc}", file=sys.stderr)
        sys.exit(1)
