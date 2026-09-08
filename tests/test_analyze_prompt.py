"""Unit tests for src/lixto/analyze/prompt.py — instructions and the
page-tagged prompt. Pure functions: no network, no database.
"""

from datetime import UTC, datetime

import pytest

from lixto.analyze.prompt import (
    DEFAULT_MAX_CHARS,
    INSTRUCTIONS,
    MAX_ITEMS,
    build_prompt,
    order_documents,
)


def _row(**overrides):
    return {
        "id": 1,
        "source_id": "12345678000190-1-000012/2026",
        "description": "Aquisição de lápis grafite para escolas municipais",
        "additional_info": "Entrega parcelada",
        "modality_name": "Pregão Eletrônico",
        "state": "RJ",
        "city_name": "Rio de Janeiro",
        "estimated_value": 12345,
        "published_at": "2026-08-01",
        "proposal_opens_at": "2026-08-05",
        "proposal_closes_at": "2026-09-01",
        "is_price_registry": True,
        "agency_name": "Prefeitura do Rio",
        **overrides,
    }


def _item(description="Lápis preto nº 2", quantity=100):
    return {
        "description": description,
        "quantity": quantity,
        "unit": "UN",
        "estimated_unit_price": "1.50",
        "kind": "material",
    }


def _doc(seq=1, *, pages=2, title="Edital 12/2026", type_id=2, published_at=None, texts=None):
    page_texts = texts if texts is not None else [f"página {i} do doc {seq}" for i in range(pages)]
    return {
        "sequence": seq,
        "method": "pypdf" if page_texts else "insufficient",
        "pages": len(page_texts) if page_texts else pages,
        "chars": sum(len(t) for t in (page_texts or [])),
        "text": "\n\n".join(page_texts or []),
        "page_texts": page_texts or None,
        "title": title,
        "type_id": type_id,
        "type_name": None,
        "published_at": published_at,
        "url": f"https://pncp/doc{seq}",
        "pdf_bytes": None,
    }


def _at(day):
    return datetime(2026, 8, day, 12, 0, tzinfo=UTC)


# --- instructions --------------------------------------------------------


def test_instructions_cover_the_dossier_fields():
    for field in (
        "executive_summary",
        "object",
        "overall_risk",
        "facts",
        "dates",
        "requirements",
        "penalties",
        "risks",
        "missing",
        "citations",
        "statement_kind",
    ):
        assert field in INSTRUCTIONS


def test_instructions_keep_the_facet_rules_of_schema_1_0():
    for field in (
        "summary",
        "categories",
        "concepts",
        "keywords",
        "cnae_candidates",
        "requires_certification",
        "requires_technical_certificate",
        "delivery",
        "complexity",
        "confidence",
    ):
        assert field in INSTRUCTIONS
    assert "0000-0/00" in INSTRUCTIONS
    assert "SEM acentos" in INSTRUCTIONS
    assert "deadline_days -1" in INSTRUCTIONS


def test_instructions_state_the_evidence_rules():
    assert "Nunca invente" in INSTRUCTIONS
    assert "missing" in INSTRUCTIONS
    assert "contradiction" in INSTRUCTIONS
    assert "amendment" in INSTRUCTIONS
    assert "red_flag" in INSTRUCTIONS
    assert "pode merecer análise jurídica" in INSTRUCTIONS
    assert "[DOC n | título | página p]" in INSTRUCTIONS
    # company-agnostic
    assert "agnóstico de empresa" in INSTRUCTIONS


def test_instructions_list_the_suggested_fact_keys():
    for key in ("procurement_method", "judgment_criteria", "payment_deadline", "price_adjustment"):
        assert key in INSTRUCTIONS


# --- structured section --------------------------------------------------


def test_structured_section_carries_the_pncp_fields():
    prompt, chars, truncated = build_prompt(_row(), [], [])

    assert "## Dados estruturados (PNCP)" in prompt
    assert "Aquisição de lápis grafite" in prompt
    assert "Pregão Eletrônico" in prompt
    assert "RJ / Rio de Janeiro" in prompt
    assert "Prefeitura do Rio" in prompt
    assert "SRP" in prompt
    assert "Publicação: 2026-08-01" in prompt
    assert "Abertura das propostas: 2026-08-05" in prompt
    assert "Encerramento das propostas: 2026-09-01" in prompt
    assert "Identificador PNCP: 12345678000190-1-000012/2026" in prompt
    assert chars == len(prompt)
    assert truncated is False


def test_me_epp_line_is_included_when_derived():
    prompt, _, _ = build_prompt(_row(), [], [], me_epp=(True, False))
    assert "Benefício ME/EPP (PNCP): exclusivo" in prompt

    prompt, _, _ = build_prompt(_row(), [], [], me_epp=(None, None))
    assert "ME/EPP" not in prompt


def test_items_section_is_capped_at_max_items():
    items = [_item(f"Item {i}") for i in range(MAX_ITEMS + 10)]

    prompt, _, _ = build_prompt(_row(), items, [])

    assert "## Itens (PNCP)" in prompt
    assert f"{MAX_ITEMS}. Item {MAX_ITEMS - 1}" in prompt
    assert f"{MAX_ITEMS + 1}." not in prompt
    assert "100 UN" in prompt
    assert "R$ 1.50" in prompt


# --- document index ------------------------------------------------------


def test_document_index_lists_every_document():
    docs = [
        _doc(1, title="Edital 12/2026", published_at=_at(3)),
        _doc(2, title="Anexo I", type_id=16, published_at=_at(4), texts=[]),
    ]

    prompt, _, _ = build_prompt(_row(), [], docs)

    assert (
        '[DOC 1] "Edital 12/2026" (tipo: id 2; publicado: 2026-08-03; 2 páginas; texto: sim)'
        in (prompt)
    )
    assert '[DOC 2] "Anexo I" (tipo: id 16; publicado: 2026-08-04; 2 páginas; texto: não)' in prompt


def test_document_without_publication_date_is_reported_as_such():
    prompt, _, _ = build_prompt(_row(), [], [_doc(1, published_at=None)])
    assert "publicado: sem data" in prompt


# --- ordering ------------------------------------------------------------


def test_edital_comes_first_then_oldest_documents():
    docs = [
        _doc(3, title="Anexo III", type_id=16, published_at=_at(9)),
        _doc(2, title="Retificação", type_id=16, published_at=_at(7)),
        _doc(1, title="Edital 12/2026", type_id=2, published_at=_at(20)),
    ]

    assert [d["sequence"] for d in order_documents(docs)] == [1, 2, 3]


def test_edital_is_detected_by_title_when_the_type_is_wrong():
    docs = [
        _doc(2, title="Anexo", type_id=16, published_at=_at(1)),
        _doc(1, title="EDITAL retificado", type_id=16, published_at=_at(9)),
    ]

    assert [d["sequence"] for d in order_documents(docs)] == [1, 2]


def test_undated_documents_sort_before_dated_ones():
    docs = [
        _doc(2, title="Anexo B", type_id=16, published_at=_at(1)),
        _doc(3, title="Anexo C", type_id=16, published_at=None),
    ]

    assert [d["sequence"] for d in order_documents(docs)] == [3, 2]


def test_text_section_follows_the_document_order():
    docs = [
        _doc(2, title="Retificação", type_id=16, published_at=_at(7), texts=["texto da retif"]),
        _doc(1, title="Edital 12/2026", type_id=2, published_at=_at(20), texts=["texto do edital"]),
    ]

    prompt, _, _ = build_prompt(_row(), [], docs)

    assert prompt.index("texto do edital") < prompt.index("texto da retif")


# --- page tags and truncation --------------------------------------------


def test_every_page_carries_a_doc_page_tag():
    docs = [_doc(1, title="Edital 12/2026", texts=["primeira", "segunda"])]

    prompt, _, truncated = build_prompt(_row(), [], docs)

    assert "## Texto dos documentos" in prompt
    assert "[DOC 1 | Edital 12/2026 | página 1]\nprimeira" in prompt
    assert "[DOC 1 | Edital 12/2026 | página 2]\nsegunda" in prompt
    assert truncated is False


def test_long_titles_are_truncated_in_the_page_tag():
    docs = [_doc(1, title="E" * 200, texts=["conteúdo"])]

    prompt, _, _ = build_prompt(_row(), [], docs)

    assert f"[DOC 1 | {'E' * 60} | página 1]" in prompt


def test_pages_stop_at_max_chars_and_report_the_omission():
    docs = [_doc(1, title="Edital", texts=["a" * 100, "b" * 100, "c" * 100])]

    prompt, chars, truncated = build_prompt(_row(), [], docs, max_chars=200)

    assert truncated is True
    assert "a" * 100 in prompt
    assert "c" * 100 not in prompt
    assert "[TRUNCADO: 2 de 3 páginas omitidas" in prompt
    assert "registre os documentos não lidos em missing]" in prompt
    assert chars == len(prompt)


def test_truncation_counts_pages_of_documents_never_reached():
    docs = [
        _doc(1, title="Edital", type_id=2, texts=["a" * 100]),
        _doc(2, title="Anexo", type_id=16, texts=["b" * 100, "c" * 100]),
    ]

    prompt, _, truncated = build_prompt(_row(), [], docs, max_chars=150)

    assert truncated is True
    assert "[TRUNCADO: 2 de 3 páginas omitidas" in prompt


def test_documents_without_text_add_no_pages_and_no_truncation():
    docs = [_doc(1, title="Escaneado", texts=[])]

    prompt, _, truncated = build_prompt(_row(), [], docs)

    assert truncated is False
    assert "## Texto dos documentos" not in prompt


def test_default_max_chars_is_400k():
    assert DEFAULT_MAX_CHARS == 400_000


@pytest.mark.parametrize("field", ["additional_info", "modality_name", "agency_name"])
def test_missing_structured_fields_are_simply_omitted(field):
    prompt, _, _ = build_prompt(_row(**{field: None}), [], [])
    assert prompt.count("None") == 0
