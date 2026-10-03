"""Unit tests for src/lixto/classify/schema.py — no database, no network."""

from __future__ import annotations

from lixto.classify.schema import (
    CLASSIFICATION_SCHEMA,
    SCHEMA_VERSION,
    build_prompt,
    validate_payload,
)

CNAES = {"6201501", "6202300", "4751201"}
SEGMENTS = [("informatica", 0.82), ("saude", 0.5), ("outros", 0.0)]


def _raw(**overrides):
    raw = {
        "cnaes": [{"code": "6201501", "confidence": 0.9}],
        "segment": "informatica",
        "segment_confidence": 0.8,
        "nature": "servicos",
        "keywords": ["Software", "licença"],
    }
    raw.update(overrides)
    return raw


def _validate(raw):
    return validate_payload(raw, cnae_candidates=CNAES, segment_candidates=SEGMENTS)


def test_schema_version_is_a_string():
    assert SCHEMA_VERSION == "1"


def test_schema_is_strict():
    def walk(node):
        if isinstance(node, dict):
            if node.get("type") == "object":
                assert node["additionalProperties"] is False
                assert set(node["required"]) == set(node["properties"])
            for v in node.values():
                walk(v)
        elif isinstance(node, list):
            for v in node:
                walk(v)

    walk(CLASSIFICATION_SCHEMA)
    assert CLASSIFICATION_SCHEMA["properties"]["nature"]["enum"] == ["bens", "servicos", "obras"]


def test_prompt_contains_every_candidate_code_once():
    prompt = build_prompt(
        "Contratação de software",
        ["item a", "item b"],
        [("6201501", "Desenvolvimento de programas"), ("6202300", "Consultoria em TI")],
        [("informatica", "Informática", "TI e telecom"), ("outros", "Outros", "Resto")],
    )

    for code in ("6201501", "6202300", "informatica", "outros"):
        assert prompt.count(code) == 1
    assert "## Objeto" in prompt
    assert "## Itens" in prompt
    assert "6201501 — Desenvolvimento de programas" in prompt
    assert "informatica — Informática — TI e telecom" in prompt


def test_prompt_caps_items_at_twenty():
    prompt = build_prompt("x", [f"item-{i:02d}" for i in range(30)], [], [])

    assert "item-19" in prompt
    assert "item-20" not in prompt


def test_valid_payload_passes_through():
    out = _validate(_raw())

    assert out == {
        "cnaes": [{"code": "6201501", "confidence": 0.9}],
        "segment": "informatica",
        "segment_confidence": 0.8,
        "segment_source": "llm",
        "nature": "servicos",
        "keywords": ["software", "licenca"],
    }


def test_unknown_cnaes_are_dropped():
    out = _validate(
        _raw(cnaes=[{"code": "9999999", "confidence": 0.9}, {"code": "6202300", "confidence": 0.4}])
    )

    assert out["cnaes"] == [{"code": "6202300", "confidence": 0.4}]


def test_unknown_segment_falls_back_to_cosine_top_one():
    out = _validate(_raw(segment="inexistente"))

    assert out["segment"] == "informatica"
    assert out["segment_source"] == "cosine"
    assert out["segment_confidence"] == 0.82


def test_bad_nature_is_rejected():
    assert _validate(_raw(nature="misto")) is None
    assert _validate({k: v for k, v in _raw().items() if k != "nature"}) is None
    assert _validate(None) is None


def test_keywords_are_normalised_deduped_and_capped():
    keywords = ["Café", "cafe", " CAFÉ "] + [f"termo {i}" for i in range(20)]

    out = _validate(_raw(keywords=keywords))

    assert out["keywords"][0] == "cafe"
    assert len(out["keywords"]) == 10
    assert len(set(out["keywords"])) == 10
    assert all(k == k.lower() for k in out["keywords"])
