# /// script
# requires-python = ">=3.12"
# dependencies = [
#   "sentence-transformers",
#   "torch",
#   "numpy",
#   "pandas",
#   "scipy",
# ]
# ///
"""Local embedding benchmark: does `intfloat/multilingual-e5-base` on the M4
reproduce the neighbourhood structure of the stored `procurement_embeddings`
vectors (cycle 26 ml-facets, throwaway — see PRODUCT.md)?

`build_embedding_text` below is a **verbatim copy** (not an import) of
`src/lixto/enrich/embed.py:61-77` — the exact text the stored vectors were
computed from, so the comparison is fair. Writes results/embed.json.
"""

from __future__ import annotations

import json
import sys
import time
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd
from scipy.stats import spearmanr

sys.path.insert(0, str(Path(__file__).resolve().parent))
import features as F

MODEL_NAME = "intfloat/multilingual-e5-base"
MODEL_DIM = 768
CACHE_DIR = Path(__file__).resolve().parent / "models"

MAX_PROCUREMENTS = 3000
N_QUERY_SAMPLE = 300
RANDOM_STATE = 42

SYNTHETIC_QUERIES = [
    "notebooks corporativos",
    "serviço de limpeza predial",
    "medicamentos hospitalares",
    "material de escritório",
    "manutenção de veículos",
    "construção civil e reforma",
    "serviços de engenharia elétrica",
    "sistema de informação e software",
    "segurança e vigilância patrimonial",
    "alimentação escolar merenda",
    "equipamentos de laboratório",
    "serviços de telefonia e internet",
    "transporte escolar",
    "mobiliário e equipamentos de escritório",
    "coleta e destinação de resíduos sólidos",
    "gêneros alimentícios",
    "equipamentos de proteção individual EPI",
    "consultoria jurídica",
    "manutenção predial e elétrica",
    "combustíveis e derivados de petróleo",
]


def build_embedding_text(payload_or_row: dict[str, Any]) -> str:
    """Verbatim copy of src/lixto/enrich/embed.py:61-77 — do not diverge."""
    parts: list[str] = []

    summary = payload_or_row.get("summary")
    if isinstance(summary, str) and summary.strip():
        parts.append(summary.strip())

    for key in ("concepts", "keywords", "categories"):
        values = [str(v).strip() for v in (payload_or_row.get(key) or []) if str(v).strip()]
        if values:
            parts.append(", ".join(values))

    return "\n".join(parts)


def parse_pgvector(value: object) -> np.ndarray | None:
    if not isinstance(value, str) or len(value) < 2 or value[0] != "[":
        return None
    return np.array([float(x) for x in value[1:-1].split(",")], dtype=np.float32)


def load_working_set() -> tuple[pd.DataFrame, np.ndarray]:
    """Procurements present in embeddings.csv, joined with summary/concepts/
    keywords/categories, subsampled to MAX_PROCUREMENTS with a fixed seed."""
    embeddings = pd.read_csv(F.DATA_DIR / "embeddings.csv")
    embeddings["vector"] = embeddings["embedding"].apply(parse_pgvector)
    embeddings = embeddings.dropna(subset=["vector"])

    all_pids = F.subsample_ids(embeddings["procurement_id"].unique(), limit=MAX_PROCUREMENTS)
    embeddings = embeddings[embeddings["procurement_id"].isin(all_pids)].drop_duplicates(
        subset="procurement_id"
    )

    summaries = pd.read_csv(F.DATA_DIR / "summaries.csv")
    enrichments = F.load_enrichments()
    categories = F.load_categories()

    cat_by_pid = categories.groupby("procurement_id")["category"].apply(list).to_dict()
    summary_by_pid = summaries.set_index("procurement_id")["summary"].to_dict()
    concepts_by_pid = enrichments.set_index("procurement_id")["concepts_list"].to_dict()
    keywords_by_pid = enrichments.set_index("procurement_id")["keywords_list"].to_dict()

    def _row_to_row(pid: int) -> dict[str, Any]:
        return {
            "summary": summary_by_pid.get(pid),
            "concepts": concepts_by_pid.get(pid, []),
            "keywords": keywords_by_pid.get(pid, []),
            "categories": cat_by_pid.get(pid, []),
        }

    embeddings["text"] = embeddings["procurement_id"].apply(
        lambda pid: build_embedding_text(_row_to_row(int(pid)))
    )
    embeddings = embeddings[embeddings["text"].str.strip() != ""]
    stored = np.stack(embeddings["vector"].to_numpy())
    return embeddings.reset_index(drop=True), stored


def l2_normalize(matrix: np.ndarray) -> np.ndarray:
    norms = np.linalg.norm(matrix, axis=1, keepdims=True)
    norms[norms == 0] = 1.0
    return matrix / norms


def top_k_neighbours(sim_row: np.ndarray, self_idx: int, k: int = 10) -> set[int]:
    sim_row = sim_row.copy()
    sim_row[self_idx] = -np.inf
    return set(np.argsort(-sim_row)[:k].tolist())


def pick_device() -> str:
    import torch

    if torch.backends.mps.is_available():
        return "mps"
    return "cpu"


def main() -> None:
    F.RESULTS_DIR.mkdir(exist_ok=True)
    CACHE_DIR.mkdir(exist_ok=True)

    df, stored_matrix = load_working_set()
    n = len(df)
    print(f"working set: {n} procurements (from embeddings.csv, subsampled to {MAX_PROCUREMENTS})")

    from sentence_transformers import SentenceTransformer

    device = pick_device()
    model = SentenceTransformer(MODEL_NAME, cache_folder=str(CACHE_DIR), device=device)

    passage_texts = ["passage: " + t for t in df["text"].tolist()]

    start = time.perf_counter()
    local_matrix = model.encode(
        passage_texts, batch_size=32, show_progress_bar=False, convert_to_numpy=True
    )
    elapsed_ms = (time.perf_counter() - start) * 1000.0
    ms_per_row = elapsed_ms / n if n else 0.0

    stored_norm = l2_normalize(stored_matrix.astype(np.float32))
    local_norm = l2_normalize(local_matrix.astype(np.float32))

    stored_sim = stored_norm @ stored_norm.T
    local_sim = local_norm @ local_norm.T

    rng = np.random.default_rng(RANDOM_STATE)
    sample_size = min(N_QUERY_SAMPLE, n)
    query_idx = rng.choice(n, size=sample_size, replace=False)

    overlaps: list[float] = []
    stored_sims_flat: list[float] = []
    local_sims_flat: list[float] = []
    for i in query_idx:
        stored_top = top_k_neighbours(stored_sim[i], i)
        local_top = top_k_neighbours(local_sim[i], i)
        overlaps.append(len(stored_top & local_top) / 10.0)

        mask = np.ones(n, dtype=bool)
        mask[i] = False
        stored_sims_flat.extend(stored_sim[i][mask].tolist())
        local_sims_flat.extend(local_sim[i][mask].tolist())

    procurement_overlap_mean = float(np.mean(overlaps))
    spearman_corr, _p = spearmanr(stored_sims_flat, local_sims_flat)

    # Informational only: profiles.csv is empty in prod, so substitute synthetic
    # pt-BR queries; the stored space has no query vectors for them, so we can
    # only report a local-space term hit-rate, not a real overlap metric.
    query_texts = ["query: " + q for q in SYNTHETIC_QUERIES]
    query_vectors = model.encode(
        query_texts, batch_size=8, show_progress_bar=False, convert_to_numpy=True
    )
    query_vectors = l2_normalize(query_vectors.astype(np.float32))
    query_sim = query_vectors @ local_norm.T

    hit_rates: list[float] = []
    for qi, phrase in enumerate(SYNTHETIC_QUERIES):
        tokens = [F.normalize_term(tok) for tok in phrase.split()]
        top10 = np.argsort(-query_sim[qi])[:10]
        hits = 0
        for j in top10:
            text_norm = F.normalize_term(df.iloc[int(j)]["text"])
            if any(tok and tok in text_norm for tok in tokens):
                hits += 1
        hit_rates.append(hits / 10.0)

    results = {
        "model": MODEL_NAME,
        "device": device,
        "embed_dim": MODEL_DIM,
        "stored_dim": int(stored_matrix.shape[1]),
        "n_procurements": n,
        "n_query_sample": sample_size,
        "procurement_overlap_mean": round(procurement_overlap_mean, 4),
        "spearman_correlation": round(float(spearman_corr), 4),
        "n_synthetic_queries": len(SYNTHETIC_QUERIES),
        "profile_hit_rate_informational": round(float(np.mean(hit_rates)), 4),
        "ms_per_row": round(ms_per_row, 3),
    }

    out_path = F.RESULTS_DIR / "embed.json"
    out_path.write_text(json.dumps(results, indent=2, ensure_ascii=False))
    for key, value in results.items():
        print(f"{key:<32}{value}")
    print(f"\nwrote {out_path}")


if __name__ == "__main__":
    main()
