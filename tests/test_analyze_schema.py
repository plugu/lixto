"""Unit tests for src/lixto/analyze/schema.py — the schema-2.0 contract.

Pure functions only: no network, no database.
"""

from datetime import datetime, timedelta, timezone

import pytest

from lixto.analyze.schema import (
    ANALYSIS_SCHEMA,
    MAX_ANALYSIS_REQUIREMENTS,
    MAX_DATES,
    MAX_FACTS,
    MAX_MISSING,
    MAX_PENALTIES,
    MAX_RISKS,
    SCHEMA_VERSION,
    clean_citations,
    parse_occurs_at,
    validate_analysis,
)

DOC_PAGES = {1: 10, 2: 3}


def _facets():
    """The enrichment half of a raw model payload (schema 1.0 keys)."""
    return {
        "summary": "Compra de lápis.",
        "categories": ["Material Escolar"],
        "concepts": ["lápis"],
        "keywords": ["lápis", "lapis preto"],
        "cnae_candidates": [{"code": "4761-0/03", "confidence": 0.8}],
        "requires_certification": False,
        "requires_technical_certificate": True,
        "delivery": {"location": "Rio de Janeiro", "deadline_days": 30},
        "complexity": "low",
        "confidence": 0.7,
    }


def _fact(**overrides):
    return {
        "group": "basic",
        "key": "estimated_value",
        "label": "Valor estimado",
        "value": "R$ 12.345,00",
        "statement_kind": "fact",
        "confidence": "high",
        "citations": [{"sequence": 1, "page": 3}],
        **overrides,
    }


def _requirement(**overrides):
    return {
        "category": "fiscal_labor",
        "title": "CND federal",
        "description": "Certidão negativa de débitos federais válida.",
        "mandatory": True,
        "severity": "high",
        "statement_kind": "fact",
        "confidence": "high",
        "citations": [{"sequence": 1, "page": 4}],
        **overrides,
    }


def _risk(**overrides):
    return {
        "kind": "red_flag",
        "severity": "high",
        "title": "Marca restritiva",
        "description": "O termo de referência cita uma única marca.",
        "recommendation": "Pedir esclarecimento.",
        "citations": [{"sequence": 1, "page": 5}],
        **overrides,
    }


def _raw(**overrides):
    return {
        **_facets(),
        "executive_summary": "Resumo executivo.",
        "object": "Aquisição de lápis.",
        "overall_risk": "medium",
        "facts": [_fact()],
        "dates": [
            {
                "kind": "proposal_deadline",
                "label": "Encerramento das propostas",
                "occurs_at": "2026-10-14T09:00:00",
                "raw_text": "até as 09h do dia 14/10/2026",
                "confidence": "high",
                "citations": [{"sequence": 1, "page": 1}],
            }
        ],
        "requirements": [_requirement()],
        "penalties": [
            {
                "description": "Multa por atraso",
                "basis": "0,5% por dia, limitado a 10%",
                "confidence": "medium",
                "citations": [{"sequence": 2, "page": 2}],
            }
        ],
        "risks": [_risk()],
        "missing": [{"field": "prazo de garantia", "note": "não consta no edital"}],
        **overrides,
    }


def _validated(**overrides):
    payload = validate_analysis(_raw(**overrides), doc_pages=DOC_PAGES)
    assert payload is not None
    return payload


# --- the JSON schema -----------------------------------------------------


def test_schema_version_is_2_0():
    assert SCHEMA_VERSION == "2.0"


def _objects(node):
    """Every object-typed subschema of a JSON schema, depth-first."""
    if isinstance(node, dict):
        if node.get("type") == "object":
            yield node
        for value in node.values():
            yield from _objects(value)
    elif isinstance(node, list):
        for item in node:
            yield from _objects(item)


def test_every_object_is_strict_mode_compatible():
    """OpenAI-compatible `json_schema` strict mode: no extra properties, and
    `required` must list every property of every object."""
    found = list(_objects(ANALYSIS_SCHEMA))
    assert len(found) > 5
    for obj in found:
        assert obj["additionalProperties"] is False
        assert sorted(obj["required"]) == sorted(obj["properties"])


def test_schema_carries_facets_and_dossier_but_not_facet_requirements():
    properties = ANALYSIS_SCHEMA["properties"]
    for key in ("summary", "categories", "concepts", "keywords", "cnae_candidates", "delivery"):
        assert key in properties
    for key in ("facts", "dates", "requirements", "penalties", "risks", "missing"):
        assert key in properties
    # `requirements`/`risks` are the rich dossier shapes, not the 1.0 facets.
    assert "citations" in properties["requirements"]["items"]["properties"]
    assert properties["risks"]["items"]["type"] == "object"
    assert "facet_requirements" not in properties


def test_citation_items_are_sequence_and_page_integers():
    citation = ANALYSIS_SCHEMA["properties"]["facts"]["items"]["properties"]["citations"]["items"]
    assert citation["properties"]["sequence"]["type"] == "integer"
    assert citation["properties"]["page"]["type"] == "integer"


def test_nullable_fields_allow_null():
    properties = ANALYSIS_SCHEMA["properties"]
    assert properties["dates"]["items"]["properties"]["occurs_at"]["type"] == ["string", "null"]
    assert properties["penalties"]["items"]["properties"]["basis"]["type"] == ["string", "null"]
    assert properties["missing"]["items"]["properties"]["note"]["type"] == ["string", "null"]


# --- rejection -----------------------------------------------------------


@pytest.mark.parametrize("raw", [None, "texto", 42, ["facts"]])
def test_non_dict_payload_is_rejected(raw):
    assert validate_analysis(raw, doc_pages=DOC_PAGES) is None


def test_unknown_complexity_is_rejected_by_the_facet_validator():
    assert validate_analysis(_raw(complexity="enorme"), doc_pages=DOC_PAGES) is None


# --- citations -----------------------------------------------------------


def test_citations_outside_the_document_set_are_dropped():
    kept = clean_citations(
        [
            {"sequence": 1, "page": 3},
            {"sequence": 9, "page": 1},  # unknown document
            {"sequence": 2, "page": 4},  # page beyond the document
            {"sequence": 1, "page": 0},  # pages are 1-based
            {"sequence": "1", "page": 1},  # not ints
            {"sequence": True, "page": 1},  # bools are not sequences
            "não é um objeto",
        ],
        DOC_PAGES,
    )
    assert kept == [{"sequence": 1, "page": 3}]


def test_citations_are_deduped_in_order():
    kept = clean_citations(
        [{"sequence": 1, "page": 2}, {"sequence": 1, "page": 1}, {"sequence": 1, "page": 2}],
        DOC_PAGES,
    )
    assert kept == [{"sequence": 1, "page": 2}, {"sequence": 1, "page": 1}]


def test_fact_without_citation_is_demoted_to_a_low_confidence_inference():
    payload = _validated(facts=[_fact(citations=[])])

    assert payload["facts"][0]["statement_kind"] == "inference"
    assert payload["facts"][0]["confidence"] == "low"


def test_fact_whose_only_citation_is_invalid_is_demoted():
    payload = _validated(facts=[_fact(citations=[{"sequence": 42, "page": 1}])])

    assert payload["facts"][0]["citations"] == []
    assert payload["facts"][0]["statement_kind"] == "inference"


def test_requirement_without_citation_is_demoted_too():
    payload = _validated(requirements=[_requirement(citations=[])])

    assert payload["requirements"][0]["statement_kind"] == "inference"
    assert payload["requirements"][0]["confidence"] == "low"


def test_an_inference_keeps_its_confidence_without_citations():
    payload = _validated(
        facts=[_fact(statement_kind="inference", confidence="medium", citations=[])]
    )

    assert payload["facts"][0]["statement_kind"] == "inference"
    assert payload["facts"][0]["confidence"] == "medium"


# --- coercion ------------------------------------------------------------


def test_unknown_enums_drop_the_entry():
    payload = _validated(
        facts=[_fact(group="financeiro"), _fact(key="dispute_type")],
        dates=[{"kind": "aniversario", "label": "x", "raw_text": "y", "confidence": "high"}],
        requirements=[_requirement(category="juridico")],
        risks=[_risk(kind="preocupacao")],
    )

    assert [f["key"] for f in payload["facts"]] == ["dispute_type"]
    assert payload["dates"] == []
    assert payload["requirements"] == []
    assert payload["risks"] == []


def test_non_dict_entries_and_blank_strings_are_dropped():
    payload = _validated(
        facts=["não é um objeto", _fact(label="   ")],
        missing=[{"field": "  "}, {"field": "prazo"}, 7],
    )

    assert payload["facts"] == []
    assert payload["missing"] == [{"field": "prazo", "note": None}]


def test_fact_keys_are_lowercase_identifiers_deduped_first_wins():
    payload = _validated(
        facts=[
            _fact(key="Estimated_Value", value="primeiro"),
            _fact(key="estimated_value", value="segundo"),
            _fact(key="valor 2024", value="terceiro"),
        ]
    )

    assert [(f["key"], f["value"]) for f in payload["facts"]] == [("estimated_value", "primeiro")]


def test_mandatory_defaults_to_true_when_absent_or_not_a_boolean():
    payload = _validated(
        requirements=[
            _requirement(mandatory=None),
            _requirement(title="Outro", mandatory="sim"),
            _requirement(title="Facultativo", mandatory=False),
        ]
    )

    assert [r["mandatory"] for r in payload["requirements"]] == [True, True, False]


def test_optional_strings_become_none():
    payload = _validated(
        risks=[_risk(recommendation="")],
        penalties=[
            {
                "description": "Multa",
                "basis": None,
                "confidence": "low",
                "citations": [],
            }
        ],
    )

    assert payload["risks"][0]["recommendation"] is None
    assert payload["penalties"][0]["basis"] is None


@pytest.mark.parametrize(
    "key, factory, cap",
    [
        ("facts", lambda i: _fact(key="k" + "a" * i), MAX_FACTS),
        (
            "dates",
            lambda i: {
                "kind": "other",
                "label": f"data {i}",
                "occurs_at": None,
                "raw_text": "x",
                "confidence": "low",
                "citations": [],
            },
            MAX_DATES,
        ),
        ("requirements", lambda i: _requirement(title=f"req {i}"), MAX_ANALYSIS_REQUIREMENTS),
        (
            "penalties",
            lambda i: {
                "description": f"multa {i}",
                "basis": None,
                "confidence": "low",
                "citations": [],
            },
            MAX_PENALTIES,
        ),
        ("risks", lambda i: _risk(title=f"risco {i}"), MAX_RISKS),
        ("missing", lambda i: {"field": f"campo {i}", "note": None}, MAX_MISSING),
    ],
)
def test_dossier_lists_are_capped(key, factory, cap):
    payload = _validated(**{key: [factory(i) for i in range(cap + 10)]})

    assert len(payload[key]) == cap


def test_executive_summary_object_and_overall_risk_are_bounded():
    payload = _validated(
        executive_summary="a" * 3000, object="b" * 3000, overall_risk="catastrofico"
    )

    assert len(payload["executive_summary"]) == 1500
    assert len(payload["object"]) == 1000
    assert payload["overall_risk"] is None


# --- occurs_at -----------------------------------------------------------


def test_naive_occurs_at_is_read_as_brazilian_civil_time():
    parsed = parse_occurs_at("2026-10-14T09:00:00")

    assert parsed == datetime(2026, 10, 14, 9, 0, tzinfo=timezone(timedelta(hours=-3)))


def test_occurs_at_with_offset_is_preserved():
    parsed = parse_occurs_at("2026-10-14T09:00:00+00:00")

    assert parsed.utcoffset() == timedelta(0)


@pytest.mark.parametrize("raw", [None, "", "  ", "14/10/2026", "em breve", 20261014])
def test_unparsable_occurs_at_becomes_none(raw):
    assert parse_occurs_at(raw) is None


def test_date_keeps_raw_text_when_the_instant_is_unparsable():
    payload = _validated(
        dates=[
            {
                "kind": "session",
                "label": "Sessão pública",
                "occurs_at": "a combinar",
                "raw_text": "data a ser definida",
                "confidence": "low",
                "citations": [],
            }
        ]
    )

    assert payload["dates"][0]["occurs_at"] is None
    assert payload["dates"][0]["raw_text"] == "data a ser definida"


# --- facet derivation ----------------------------------------------------


def test_facet_requirements_are_derived_from_the_dossier():
    payload = _validated(
        requirements=[
            _requirement(category="legal", title="Contrato social"),
            _requirement(category="fiscal_labor", title="CND"),
            _requirement(category="technical", title="Atestado"),
            _requirement(category="economic_financial", title="Balanço"),
            _requirement(category="guarantee", title="Garantia"),
        ]
    )

    assert [r["kind"] for r in payload["facet_requirements"]] == [
        "legal_qualification",
        "tax_compliance",
        "technical_qualification",
        "economic_qualification",
        "other",
    ]
    assert payload["facet_requirements"][1]["description"].startswith("CND: Certidão negativa")


def test_facet_requirement_description_is_capped_at_300_chars():
    payload = _validated(requirements=[_requirement(description="x" * 500)])

    assert len(payload["facet_requirements"][0]["description"]) == 300


def test_facet_risks_are_the_dossier_risk_titles():
    payload = _validated(risks=[_risk(title="Marca restritiva"), _risk(title="Prazo curto")])

    assert payload["facet_risks"] == ["Marca restritiva", "Prazo curto"]


def test_facet_keys_keep_the_1_0_contract():
    payload = _validated()

    # normalize_term: lowercase, accent-free
    assert payload["categories"] == ["material escolar"]
    assert payload["concepts"] == ["lapis"]
    assert payload["cnae_candidates"] == [{"code": "4761003", "confidence": 0.8}]
    assert payload["delivery"] == {"location": "Rio de Janeiro", "deadline_days": 30}
    assert payload["summary"] == "Compra de lápis."
    assert payload["complexity"] == "low"
    assert payload["confidence"] == 0.7
