# /// script
# requires-python = ">=3.12"
# dependencies = []
# ///
"""Orchestrator: runs bench_classify.py, bench_keywords.py, bench_embed.py as
subprocesses (each is its own `uv run` with its own PEP 723 deps), then writes
REPORT.md with per-target scores vs the PRODUCT.md thresholds, cost, and a
GO/NO-GO verdict per target (cycle 26 ml-facets, throwaway — see PRODUCT.md).
"""

from __future__ import annotations

import json
import subprocess
from pathlib import Path

HERE = Path(__file__).resolve().parent
DATA_DIR = HERE / "data"
RESULTS_DIR = HERE / "results"
REPORT_PATH = HERE / "REPORT.md"

# Assumed VPS compute rate for the ML $/1k estimate — no GPU, no API, just CPU
# time; this is a rough order-of-magnitude, not a billed number (state the
# assumption in the report).
ASSUMED_USD_PER_CPU_HOUR = 0.05

# (script, required data files, results file it writes)
BENCHES: list[tuple[str, list[str], str]] = [
    (
        "bench_classify.py",
        ["enrichments.csv", "procurements.csv", "items.csv", "doc_texts.csv", "categories.csv", "cnaes.csv"],
        "classify.json",
    ),
    (
        "bench_keywords.py",
        ["enrichments.csv", "procurements.csv", "items.csv", "doc_texts.csv"],
        "keywords.json",
    ),
    (
        "bench_embed.py",
        ["embeddings.csv", "summaries.csv", "enrichments.csv", "categories.csv"],
        "embed.json",
    ),
]

# (report target, score path in results dict, threshold, label)
THRESHOLDS: list[tuple[str, str, str, str, float]] = [
    ("cnae", "classify", "top3_agreement", "CNAE top-3 agreement", 0.80),
    ("categories", "classify", "micro_f1", "categories micro-F1", 0.80),
    ("requires_certification", "classify", "f1_positive", "flag F1", 0.80),
    ("requires_technical_certificate", "classify", "f1_positive", "flag F1", 0.80),
    ("complexity", "classify", "macro_f1", "complexity macro-F1", 0.80),
    ("keywords", "keywords", "mean_jaccard", "keywords mean Jaccard (best of YAKE/TF-IDF)", 0.50),
    ("embeddings", "embed", "procurement_overlap_mean", "procurement->procurement top-10 overlap", 0.70),
]


def run_bench(script: str, required: list[str]) -> None:
    missing = [f for f in required if not (DATA_DIR / f).exists()]
    if missing:
        print(f"WARNING: skipping {script} — missing data files: {', '.join(missing)}", flush=True)
        return
    print(f"--- running {script} ---", flush=True)
    subprocess.run(["uv", "run", str(HERE / script)], check=True)


def load_json(name: str) -> dict | None:
    path = RESULTS_DIR / name
    if not path.exists():
        return None
    return json.loads(path.read_text())


def llm_cost_per_1k() -> tuple[str, dict]:
    path = DATA_DIR / "llm_cost.csv"
    if not path.exists():
        return "no priced runs (llm_cost.csv missing)", {}

    import csv

    total_micros = 0
    total_processed = 0
    total_prompt_tokens = 0
    n_runs = 0
    with path.open(newline="") as fh:
        for row in csv.DictReader(fh):
            try:
                counters = json.loads(row["counters"])
            except (json.JSONDecodeError, TypeError):
                continue
            n_runs += 1
            total_micros += counters.get("llm_est_usd_micros", 0) or 0
            total_processed += counters.get("processed", 0) or 0
            total_prompt_tokens += counters.get("llm_prompt_tokens", 0) or 0

    if n_runs == 0 or total_processed == 0:
        return "no priced runs", {}

    usd_per_1k = (total_micros / 1_000_000) / total_processed * 1000
    detail = {
        "n_runs": n_runs,
        "total_processed": total_processed,
        "total_est_usd": round(total_micros / 1_000_000, 4),
        "usd_per_1k": round(usd_per_1k, 4),
        "avg_prompt_tokens": round(total_prompt_tokens / total_processed, 1) if total_processed else None,
    }
    return f"US$ {usd_per_1k:.4f} / 1,000 procurements (from {n_runs} priced runs, {total_processed} processed)", detail


def ml_cost_per_1k(ms_per_row: float) -> float:
    """ms_per_row * assumed $/CPU-hour, converted to $/1,000 rows."""
    return round(ms_per_row * ASSUMED_USD_PER_CPU_HOUR / 3600, 6)


def build_rows(classify: dict | None, keywords: dict | None, embed: dict | None) -> list[dict]:
    sources = {"classify": classify, "keywords": keywords, "embed": embed}
    rows: list[dict] = []
    for target, source_name, score_key, label, threshold in THRESHOLDS:
        source = sources[source_name]
        if source is None:
            rows.append(
                {
                    "target": target,
                    "metric": label,
                    "score": None,
                    "threshold": threshold,
                    "coverage": None,
                    "ms_per_row": None,
                    "verdict": "SKIP (no data)",
                }
            )
            continue

        if source_name == "keywords":
            best = max(
                (source.get("yake") or {}), (source.get("tfidf") or {}), key=lambda m: m.get(score_key) or 0
            )
            score = best.get(score_key)
            ms_per_row = best.get("ms_per_row")
            coverage = None
        else:
            metrics = source.get(target, {}) if source_name == "classify" else source
            if not isinstance(metrics, dict) or "skipped" in metrics:
                rows.append(
                    {
                        "target": target,
                        "metric": label,
                        "score": None,
                        "threshold": threshold,
                        "coverage": None,
                        "ms_per_row": None,
                        "verdict": f"SKIP ({metrics.get('skipped', 'no data')})"
                        if isinstance(metrics, dict)
                        else "SKIP (no data)",
                    }
                )
                continue
            score = metrics.get(score_key)
            ms_per_row = metrics.get("ms_per_row")
            coverage = metrics.get("coverage")

        verdict = "GO" if isinstance(score, (int, float)) and score >= threshold else "NO-GO"
        rows.append(
            {
                "target": target,
                "metric": label,
                "score": score,
                "threshold": threshold,
                "coverage": coverage,
                "ms_per_row": ms_per_row,
                "verdict": verdict,
            }
        )
    return rows


def render_table(rows: list[dict]) -> str:
    header = "| target | metric | score | threshold | coverage | ms/row | verdict |"
    sep = "|---|---|---|---|---|---|---|"
    lines = [header, sep]
    for r in rows:
        score = f"{r['score']:.4f}" if isinstance(r["score"], (int, float)) else "N/A"
        coverage = f"{r['coverage']:.4f}" if isinstance(r["coverage"], (int, float)) else "N/A"
        ms = f"{r['ms_per_row']:.3f}" if isinstance(r["ms_per_row"], (int, float)) else "N/A"
        lines.append(
            f"| {r['target']} | {r['metric']} | {score} | {r['threshold']} | {coverage} | {ms} | {r['verdict']} |"
        )
    return "\n".join(lines)


def render_report(rows: list[dict], classify: dict | None, keywords: dict | None, embed: dict | None,
                   llm_cost_line: str, llm_detail: dict) -> str:
    table = render_table(rows)

    cloud_rows = local_rows = test_rows = None
    for source in (classify, keywords):
        if source is None:
            continue
        if "cnae" in source:
            probe = source["cnae"]
        else:
            probe = source
        cloud_rows = probe.get("cloud_rows", cloud_rows)
        local_rows = probe.get("local_rows", local_rows)
        test_rows = probe.get("test_rows", test_rows)

    ml_cost_lines = []
    for r in rows:
        if isinstance(r["ms_per_row"], (int, float)):
            cost = ml_cost_per_1k(r["ms_per_row"])
            ml_cost_lines.append(f"  - {r['target']}: US$ {cost:.6f} / 1,000 rows (ms/row = {r['ms_per_row']})")

    data_section = f"""## Data

- Cloud-labelled (LLM-truth) procurements: {cloud_rows}
- Local-labelled (old Ollama model, ~45% hallucinated per manual review): {local_rows}
- Cloud-only held-out test split size: {test_rows}
- `catalog_code` baseline: impossible — the column is NULL for every row in prod today (PNCP never populated it).
"""

    notes_section = """## Notes

- `catalog_code` baseline is impossible: `procurement_items.catalog_code` is NULL for every row pulled from prod (PNCP never populated it), so there is no free CATMAT/CATSER label to compare against.
- "Agreement with LLM" is not ground truth — every score in this report measures whether cheap ML reproduces what the LLM already said, not whether the LLM itself was correct. A classifier that perfectly mimics a wrong LLM label would still score 1.0 here.
- `categories` is not a closed label set: the pulled data has ~5,995 distinct raw free-form category strings across ~930 cloud-labelled procurements, i.e. most categories appear once. This makes `categories` structurally ill-posed for a multi-label classifier — no amount of tuning fixes an open vocabulary with this little repetition per label.
- `profiles.csv` (company_profiles) is empty in prod (no company ever ran match), so the profile-to-procurement metric is replaced with 20 synthetic pt-BR product phrases; the resulting "hit-rate" is a term-overlap sanity check in local embedding space only, not a real profile benchmark, and carries no threshold.

### What would make ML viable

- **CNAE / categories / complexity / flags**: the limiting factor is label volume (only 930 cloud-labelled rows total, ~744 in the training split) plus, for `categories` specifically, an open label vocabulary. A canonical, closed category taxonomy (a fixed list instead of free-form LLM output) plus ≥5,000 cloud-labelled rows per target would let a TF-IDF/linear baseline be re-evaluated meaningfully; right now every target is starved of examples per class.
- **Embeddings**: nearest-neighbour label transfer (encode locally, then borrow the LLM label of the nearest already-labelled procurement in embedding space) could substitute for a supervised classifier once the local model's neighbourhoods are validated — but that requires the local model to already reproduce useful structure, which this report also measures.
- None of this is a same-cycle fix: it needs either more enrichment volume or a data-model change (canonical taxonomy), both out of scope for cycle 26.
"""

    reproduce_section = f"""## Reproduce

```
uv run experiments/ml-facets/pull.py             # 137
uv run experiments/ml-facets/pull_summaries.py   # 139, summary column for the embed bench
uv run experiments/ml-facets/bench.py            # 138 + 139, runs all three benches
```

Assumed VPS compute rate for the ML cost estimate: US$ {ASSUMED_USD_PER_CPU_HOUR}/CPU-hour.
"""

    return f"""# ml-facets: ML vs LLM benchmark report (cycle 26)

Throwaway benchmark under `experiments/ml-facets/`; see `PRODUCT.md` for the full story.
Every score below measures agreement with the LLM's own labels (not ground truth) on the
cloud-labelled held-out test split.

{data_section}
## Results

{table}

## Cost

- LLM (today): {llm_cost_line}
- ML (compute only, no API cost):
{chr(10).join(ml_cost_lines) if ml_cost_lines else "  N/A — no ms/row available"}

{notes_section}
{reproduce_section}
"""


def print_table(rows: list[dict]) -> None:
    print(render_table(rows))


def main() -> None:
    RESULTS_DIR.mkdir(exist_ok=True)

    for script, required, _out in BENCHES:
        run_bench(script, required)

    classify = load_json("classify.json")
    keywords = load_json("keywords.json")
    embed = load_json("embed.json")

    llm_cost_line, llm_detail = llm_cost_per_1k()

    rows = build_rows(classify, keywords, embed)
    print_table(rows)

    report = render_report(rows, classify, keywords, embed, llm_cost_line, llm_detail)
    REPORT_PATH.write_text(report)
    print(f"\nwrote {REPORT_PATH}")


if __name__ == "__main__":
    main()
