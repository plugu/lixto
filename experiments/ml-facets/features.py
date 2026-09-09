# /// script
# requires-python = ">=3.12"
# dependencies = [
#   "pandas",
#   "numpy",
#   "scikit-learn",
# ]
# ///
"""Shared data loading, feature building, and split helpers for the ml-facets
classify/keyword benchmarks (cycle 26, throwaway — see PRODUCT.md).

Kept standalone on purpose: does not import `src/lixto`. `normalize_term`
below is a verbatim copy of `src/lixto/enrich/schema.py:120-129` (the match
engine's term-normalization contract) so the experiment reflects prod
behavior without depending on the package.
"""

from __future__ import annotations

import re
import time
import unicodedata
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.model_selection import train_test_split

HERE = Path(__file__).resolve().parent
DATA_DIR = HERE / "data"
RESULTS_DIR = HERE / "results"

RANDOM_STATE = 42
TEST_SIZE = 0.2
MAX_PROCUREMENTS = 5000
DOC_TEXT_CHARS = 4000

_WHITESPACE_RE = re.compile(r"\s+")


def normalize_term(s: str) -> str:
    """Lowercase, accent-stripped, whitespace-collapsed form of a term.

    Must stay byte-identical to the normalization applied to company terms —
    the match engine compares the two with array overlap.
    """
    if not isinstance(s, str):
        return ""
    ascii_only = unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode()
    return _WHITESPACE_RE.sub(" ", ascii_only).strip().lower()


def parse_pg_array(value: object) -> list[str]:
    """Parse a Postgres array literal (e.g. '{a,"b c",d}') into a list of strings.

    Handles the quoting/backslash-escaping COPY writes for text[] columns.
    """
    if not isinstance(value, str) or len(value) < 2 or value[0] != "{":
        return []
    body = value[1:-1]
    if not body:
        return []
    items: list[str] = []
    current: list[str] = []
    in_quotes = False
    i = 0
    n = len(body)
    while i < n:
        ch = body[i]
        if in_quotes:
            if ch == "\\" and i + 1 < n:
                current.append(body[i + 1])
                i += 2
                continue
            if ch == '"':
                in_quotes = False
                i += 1
                continue
            current.append(ch)
            i += 1
            continue
        if ch == '"':
            in_quotes = True
            i += 1
            continue
        if ch == ",":
            items.append("".join(current))
            current = []
            i += 1
            continue
        current.append(ch)
        i += 1
    items.append("".join(current))
    return items


def timed(fn: Callable[[], object], n_rows: int) -> tuple[object, float]:
    """Run fn() once and return (result, ms_per_row)."""
    start = time.perf_counter()
    result = fn()
    elapsed_ms = (time.perf_counter() - start) * 1000.0
    ms_per_row = elapsed_ms / n_rows if n_rows else 0.0
    return result, ms_per_row


@dataclass
class Split:
    """A train/test procurement_id split plus the row counts 139 reports."""

    train_pids: np.ndarray
    test_pids: np.ndarray
    cloud_rows: int
    local_rows: int
    test_rows: int


def load_enrichments() -> pd.DataFrame:
    df = pd.read_csv(DATA_DIR / "enrichments.csv")
    df["is_cloud"] = df["model"].str.startswith(("gemini-", "gpt-"))
    df["label_source"] = np.where(df["is_cloud"], "cloud", "local")
    df["concepts_list"] = df["concepts"].apply(parse_pg_array)
    df["keywords_list"] = df["keywords"].apply(parse_pg_array)
    return df


def load_categories() -> pd.DataFrame:
    return pd.read_csv(DATA_DIR / "categories.csv")


def load_cnaes() -> pd.DataFrame:
    return pd.read_csv(DATA_DIR / "cnaes.csv")


def load_requirements() -> pd.DataFrame:
    return pd.read_csv(DATA_DIR / "requirements.csv")


def load_procurements() -> pd.DataFrame:
    return pd.read_csv(DATA_DIR / "procurements.csv")


def load_items() -> pd.DataFrame:
    return pd.read_csv(DATA_DIR / "items.csv")


def load_doc_texts() -> pd.DataFrame:
    return pd.read_csv(DATA_DIR / "doc_texts.csv")


def subsample_ids(
    ids: np.ndarray, limit: int = MAX_PROCUREMENTS, seed: int = RANDOM_STATE
) -> np.ndarray:
    """Fixed-seed subsample of procurement ids if there are more than `limit`."""
    ids = np.asarray(ids)
    if len(ids) <= limit:
        return ids
    rng = np.random.default_rng(seed)
    return rng.choice(ids, size=limit, replace=False)


def build_texts(
    procurements: pd.DataFrame,
    items: pd.DataFrame,
    doc_texts: pd.DataFrame,
    procurement_ids: np.ndarray,
) -> dict[int, str]:
    """One text per procurement: description + item descriptions + the first
    DOC_TEXT_CHARS chars of the longest doc_texts.text for that procurement.
    Missing parts are skipped."""
    wanted = {int(p) for p in procurement_ids}

    desc_by_pid = (
        procurements.loc[procurements["id"].isin(wanted)].set_index("id")["description"].to_dict()
    )

    items_scoped = items.loc[items["procurement_id"].isin(wanted)]
    item_text_by_pid = (
        items_scoped.groupby("procurement_id")["description"]
        .apply(lambda s: " ".join(x for x in s if isinstance(x, str)))
        .to_dict()
    )

    doc_scoped = doc_texts.loc[doc_texts["procurement_id"].isin(wanted)]
    longest_by_pid: dict[int, str] = {}
    if len(doc_scoped):
        idx = doc_scoped.groupby("procurement_id")["chars"].idxmax()
        longest_by_pid = doc_scoped.loc[idx].set_index("procurement_id")["text"].to_dict()

    texts: dict[int, str] = {}
    for pid in wanted:
        parts: list[str] = []
        desc = desc_by_pid.get(pid)
        if isinstance(desc, str) and desc:
            parts.append(desc)
        item_text = item_text_by_pid.get(pid)
        if item_text:
            parts.append(item_text)
        doc_text = longest_by_pid.get(pid)
        if isinstance(doc_text, str) and doc_text:
            parts.append(doc_text[:DOC_TEXT_CHARS])
        texts[pid] = "\n".join(parts)
    return texts


def make_split(enrichments: pd.DataFrame, cloud_only: bool = False) -> Split:
    """20% of cloud procurement_ids (random_state=42) are the test set;
    everything else (remaining cloud + all local, unless cloud_only) is train."""
    cloud_ids = enrichments.loc[enrichments["is_cloud"], "procurement_id"].unique()
    local_ids = enrichments.loc[~enrichments["is_cloud"], "procurement_id"].unique()
    cloud_train, cloud_test = train_test_split(
        cloud_ids, test_size=TEST_SIZE, random_state=RANDOM_STATE
    )
    train_pids = cloud_train if cloud_only else np.concatenate([cloud_train, local_ids])
    return Split(
        train_pids=np.asarray(train_pids),
        test_pids=np.asarray(cloud_test),
        cloud_rows=len(cloud_ids),
        local_rows=len(local_ids),
        test_rows=len(cloud_test),
    )
