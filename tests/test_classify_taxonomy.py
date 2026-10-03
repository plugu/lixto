"""Taxonomy invariants and sync with migrations/009_classification.sql."""

import re
from pathlib import Path

from lixto.classify.taxonomy import NATURES, SEGMENT_CODES, SEGMENTS, segment_by_code

_MIGRATION = Path(__file__).resolve().parents[1] / "migrations" / "009_classification.sql"
_ROW = re.compile(r"^\('([^']+)', '((?:[^']|'')*)', '((?:[^']|'')*)', (\d+)\)[,;]$", re.MULTILINE)


def test_24_segments_unique_codes_and_orders():
    assert len(SEGMENTS) == 24
    assert len({s.code for s in SEGMENTS}) == 24
    assert [s.sort_order for s in SEGMENTS] == list(range(1, 25))
    assert SEGMENT_CODES == {s.code for s in SEGMENTS}


def test_outros_is_last_and_codes_are_snake_case():
    assert SEGMENTS[-1].code == "outros"
    assert all(re.fullmatch(r"[a-z_]+", s.code) for s in SEGMENTS)


def test_segment_by_code_and_natures():
    assert segment_by_code("saude").label == "Saúde e hospitalar"
    assert segment_by_code("nope") is None
    assert NATURES == ("bens", "servicos", "obras")


def test_migration_seed_matches_taxonomy():
    rows = _ROW.findall(_MIGRATION.read_text(encoding="utf-8"))
    seeded = [(c, l.replace("''", "'"), d.replace("''", "'"), int(n)) for c, l, d, n in rows]
    assert seeded == [(s.code, s.label, s.description, s.sort_order) for s in SEGMENTS]
