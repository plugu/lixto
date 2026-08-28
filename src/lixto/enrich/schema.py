"""Canonical global-enrichment contract.

Holds the versioned LLM JSON schema, the term-normalization rule shared with
the match engine, and the payload validator that turns a raw model response
into the exact shape the enrichment tables store.

The keys are English and map 1:1 to the columns of `procurement_enrichments`
and its facet tables (ADR 001 §D3); the prompt stays Portuguese because the
source material is. Normalization is a contract: the match engine compares a
company's terms with `procurement_enrichments.keywords/concepts` and
`procurement_categories.category` using Postgres `&&`/`=`, so both sides MUST
be normalized by `normalize_term` here.

`me_epp_exclusive` / `me_epp_preference` are Tier-0 since cycle 21: derived
deterministically in `lixto.enrich.worker` from
`procurement_items.benefit_type_id` (PNCP `tipoBeneficio`) rather than asked
of the LLM, so this schema no longer requires (or even accepts) them from a
model response. The two columns on `procurement_enrichments` are unchanged.
"""

from __future__ import annotations

import re
import unicodedata
from typing import Any

SCHEMA_VERSION = "1.0"

# Must stay in sync with the CHECK on procurement_requirements.kind.
REQUIREMENT_KINDS = (
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

# CHECK on procurement_enrichments.complexity.
COMPLEXITIES = ("low", "medium", "high")

# CHECK on procurement_enrichments.input_kind (replaces the legacy `fonte`).
INPUT_KINDS = ("structured", "text", "pdf")

MAX_TERM_CHARS = 40
MAX_TERMS = 50

ENRICHMENT_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "summary": {"type": "string"},
        "categories": {"type": "array", "items": {"type": "string"}},
        "concepts": {"type": "array", "items": {"type": "string"}},
        "keywords": {"type": "array", "items": {"type": "string"}},
        "cnae_candidates": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "code": {"type": "string"},
                    "confidence": {"type": "number"},
                },
                "required": ["code", "confidence"],
                "additionalProperties": False,
            },
        },
        "requirements": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "kind": {"type": "string", "enum": list(REQUIREMENT_KINDS)},
                    "description": {"type": "string"},
                },
                "required": ["kind", "description"],
                "additionalProperties": False,
            },
        },
        "requires_certification": {"type": "boolean"},
        "requires_technical_certificate": {"type": "boolean"},
        # Strict json_schema forbids optional keys, so unknowns are encoded as
        # sentinels: deadline_days = -1 and location = "" (-> None here).
        "delivery": {
            "type": "object",
            "properties": {
                "location": {"type": "string"},
                "deadline_days": {"type": "integer"},
            },
            "required": ["location", "deadline_days"],
            "additionalProperties": False,
        },
        "risks": {"type": "array", "items": {"type": "string"}},
        "complexity": {"type": "string", "enum": list(COMPLEXITIES)},
        "confidence": {"type": "number"},
    },
    "required": [
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
    ],
    "additionalProperties": False,
}

_WHITESPACE_RE = re.compile(r"\s+")
_NON_DIGITS_RE = re.compile(r"\D")


def normalize_term(s: str) -> str:
    """Lowercase, accent-stripped, whitespace-collapsed form of a term.

    Must stay byte-identical to the normalization applied to company terms —
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
    confidence in [0, 1] — the shape `procurement_cnaes` stores."""
    if not isinstance(xs, (list, tuple)):
        return []
    out: list[dict[str, Any]] = []
    seen: set[str] = set()
    for item in xs:
        if not isinstance(item, dict):
            continue
        code = _NON_DIGITS_RE.sub("", str(item.get("code") or ""))
        if len(code) != 7 or code in seen:
            continue
        confidence = item.get("confidence")
        if isinstance(confidence, bool) or not isinstance(confidence, (int, float)):
            continue
        if not 0 <= confidence <= 1:
            continue
        seen.add(code)
        out.append({"code": code, "confidence": float(confidence)})
    return out


def _clean_requirements(xs: Any) -> list[dict[str, str]]:
    if not isinstance(xs, (list, tuple)):
        return []
    out: list[dict[str, str]] = []
    for item in xs:
        if not isinstance(item, dict):
            continue
        kind = item.get("kind")
        if kind not in REQUIREMENT_KINDS:
            continue
        description = item.get("description")
        if not isinstance(description, str) or not description.strip():
            continue
        out.append({"kind": kind, "description": description.strip()})
    return out


def _clean_delivery(v: Any) -> dict[str, Any] | None:
    if not isinstance(v, dict):
        return None
    location = v.get("location")
    location = location.strip() if isinstance(location, str) and location.strip() else None
    deadline = v.get("deadline_days")
    if isinstance(deadline, bool) or not isinstance(deadline, int) or deadline < 0:
        deadline = None
    return {"location": location, "deadline_days": deadline}


def validate_payload(payload: Any) -> dict[str, Any] | None:
    """Coerce a raw model payload into the canonical enrichment shape.

    Returns None when the payload is unusable (not an object, or an unknown
    `complexity`); a missing/null `complexity` is tolerated as "unknown" since
    the column is nullable. Every key of the schema is present in the result
    so callers can index it directly.
    """
    if not isinstance(payload, dict):
        return None

    complexity = payload.get("complexity")
    if complexity is not None and complexity not in COMPLEXITIES:
        return None

    summary = payload.get("summary")
    summary = summary.strip() if isinstance(summary, str) and summary.strip() else None

    confidence = payload.get("confidence")
    if isinstance(confidence, bool) or not isinstance(confidence, (int, float)):
        confidence = None
    else:
        confidence = min(1.0, max(0.0, float(confidence)))

    return {
        "summary": summary,
        "categories": normalize_terms(payload.get("categories") or []),
        "concepts": normalize_terms(payload.get("concepts") or []),
        "keywords": normalize_terms(payload.get("keywords") or []),
        "cnae_candidates": _clean_cnaes(payload.get("cnae_candidates")),
        "requirements": _clean_requirements(payload.get("requirements")),
        "requires_certification": _as_bool(payload.get("requires_certification")),
        "requires_technical_certificate": _as_bool(payload.get("requires_technical_certificate")),
        # me_epp_exclusive / me_epp_preference are Tier-0 (worker.derive_me_epp
        # from procurement_items.benefit_type_id): dropped here even if a
        # model still emits them, since ENRICHMENT_SCHEMA no longer lists
        # them as valid properties.
        "delivery": _clean_delivery(payload.get("delivery")),
        "risks": _clean_strings(payload.get("risks")),
        "complexity": complexity,
        "confidence": confidence,
    }
