"""Unit tests for src/plic/enrich/{schema,documents}.py.

Fully mocked psycopg connection/cursors and httpx client — no network, no
live database (mirrors tests/test_agents_deep.py). The only real I/O is an
in-memory PDF built with pypdf.PdfWriter.
"""

from io import BytesIO
from unittest.mock import MagicMock

import httpx
import pytest
from pypdf import PdfWriter
from pypdf.errors import PdfReadError

from plic.enrich.documents import (
    MAX_DOCS,
    classify_extraction,
    extract_for_licitacao,
    extract_text,
    pick_documents,
)
from plic.enrich.schema import (
    ENRIQUECIMENTO_SCHEMA,
    REQUISITO_TIPOS,
    SCHEMA_VERSION,
    normalize_term,
    normalize_terms,
    validate_payload,
)

# --- schema shape ---------------------------------------------------------


def test_schema_is_strict_and_lists_every_property_as_required():
    assert SCHEMA_VERSION == "1.0"
    assert ENRIQUECIMENTO_SCHEMA["additionalProperties"] is False
    props = set(ENRIQUECIMENTO_SCHEMA["properties"])
    assert set(ENRIQUECIMENTO_SCHEMA["required"]) == props
    assert "palavras_chave" in props and "cnae_candidatos" in props
    entrega = ENRIQUECIMENTO_SCHEMA["properties"]["entrega"]
    assert entrega["required"] == ["local", "prazo_dias"]
    assert entrega["additionalProperties"] is False


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
        "resumo": "Aquisição de material de escritório.",
        "categorias": ["Material de Escritório"],
        "conceitos": ["Papelaria"],
        "palavras_chave": ["Lápis", "lapis", "Caneta"],
        "cnae_candidatos": [
            {"codigo": "4761-0/03", "confianca": 0.8},
            {"codigo": "123", "confianca": 0.9},  # too short
            {"codigo": "4789099", "confianca": 5},  # confianca out of range
        ],
        "requisitos": [
            {"tipo": "regularidade_fiscal", "descricao": "CND federal"},
            {"tipo": "coisa_inventada", "descricao": "?"},
        ],
        "exige_certificacao": False,
        "exige_atestado_tecnico": True,
        "me_epp_exclusivo": True,
        "me_epp_preferencia": False,
        "entrega": {"local": "", "prazo_dias": -1},
        "riscos": ["Prazo apertado", "  "],
        "complexidade": "baixa",
        "confianca": 0.7,
    }
    payload.update(overrides)
    return payload


def test_validate_payload_normalizes_and_filters():
    out = validate_payload(_payload())

    assert out["categorias"] == ["material de escritorio"]
    assert out["palavras_chave"] == ["lapis", "caneta"]
    assert out["cnae_candidatos"] == [{"codigo": "4761003", "confianca": 0.8}]
    assert out["requisitos"] == [{"tipo": "regularidade_fiscal", "descricao": "CND federal"}]
    assert all(r["tipo"] in REQUISITO_TIPOS for r in out["requisitos"])
    assert out["riscos"] == ["Prazo apertado"]
    assert out["complexidade"] == "baixa"


def test_validate_payload_maps_unknown_entrega_sentinels_to_none():
    out = validate_payload(_payload())
    assert out["entrega"] == {"local": None, "prazo_dias": None}

    out = validate_payload(_payload(entrega={"local": " Rio de Janeiro ", "prazo_dias": 30}))
    assert out["entrega"] == {"local": "Rio de Janeiro", "prazo_dias": 30}


def test_validate_payload_rejects_bad_complexidade_and_non_dict():
    assert validate_payload(_payload(complexidade="impossivel")) is None
    assert validate_payload("not a dict") is None
    assert validate_payload(None) is None


def test_validate_payload_tolerates_missing_optional_values():
    out = validate_payload({"complexidade": "alta"})
    assert out["complexidade"] == "alta"
    assert out["resumo"] is None
    assert out["palavras_chave"] == []
    assert out["cnae_candidatos"] == []
    assert out["entrega"] is None
    assert out["confianca"] is None
    assert out["exige_certificacao"] is None


# --- extraction classification -------------------------------------------


def test_classify_extraction_dense_text_is_pypdf():
    assert classify_extraction("x" * 3000, 3) == "pypdf"


def test_classify_extraction_sparse_text_is_insuficiente():
    assert classify_extraction("x" * 200, 10) == "insuficiente"
    assert classify_extraction("", 0) == "insuficiente"
    assert classify_extraction("x" * 400, 1) == "insuficiente"  # below MIN_TOTAL_CHARS


# --- extract_text ---------------------------------------------------------


def _blank_pdf_bytes(pages=1):
    writer = PdfWriter()
    for _ in range(pages):
        writer.add_blank_page(width=200, height=200)
    buf = BytesIO()
    writer.write(buf)
    return buf.getvalue()


def test_extract_text_on_blank_pdf_returns_empty_text_and_page_count():
    text, paginas = extract_text(_blank_pdf_bytes(1))
    assert paginas == 1
    assert text.strip() == ""
    assert classify_extraction(text, paginas) == "insuficiente"


def test_extract_text_raises_on_garbage():
    """Unparseable bytes must propagate; extract_for_licitacao maps that to
    metodo='falha' rather than swallowing it here."""
    with pytest.raises(PdfReadError):
        extract_text(b"not a pdf at all")


# --- extract_for_licitacao ------------------------------------------------


def _doc(seq=1, url="https://pncp/doc1"):
    return {
        "sequencial_documento": seq,
        "titulo": "Edital",
        "tipo_documento_id": 2,
        "tipo_documento_nome": "Edital",
        "url": url,
    }


def _pdf_response(content=None):
    resp = MagicMock()
    resp.headers = {"content-type": "application/pdf"}
    resp.content = content if content is not None else _blank_pdf_bytes(1)
    resp.raise_for_status.return_value = None
    return resp


def _conn(docs, textos):
    """Cursor order inside extract_for_licitacao: pick_documents,
    _existing_textos, then one upsert cursor per processed document."""
    docs_cur = MagicMock()
    docs_cur.fetchall.return_value = docs
    textos_cur = MagicMock()
    textos_cur.fetchall.return_value = textos
    upsert_curs = [MagicMock() for _ in range(4)]

    conn = MagicMock()
    conn.cursor.return_value.__enter__.side_effect = [docs_cur, textos_cur, *upsert_curs]
    conn.cursor.return_value.__exit__.return_value = False
    return conn, upsert_curs


def _http_client(responses_by_url):
    client = MagicMock(spec=httpx.Client)

    def _get(url, timeout=None, follow_redirects=None):
        resp = responses_by_url[url]
        if isinstance(resp, Exception):
            raise resp
        return resp

    client.get.side_effect = _get
    return client


def test_extract_for_licitacao_reuses_cached_row_and_downloads_the_other():
    cached = {
        "sequencial_documento": 1,
        "metodo": "pypdf",
        "paginas": 12,
        "chars": 5000,
        "texto": "texto do edital",
    }
    conn, upsert_curs = _conn([_doc(1), _doc(2, "https://pncp/doc2")], [cached])
    client = _http_client({"https://pncp/doc2": _pdf_response()})

    rows = extract_for_licitacao(conn, "num-1", client)

    assert len(rows) == 2
    assert client.get.call_count == 1  # cached doc not re-downloaded

    reused, fresh = rows
    assert reused["metodo"] == "pypdf"
    assert reused["texto"] == "texto do edital"
    assert reused["pdf_bytes"] is None

    assert fresh["sequencial_documento"] == 2
    assert fresh["metodo"] == "insuficiente"  # blank page -> no text
    assert fresh["paginas"] == 1
    assert fresh["pdf_bytes"] is not None

    upserted = [c for c in upsert_curs if c.execute.call_args is not None]
    assert len(upserted) == 1  # only the freshly downloaded document
    params = upserted[0].execute.call_args.args[1]
    assert params["numero"] == "num-1"
    assert params["sequencial_documento"] == 2
    assert params["metodo"] == "insuficiente"
    conn.commit.assert_called_once()


def test_extract_for_licitacao_marks_non_pdf_and_download_failure():
    html = MagicMock()
    html.headers = {"content-type": "text/html"}
    html.content = b"<html></html>"
    html.raise_for_status.return_value = None

    conn, _ = _conn([_doc(1), _doc(2, "https://pncp/doc2")], [])
    client = _http_client(
        {
            "https://pncp/doc1": html,
            "https://pncp/doc2": httpx.ConnectError("boom"),
        }
    )

    rows = extract_for_licitacao(conn, "num-1", client)

    assert [r["metodo"] for r in rows] == ["nao_pdf", "falha"]
    assert all(r["chars"] == 0 and r["texto"] is None for r in rows)


def test_extract_for_licitacao_processes_at_most_max_docs():
    conn, _ = _conn([_doc(i, f"https://pncp/doc{i}") for i in range(1, 5)], [])
    client = _http_client({f"https://pncp/doc{i}": _pdf_response() for i in range(1, 5)})

    rows = extract_for_licitacao(conn, "num-1", client)

    assert len(rows) == MAX_DOCS
    assert client.get.call_count == MAX_DOCS


def test_extract_for_licitacao_without_documents_does_nothing():
    conn, _ = _conn([], [])
    client = _http_client({})

    assert extract_for_licitacao(conn, "num-1", client) == []
    client.get.assert_not_called()


def test_pick_documents_orders_edital_first_and_filters_inactive():
    conn = MagicMock()
    cur = MagicMock()
    cur.fetchall.return_value = [_doc()]
    conn.cursor.return_value.__enter__.return_value = cur

    docs = pick_documents(conn, "num-1")

    assert docs == [_doc()]
    sql, params = cur.execute.call_args.args
    assert "status_ativo IS TRUE" in sql
    assert "tipo_documento_id = 2" in sql
    assert params == {"numero": "num-1"}
