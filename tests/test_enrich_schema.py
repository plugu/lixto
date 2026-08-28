"""Unit tests for src/lixto/enrich/schema.py — pure functions, no I/O."""

from lixto.enrich.schema import (
    COMPLEXITIES,
    ENRICHMENT_SCHEMA,
    INPUT_KINDS,
    REQUIREMENT_KINDS,
    SCHEMA_VERSION,
    normalize_term,
    normalize_terms,
    validate_payload,
)

# --- schema shape ---------------------------------------------------------


def test_schema_is_strict_and_lists_every_property_as_required():
    assert SCHEMA_VERSION == "1.0"
    assert ENRICHMENT_SCHEMA["additionalProperties"] is False
    props = set(ENRICHMENT_SCHEMA["properties"])
    assert set(ENRICHMENT_SCHEMA["required"]) == props
    assert "keywords" in props and "cnae_candidates" in props
    delivery = ENRICHMENT_SCHEMA["properties"]["delivery"]
    assert delivery["required"] == ["location", "deadline_days"]
    assert delivery["additionalProperties"] is False


def test_schema_keys_are_english_and_match_the_columns():
    assert set(ENRICHMENT_SCHEMA["properties"]) == {
        "summary",
        "categories",
        "concepts",
        "keywords",
        "cnae_candidates",
        "requirements",
        "requires_certification",
        "requires_technical_certificate",
        "delivery",
        "risks",
        "complexity",
        "confidence",
    }
    cnae = ENRICHMENT_SCHEMA["properties"]["cnae_candidates"]["items"]
    assert cnae["required"] == ["code", "confidence"]
    requirement = ENRICHMENT_SCHEMA["properties"]["requirements"]["items"]
    assert requirement["required"] == ["kind", "description"]


def test_schema_no_longer_requires_me_epp_fields():
    """me_epp_exclusive / me_epp_preference are Tier-0 since cycle 21:
    derived from procurement_items.benefit_type_id, not asked of the LLM."""
    assert "me_epp_exclusive" not in ENRICHMENT_SCHEMA["properties"]
    assert "me_epp_preference" not in ENRICHMENT_SCHEMA["properties"]
    assert "me_epp_exclusive" not in ENRICHMENT_SCHEMA["required"]
    assert "me_epp_preference" not in ENRICHMENT_SCHEMA["required"]


def test_enums_match_the_database_checks():
    assert REQUIREMENT_KINDS == (
        "legal_qualification",
        "tax_compliance",
        "technical_qualification",
        "economic_qualification",
        "document",
        "certification",
        "sample",
        "site_visit",
        "other",
    )
    assert COMPLEXITIES == ("low", "medium", "high")
    assert INPUT_KINDS == ("structured", "text", "pdf")
    assert ENRICHMENT_SCHEMA["properties"]["complexity"]["enum"] == list(COMPLEXITIES)
    kind = ENRICHMENT_SCHEMA["properties"]["requirements"]["items"]["properties"]["kind"]
    assert kind["enum"] == list(REQUIREMENT_KINDS)


# --- normalization --------------------------------------------------------


def test_normalize_term_strips_accents_case_and_whitespace():
    assert normalize_term("Lápis Preto  nº 2 ") == "lapis preto no 2"
    assert normalize_term("  CANETA\tESFEROGRÁFICA\n") == "caneta esferografica"
    assert normalize_term("Manutenção Predial") == "manutencao predial"
    assert normalize_term("") == ""


def test_normalize_terms_dedupes_drops_empty_and_caps():
    assert normalize_terms(["Lápis", "lapis", "  ", "Caneta"]) == ["lapis", "caneta"]
    # 40-char cap
    long_term = "a" * 60
    assert normalize_terms([long_term]) == ["a" * 40]
    # 50-item cap
    assert len(normalize_terms([f"termo {i}" for i in range(80)])) == 50


def test_normalize_terms_handles_non_list():
    assert normalize_terms(None) == []


# --- validate_payload -----------------------------------------------------


def _payload(**overrides):
    payload = {
        "summary": "Aquisição de material de escritório.",
        "categories": ["Material de Escritório"],
        "concepts": ["Papelaria"],
        "keywords": ["Lápis", "lapis", "Caneta"],
        "cnae_candidates": [
            {"code": "4761-0/03", "confidence": 0.8},
            {"code": "123", "confidence": 0.9},  # too short
            {"code": "4789099", "confidence": 5},  # confidence out of range
        ],
        "requirements": [
            {"kind": "tax_compliance", "description": "CND federal"},
            {"kind": "coisa_inventada", "description": "?"},
        ],
        "requires_certification": False,
        "requires_technical_certificate": True,
        "me_epp_exclusive": True,
        "me_epp_preference": False,
        "delivery": {"location": "", "deadline_days": -1},
        "risks": ["Prazo apertado", "  "],
        "complexity": "low",
        "confidence": 0.7,
    }
    payload.update(overrides)
    return payload


def test_validate_payload_normalizes_and_filters():
    out = validate_payload(_payload())

    assert out["categories"] == ["material de escritorio"]
    assert out["keywords"] == ["lapis", "caneta"]
    assert out["cnae_candidates"] == [{"code": "4761003", "confidence": 0.8}]
    assert out["requirements"] == [{"kind": "tax_compliance", "description": "CND federal"}]
    assert all(r["kind"] in REQUIREMENT_KINDS for r in out["requirements"])
    assert out["risks"] == ["Prazo apertado"]
    assert out["complexity"] == "low"


def test_validate_payload_maps_unknown_delivery_sentinels_to_none():
    out = validate_payload(_payload())
    assert out["delivery"] == {"location": None, "deadline_days": None}

    out = validate_payload(_payload(delivery={"location": " Rio de Janeiro ", "deadline_days": 30}))
    assert out["delivery"] == {"location": "Rio de Janeiro", "deadline_days": 30}


def test_validate_payload_rejects_bad_complexity_and_non_dict():
    assert validate_payload(_payload(complexity="impossivel")) is None
    assert validate_payload(_payload(complexity="baixa")) is None  # legacy pt value
    assert validate_payload("not a dict") is None
    assert validate_payload(None) is None


def test_validate_payload_tolerates_missing_optional_values():
    out = validate_payload({"complexity": "high"})
    assert out["complexity"] == "high"
    assert out["summary"] is None
    assert out["keywords"] == []
    assert out["cnae_candidates"] == []
    assert out["delivery"] is None
    assert out["confidence"] is None
    assert out["requires_certification"] is None


def test_validate_payload_clamps_confidence():
    assert validate_payload(_payload(confidence=3))["confidence"] == 1.0
    assert validate_payload(_payload(confidence=-1))["confidence"] == 0.0
    assert validate_payload(_payload(confidence=True))["confidence"] is None


def test_validate_payload_drops_me_epp_fields_even_if_a_model_still_emits_them():
    """me_epp_exclusive / me_epp_preference are Tier-0 (worker.derive_me_epp);
    validate_payload tolerates a stray model response that still includes
    them by dropping rather than erroring on them."""
    out = validate_payload(_payload())
    assert "me_epp_exclusive" not in out
    assert "me_epp_preference" not in out
