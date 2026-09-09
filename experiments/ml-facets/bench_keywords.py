# /// script
# requires-python = ">=3.12"
# dependencies = [
#   "pandas",
#   "numpy",
#   "scikit-learn",
#   "yake",
# ]
# ///
"""Unsupervised keyword extraction benchmark: YAKE vs. TF-IDF top terms
against the LLM's `keywords ∪ concepts` (cycle 26 ml-facets, throwaway — see
PRODUCT.md). Evaluated on the cloud-labelled held-out split. Writes
results/keywords.json.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np
import yake
from sklearn.feature_extraction.text import TfidfVectorizer

sys.path.insert(0, str(Path(__file__).resolve().parent))
import features as F

TOP_K = 15


def normalize_candidates(terms: list[str]) -> list[str]:
    out: list[str] = []
    seen: set[str] = set()
    for term in terms:
        norm = F.normalize_term(term)
        if norm and norm not in seen:
            seen.add(norm)
            out.append(norm)
    return out


def jaccard(a: set[str], b: set[str]) -> float:
    union = a | b
    if not union:
        return 1.0
    return len(a & b) / len(union)


def recall_at_k(reference: set[str], candidates: list[str]) -> float:
    cand_set = set(candidates)
    return len(reference & cand_set) / len(reference)


def loose_recall(reference: set[str], candidates: list[str]) -> float:
    hits = 0
    for ref in reference:
        if any(ref in cand or cand in ref for cand in candidates if cand):
            hits += 1
    return hits / len(reference)


def score_method(
    raw_candidates: dict[int, list[str]], reference_by_pid: dict[int, set[str]], ms_per_row: float
) -> dict:
    jaccards: list[float] = []
    recalls: list[float] = []
    loose_recalls: list[float] = []
    for pid, cands in raw_candidates.items():
        reference = reference_by_pid.get(pid, set())
        if not reference:
            continue
        norm_cands = normalize_candidates(cands)
        jaccards.append(jaccard(reference, set(norm_cands)))
        recalls.append(recall_at_k(reference, norm_cands))
        loose_recalls.append(loose_recall(reference, norm_cands))
    return {
        "mean_jaccard": round(float(np.mean(jaccards)), 4) if jaccards else None,
        "recall_at_15": round(float(np.mean(recalls)), 4) if recalls else None,
        "loose_recall_at_15": round(float(np.mean(loose_recalls)), 4) if loose_recalls else None,
        "scored_rows": len(jaccards),
        "ms_per_row": round(ms_per_row, 3),
    }


def print_table(results: dict) -> None:
    print(f"{'method':<32}{'metric':<24}{'value'}")
    for method, metrics in results.items():
        if not isinstance(metrics, dict):
            continue
        for key, value in metrics.items():
            print(f"{method:<32}{key:<24}{value}")


def main() -> None:
    F.RESULTS_DIR.mkdir(exist_ok=True)

    enrichments = F.load_enrichments()
    procurements = F.load_procurements()
    items = F.load_items()
    doc_texts = F.load_doc_texts()

    all_pids = F.subsample_ids(enrichments["procurement_id"].unique())
    enrichments = enrichments[enrichments["procurement_id"].isin(all_pids)]
    texts = F.build_texts(procurements, items, doc_texts, all_pids)

    split = F.make_split(enrichments, cloud_only=False)
    test_pids = split.test_pids

    reference_by_pid: dict[int, set[str]] = {}
    for _, row in enrichments.iterrows():
        pid = int(row["procurement_id"])
        terms = list(row["concepts_list"]) + list(row["keywords_list"])
        reference_by_pid[pid] = set(normalize_candidates(terms))

    all_texts_list = [texts.get(int(p), "") for p in all_pids]
    pid_to_row = {int(p): i for i, p in enumerate(all_pids)}

    # (b) TF-IDF top-15 terms, same word 1-2-gram vectorizer, fit on all texts.
    tfidf = TfidfVectorizer(analyzer="word", ngram_range=(1, 2), sublinear_tf=True, min_df=2)
    tfidf_matrix = tfidf.fit_transform(all_texts_list)
    vocab = np.array(tfidf.get_feature_names_out())

    def tfidf_candidates_for(pid: int) -> list[str]:
        row = tfidf_matrix.getrow(pid_to_row[pid])
        if row.nnz == 0:
            return []
        top_n = min(TOP_K, row.nnz)
        top_local = np.argsort(-row.data)[:top_n]
        return [vocab[row.indices[i]] for i in top_local]

    def run_tfidf() -> dict[int, list[str]]:
        return {int(pid): tfidf_candidates_for(int(pid)) for pid in test_pids}

    tfidf_raw, tfidf_ms = F.timed(run_tfidf, len(test_pids))

    # (a) YAKE
    extractor = yake.KeywordExtractor(lan="pt", n=3, top=TOP_K)

    def run_yake() -> dict[int, list[str]]:
        out: dict[int, list[str]] = {}
        for pid in test_pids:
            text = texts.get(int(pid), "")
            if not text.strip():
                out[int(pid)] = []
                continue
            out[int(pid)] = [kw for kw, _score in extractor.extract_keywords(text)]
        return out

    yake_raw, yake_ms = F.timed(run_yake, len(test_pids))

    results = {
        "yake": score_method(yake_raw, reference_by_pid, yake_ms),
        "tfidf": score_method(tfidf_raw, reference_by_pid, tfidf_ms),
        "reference_source": "keywords ∪ concepts (normalize_term)",
        "test_rows": int(split.test_rows),
        "cloud_rows": int(split.cloud_rows),
        "local_rows": int(split.local_rows),
    }

    out_path = F.RESULTS_DIR / "keywords.json"
    out_path.write_text(json.dumps(results, indent=2, ensure_ascii=False))
    print_table(results)
    print(f"\nwrote {out_path}")


if __name__ == "__main__":
    main()
