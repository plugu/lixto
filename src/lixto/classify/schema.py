"""Structured output for the ingest-time classifier (cycle 32).

One CHEAP LLM call per open tender chooses among cosine candidates; the
output is validated against those candidates so nothing outside the closed
taxonomy is ever persisted.
"""

from __future__ import annotations

from typing import Any

from lixto.classify.taxonomy import NATURES
from lixto.enrich.schema import _clean_cnaes, normalize_terms

SCHEMA_VERSION = "1"

MAX_CNAES = 3
MAX_KEYWORDS = 10
MAX_ITEMS = 20

CLASSIFICATION_SCHEMA: dict[str, Any] = {
    "type": "object",
    "additionalProperties": False,
    "properties": {
        "cnaes": {
            "type": "array",
            "maxItems": MAX_CNAES,
            "items": {
                "type": "object",
                "additionalProperties": False,
                "properties": {
                    "code": {"type": "string"},
                    "confidence": {"type": "number"},
                },
                "required": ["code", "confidence"],
            },
        },
        "segment": {"type": "string"},
        "segment_confidence": {"type": "number"},
        "nature": {"type": "string", "enum": list(NATURES)},
        "keywords": {
            "type": "array",
            "maxItems": MAX_KEYWORDS,
            "items": {"type": "string"},
        },
    },
    "required": ["cnaes", "segment", "segment_confidence", "nature", "keywords"],
}

INSTRUCTIONS = (
    "Você está classificando uma licitação pública brasileira. "
    "Escolha somente entre os candidatos listados: até 3 CNAEs (código de 7 dígitos), "
    "1 segmento (use o código) e a natureza do objeto (bens, servicos ou obras). "
    "Use confiança entre 0 e 1. Use o segmento `outros` somente quando nenhum candidato "
    "se encaixar. As palavras-chave são substantivos curtos de produtos ou serviços em "
    "português do Brasil, sem nomes de órgãos."
)


def build_prompt(
    description: str,
    items: list[str],
    cnae_candidates: list[tuple[str, str]],
    segment_candidates: list[tuple[str, str, str]],
) -> str:
    """`cnae_candidates`: (code, description); `segment_candidates`:
    (code, label, description)."""
    lines = ["## Objeto", description.strip(), "", "## Itens"]
    lines += [i.strip() for i in items[:MAX_ITEMS] if i and i.strip()]
    lines += ["", "## CNAEs candidatos"]
    lines += [f"{code} — {desc}" for code, desc in cnae_candidates]
    lines += ["", "## Segmentos candidatos"]
    lines += [f"{code} — {label} — {desc}" for code, label, desc in segment_candidates]
    return "\n".join(lines)


def _confidence(value: Any) -> float | None:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    return min(1.0, max(0.0, float(value)))


def validate_payload(
    raw: Any,
    *,
    cnae_candidates: set[str],
    segment_candidates: list[tuple[str, float]],
) -> dict[str, Any] | None:
    """Clean an LLM payload against the candidates it was shown. Returns None
    when the nature is missing/invalid (the row becomes `status='error'`)."""
    if not isinstance(raw, dict):
        return None
    nature = raw.get("nature")
    if nature not in NATURES:
        return None

    cnaes = [c for c in _clean_cnaes(raw.get("cnaes")) if c["code"] in cnae_candidates]

    cosines = dict(segment_candidates)
    segment = raw.get("segment")
    segment_confidence = _confidence(raw.get("segment_confidence"))
    if isinstance(segment, str) and segment in cosines and segment_confidence is not None:
        segment_source = "llm"
    elif segment_candidates:
        segment, cosine = segment_candidates[0]
        segment_confidence = _confidence(cosine) or 0.0
        segment_source = "cosine"
    else:
        return None

    keywords = raw.get("keywords")
    return {
        "cnaes": cnaes[:MAX_CNAES],
        "segment": segment,
        "segment_confidence": segment_confidence,
        "segment_source": segment_source,
        "nature": nature,
        "keywords": normalize_terms(keywords if isinstance(keywords, list) else [])[:MAX_KEYWORDS],
    }
