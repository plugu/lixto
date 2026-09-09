# /// script
# requires-python = ">=3.12"
# dependencies = [
#   "pandas",
#   "numpy",
#   "scikit-learn",
# ]
# ///
"""Closed-set classifier benchmark: CNAE, categories, the two boolean flags,
and complexity vs. LLM labels (cycle 26 ml-facets, throwaway — see PRODUCT.md).

TF-IDF (word 1-2 grams + char_wb 3-5 grams) -> linear models, evaluated on the
cloud-labelled held-out split from `features.py`. Writes results/classify.json.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import accuracy_score, f1_score, precision_score, recall_score
from sklearn.multiclass import OneVsRestClassifier
from sklearn.pipeline import FeatureUnion
from sklearn.preprocessing import MultiLabelBinarizer

sys.path.insert(0, str(Path(__file__).resolve().parent))
import features as F

# Codes/categories with fewer training rows than this are dropped before
# fitting (unlearnable with too few examples); reported as "coverage" lost.
MIN_TRAIN_COUNT = 5


def make_vectorizer() -> FeatureUnion:
    return FeatureUnion(
        [
            (
                "word",
                TfidfVectorizer(
                    analyzer="word", ngram_range=(1, 2), sublinear_tf=True, min_df=2
                ),
            ),
            (
                "char",
                TfidfVectorizer(
                    analyzer="char_wb", ngram_range=(3, 5), sublinear_tf=True, min_df=2
                ),
            ),
        ]
    )


def texts_for(pids: np.ndarray, texts: dict[int, str]) -> list[str]:
    return [texts.get(int(pid), "") for pid in pids]


def top3_agreement(
    proba: np.ndarray, classes: np.ndarray, true_sets: list[set[str]]
) -> float:
    if not true_sets:
        return 0.0
    hits = 0
    for i, true_set in enumerate(true_sets):
        top_idx = np.argsort(-proba[i])[:3]
        top_codes = {classes[j] for j in top_idx}
        if true_set & top_codes:
            hits += 1
    return hits / len(true_sets)


def bench_multilabel(
    label_df: pd.DataFrame,
    label_col: str,
    texts: dict[int, str],
    split: F.Split,
    is_cnae: bool,
) -> dict:
    train_pids = split.train_pids
    test_pids = split.test_pids

    labels_by_pid: dict[int, set[str]] = (
        label_df.astype({label_col: str}).groupby("procurement_id")[label_col].apply(set).to_dict()
    )

    train_labels_flat = [
        lbl for pid in train_pids for lbl in labels_by_pid.get(int(pid), set())
    ]
    counts = pd.Series(train_labels_flat).value_counts()
    keep = sorted(counts[counts >= MIN_TRAIN_COUNT].index)
    if not keep:
        return {"skipped": f"no {label_col} with >= {MIN_TRAIN_COUNT} training rows"}
    keep_set = set(keep)

    mlb = MultiLabelBinarizer(classes=keep)
    y_train = mlb.fit_transform(
        [labels_by_pid.get(int(pid), set()) & keep_set for pid in train_pids]
    )
    if y_train.sum() == 0:
        return {"skipped": f"no positive {label_col} training rows after filtering"}

    y_test_full = [labels_by_pid.get(int(pid), set()) for pid in test_pids]
    y_test = mlb.transform([s & keep_set for s in y_test_full])

    vectorizer = make_vectorizer()
    x_train = vectorizer.fit_transform(texts_for(train_pids, texts))

    clf = OneVsRestClassifier(LogisticRegression(C=4, max_iter=2000))
    clf.fit(x_train, y_train)

    def _predict() -> tuple[np.ndarray, np.ndarray]:
        x_test = vectorizer.transform(texts_for(test_pids, texts))
        return clf.predict_proba(x_test), clf.predict(x_test)

    (proba, pred), ms_per_row = F.timed(_predict, len(test_pids))

    total_true = sum(len(s) for s in y_test_full)
    covered_true = sum(len(s & keep_set) for s in y_test_full)
    coverage = covered_true / total_true if total_true else 0.0

    result: dict[str, object] = {
        "micro_f1": round(float(f1_score(y_test, pred, average="micro", zero_division=0)), 4),
        "macro_f1": round(float(f1_score(y_test, pred, average="macro", zero_division=0)), 4),
        "classes_kept": len(keep),
        "coverage": round(coverage, 4),
        "train_rows": len(train_pids),
        "test_rows": len(test_pids),
        "cloud_rows": split.cloud_rows,
        "local_rows": split.local_rows,
        "ms_per_row": round(ms_per_row, 3),
    }
    if is_cnae:
        result["top3_agreement"] = round(top3_agreement(proba, mlb.classes_, y_test_full), 4)
        result["catalog_code_coverage"] = 0
    return result


def bench_binary_flag(
    enrichments: pd.DataFrame, col: str, texts: dict[int, str], split: F.Split
) -> dict:
    label_by_pid = enrichments.set_index("procurement_id")[col].map({"t": 1, "f": 0}).to_dict()
    train_pids = split.train_pids
    test_pids = split.test_pids

    y_train = np.array([label_by_pid.get(int(p), 0) for p in train_pids])
    y_test = np.array([label_by_pid.get(int(p), 0) for p in test_pids])

    if len(set(y_train.tolist())) < 2:
        return {"skipped": f"{col}: only one class present in training rows"}
    if y_test.sum() == 0:
        return {"skipped": f"{col}: no positive test rows to score"}

    vectorizer = make_vectorizer()
    x_train = vectorizer.fit_transform(texts_for(train_pids, texts))

    clf = LogisticRegression(class_weight="balanced", max_iter=2000)
    clf.fit(x_train, y_train)

    def _predict() -> np.ndarray:
        x_test = vectorizer.transform(texts_for(test_pids, texts))
        return clf.predict(x_test)

    y_pred, ms_per_row = F.timed(_predict, len(test_pids))

    return {
        "f1_positive": round(float(f1_score(y_test, y_pred, pos_label=1, zero_division=0)), 4),
        "precision_positive": round(
            float(precision_score(y_test, y_pred, pos_label=1, zero_division=0)), 4
        ),
        "recall_positive": round(
            float(recall_score(y_test, y_pred, pos_label=1, zero_division=0)), 4
        ),
        "positive_rate_test": round(float(y_test.mean()), 4),
        "train_rows": len(train_pids),
        "test_rows": len(test_pids),
        "cloud_rows": split.cloud_rows,
        "local_rows": split.local_rows,
        "ms_per_row": round(ms_per_row, 3),
    }


def bench_complexity(enrichments: pd.DataFrame, texts: dict[int, str], split: F.Split) -> dict:
    label_by_pid = enrichments.set_index("procurement_id")["complexity"].to_dict()
    train_pids = split.train_pids
    test_pids = split.test_pids

    y_train = [label_by_pid.get(int(p)) for p in train_pids]
    y_test = [label_by_pid.get(int(p)) for p in test_pids]

    if len(set(y_train)) < 2:
        return {"skipped": "complexity: fewer than 2 classes present in training rows"}

    vectorizer = make_vectorizer()
    x_train = vectorizer.fit_transform(texts_for(train_pids, texts))

    clf = LogisticRegression(C=4, max_iter=2000)
    clf.fit(x_train, y_train)

    def _predict() -> list[str]:
        x_test = vectorizer.transform(texts_for(test_pids, texts))
        return list(clf.predict(x_test))

    y_pred, ms_per_row = F.timed(_predict, len(test_pids))

    return {
        "macro_f1": round(float(f1_score(y_test, y_pred, average="macro", zero_division=0)), 4),
        "accuracy": round(float(accuracy_score(y_test, y_pred)), 4),
        "train_rows": len(train_pids),
        "test_rows": len(test_pids),
        "cloud_rows": split.cloud_rows,
        "local_rows": split.local_rows,
        "ms_per_row": round(ms_per_row, 3),
    }


def print_table(results: dict) -> None:
    print(f"{'target':<32}{'metric':<24}{'value'}")
    for target, metrics in results.items():
        if "skipped" in metrics:
            print(f"{target:<32}{'skipped':<24}{metrics['skipped']}")
            continue
        for key, value in metrics.items():
            print(f"{target:<32}{key:<24}{value}")


def main() -> None:
    F.RESULTS_DIR.mkdir(exist_ok=True)

    enrichments = F.load_enrichments()
    procurements = F.load_procurements()
    items = F.load_items()
    doc_texts = F.load_doc_texts()
    categories = F.load_categories()
    cnaes = F.load_cnaes()

    all_pids = F.subsample_ids(enrichments["procurement_id"].unique())
    enrichments = enrichments[enrichments["procurement_id"].isin(all_pids)]
    texts = F.build_texts(procurements, items, doc_texts, all_pids)

    split_all = F.make_split(enrichments, cloud_only=False)
    split_cnae = F.make_split(enrichments, cloud_only=True)

    results: dict[str, dict] = {}
    results["cnae"] = bench_multilabel(cnaes, "cnae_code", texts, split_cnae, is_cnae=True)
    results["categories"] = bench_multilabel(
        categories, "category", texts, split_all, is_cnae=False
    )
    for flag in ("requires_certification", "requires_technical_certificate"):
        results[flag] = bench_binary_flag(enrichments, flag, texts, split_all)
    results["complexity"] = bench_complexity(enrichments, texts, split_all)

    out_path = F.RESULTS_DIR / "classify.json"
    out_path.write_text(json.dumps(results, indent=2, ensure_ascii=False))
    print_table(results)
    print(f"\nwrote {out_path}")


if __name__ == "__main__":
    main()
