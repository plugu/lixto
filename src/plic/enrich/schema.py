"""Canonical global-enrichment contract (cycle 16, ticket 63).

Holds the versioned LLM JSON schema, the term-normalization rule shared with
the match engine, and the payload validator that turns a raw model response
into the exact shape `enriquecimento` stores.

Normalization is a contract: the match engine compares the empresa's terms
with `enriquecimento.palavras_chave/conceitos/categorias` using Postgres
`&&`, so both sides MUST be normalized by `normalize_term` here.
"""

from __future__ import annotations

import re
import unicodedata
from typing import Any

SCHEMA_VERSION = "1.0"

REQUISITO_TIPOS = (
    "habilitacao_juridica",
    "regularidade_fiscal",
    "qualificacao_tecnica",
    "qualificacao_economica",
    "documento",
    "certificacao",
    "amostra",
    "visita_tecnica",
    "outro",
)

COMPLEXIDADES = ("baixa", "media", "alta")

MAX_TERM_CHARS = 40
MAX_TERMS = 50

FONTES = ("estruturado", "texto", "pdf")

ENRIQUECIMENTO_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "resumo": {"type": "string"},
        "categorias": {"type": "array", "items": {"type": "string"}},
        "conceitos": {"type": "array", "items": {"type": "string"}},
        "palavras_chave": {"type": "array", "items": {"type": "string"}},
        "cnae_candidatos": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "codigo": {"type": "string"},
                    "confianca": {"type": "number"},
                },
                "required": ["codigo", "confianca"],
                "additionalProperties": False,
            },
        },
        "requisitos": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "tipo": {"type": "string", "enum": list(REQUISITO_TIPOS)},
                    "descricao": {"type": "string"},
                },
                "required": ["tipo", "descricao"],
                "additionalProperties": False,
            },
        },
        "exige_certificacao": {"type": "boolean"},
        "exige_atestado_tecnico": {"type": "boolean"},
        "me_epp_exclusivo": {"type": "boolean"},
        "me_epp_preferencia": {"type": "boolean"},
        # Strict json_schema forbids optional keys, so unknowns are encoded as
        # sentinels: prazo_dias = -1 and local = "" (validate_payload -> None).
        "entrega": {
            "type": "object",
            "properties": {
                "local": {"type": "string"},
                "prazo_dias": {"type": "integer"},
            },
            "required": ["local", "prazo_dias"],
            "additionalProperties": False,
        },
        "riscos": {"type": "array", "items": {"type": "string"}},
        "complexidade": {"type": "string", "enum": list(COMPLEXIDADES)},
        "confianca": {"type": "number"},
    },
    "required": [
        "resumo",
        "categorias",
        "conceitos",
        "palavras_chave",
        "cnae_candidatos",
        "requisitos",
        "exige_certificacao",
        "exige_atestado_tecnico",
        "me_epp_exclusivo",
        "me_epp_preferencia",
        "entrega",
        "riscos",
        "complexidade",
        "confianca",
    ],
    "additionalProperties": False,
}

_WHITESPACE_RE = re.compile(r"\s+")
_NON_DIGITS_RE = re.compile(r"\D")


def normalize_term(s: str) -> str:
    """Lowercase, accent-stripped, whitespace-collapsed form of a term.

    Must stay byte-identical to the normalization applied to empresa terms —
    the match engine compares the two with array overlap.
    """
    if not isinstance(s, str):
        return ""
    ascii_only = unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode()
    return _WHITESPACE_RE.sub(" ", ascii_only).strip().lower()


def normalize_terms(xs: list[str]) -> list[str]:
    """Normalize a term list: drop empties, truncate to MAX_TERM_CHARS,
    dedupe preserving order, cap at MAX_TERMS items."""
    if not isinstance(xs, (list, tuple)):
        return []
    out: list[str] = []
    seen: set[str] = set()
    for x in xs:
        term = normalize_term(x)[:MAX_TERM_CHARS].strip()
        if not term or term in seen:
            continue
        seen.add(term)
        out.append(term)
        if len(out) >= MAX_TERMS:
            break
    return out


def _clean_strings(xs: Any, limit: int = MAX_TERMS) -> list[str]:
    if not isinstance(xs, (list, tuple)):
        return []
    return [x.strip() for x in xs if isinstance(x, str) and x.strip()][:limit]


def _as_bool(v: Any) -> bool | None:
    return v if isinstance(v, bool) else None


def _clean_cnaes(xs: Any) -> list[dict[str, Any]]:
    """Keeps only 7-digit CNAE codes (punctuation stripped) with a
    confidence in [0, 1]."""
    if not isinstance(xs, (list, tuple)):
        return []
    out: list[dict[str, Any]] = []
    seen: set[str] = set()
    for item in xs:
        if not isinstance(item, dict):
            continue
        codigo = _NON_DIGITS_RE.sub("", str(item.get("codigo") or ""))
        if len(codigo) != 7 or codigo in seen:
            continue
        confianca = item.get("confianca")
        if isinstance(confianca, bool) or not isinstance(confianca, (int, float)):
            continue
        if not 0 <= confianca <= 1:
            continue
        seen.add(codigo)
        out.append({"codigo": codigo, "confianca": float(confianca)})
    return out


def _clean_requisitos(xs: Any) -> list[dict[str, str]]:
    if not isinstance(xs, (list, tuple)):
        return []
    out: list[dict[str, str]] = []
    for item in xs:
        if not isinstance(item, dict):
            continue
        tipo = item.get("tipo")
        if tipo not in REQUISITO_TIPOS:
            continue
        descricao = item.get("descricao")
        if not isinstance(descricao, str) or not descricao.strip():
            continue
        out.append({"tipo": tipo, "descricao": descricao.strip()})
    return out


def _clean_entrega(v: Any) -> dict[str, Any] | None:
    if not isinstance(v, dict):
        return None
    local = v.get("local")
    local = local.strip() if isinstance(local, str) and local.strip() else None
    prazo = v.get("prazo_dias")
    if isinstance(prazo, bool) or not isinstance(prazo, int) or prazo < 0:
        prazo = None
    return {"local": local, "prazo_dias": prazo}


def validate_payload(payload: Any) -> dict[str, Any] | None:
    """Coerce a raw model payload into the canonical enrichment shape.

    Returns None when the payload is unusable (not an object, or an unknown
    `complexidade`); a missing/null `complexidade` is tolerated as "unknown"
    since the column is nullable. Every key of the schema is present in the
    result so callers can index it directly.
    """
    if not isinstance(payload, dict):
        return None

    complexidade = payload.get("complexidade")
    if complexidade is not None and complexidade not in COMPLEXIDADES:
        return None

    resumo = payload.get("resumo")
    resumo = resumo.strip() if isinstance(resumo, str) and resumo.strip() else None

    confianca = payload.get("confianca")
    if isinstance(confianca, bool) or not isinstance(confianca, (int, float)):
        confianca = None
    else:
        confianca = min(1.0, max(0.0, float(confianca)))

    return {
        "resumo": resumo,
        "categorias": normalize_terms(payload.get("categorias") or []),
        "conceitos": normalize_terms(payload.get("conceitos") or []),
        "palavras_chave": normalize_terms(payload.get("palavras_chave") or []),
        "cnae_candidatos": _clean_cnaes(payload.get("cnae_candidatos")),
        "requisitos": _clean_requisitos(payload.get("requisitos")),
        "exige_certificacao": _as_bool(payload.get("exige_certificacao")),
        "exige_atestado_tecnico": _as_bool(payload.get("exige_atestado_tecnico")),
        "me_epp_exclusivo": _as_bool(payload.get("me_epp_exclusivo")),
        "me_epp_preferencia": _as_bool(payload.get("me_epp_preferencia")),
        "entrega": _clean_entrega(payload.get("entrega")),
        "riscos": _clean_strings(payload.get("riscos")),
        "complexidade": complexidade,
        "confianca": confianca,
    }
