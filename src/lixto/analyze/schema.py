"""Tender-analysis contract (schema 2.0).

`ANALYSIS_SCHEMA` is what the model is asked for: the enrichment facet keys of
`lixto.enrich.schema.ENRICHMENT_SCHEMA` (so the match engine, semantic search,
recommend and digest keep working unchanged) plus the cited dossier the detail
page renders. Strict `json_schema` mode is the target, so every object lists
`additionalProperties: false` and a `required` naming *every* property;
optional values are encoded as explicit nulls.

`validate_analysis` turns a raw model response into exactly what the tables
store. Two guardrails live here rather than in the prompt, because a prompt is
a request and a validator is a contract:

- a citation only survives when it points at a document sequence we actually
  fed the model and a page that document really has;
- a statement claiming to be a `fact` with no surviving citation is demoted to
  `inference` with `confidence='low'` — an uncited fact is an opinion.

The dossier keys keep the model's names (`requirements`, `risks` are the rich,
cited shapes). The flat enrichment facets derived from them live under
`facet_requirements` / `facet_risks`, since the two shapes collide by name and
`procurement_requirements.kind` / `procurement_enrichments.risks` must keep
their 1.0 contract.
"""

from __future__ import annotations

import copy
import re
from datetime import datetime, timedelta, timezone
from typing import Any

from lixto.enrich.schema import (
    ENRICHMENT_SCHEMA,
    _as_bool,
    _clean_requirements,
    _clean_strings,
    validate_payload,
)

SCHEMA_VERSION = "2.0"

# Enumerations — each mirrors a CHECK constraint in migrations/005.
FACT_GROUPS = ("basic", "commercial")
STATEMENT_KINDS = ("fact", "inference")
CONFIDENCES = ("high", "medium", "low")
SEVERITIES = ("low", "medium", "high", "critical")
OVERALL_RISKS = ("low", "medium", "high", "critical")
DATE_KINDS = (
    "proposal_deadline",
    "session",
    "clarification_deadline",
    "challenge_deadline",
    "site_visit",
    "contract_start",
    "delivery",
    "other",
)
ANALYSIS_REQUIREMENT_CATEGORIES = (
    "participation",
    "legal",
    "fiscal_labor",
    "economic_financial",
    "technical",
    "specification",
    "guarantee",
    "other",
)
RISK_KINDS = ("risk", "red_flag", "contradiction", "amendment")

# List caps: a runaway model must not be able to write thousands of rows.
MAX_FACTS = 40
MAX_DATES = 20
MAX_ANALYSIS_REQUIREMENTS = 80
MAX_PENALTIES = 20
MAX_RISKS = 40
MAX_MISSING = 30

EXECUTIVE_SUMMARY_CHARS = 1500
OBJECT_CHARS = 1000
FACET_REQUIREMENT_CHARS = 300

# Brazilian civil time: an edital that writes "14/10/2026 09:00" means -03:00.
BRAZIL_OFFSET = timezone(timedelta(hours=-3))

# Dossier requirement category -> `procurement_requirements.kind` (schema 1.0).
FACET_KIND_BY_CATEGORY = {
    "legal": "legal_qualification",
    "fiscal_labor": "tax_compliance",
    "technical": "technical_qualification",
    "economic_financial": "economic_qualification",
}

# The facet half of the payload, reused verbatim from the 1.0 contract.
# `requirements` and `risks` are deliberately absent: both are derived from the
# dossier lists below instead of being asked for twice.
_FACET_KEYS = (
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
)

_CITATIONS_SCHEMA: dict[str, Any] = {
    "type": "array",
    "items": {
        "type": "object",
        "properties": {
            "sequence": {"type": "integer"},
            "page": {"type": "integer"},
        },
        "required": ["sequence", "page"],
        "additionalProperties": False,
    },
}


def _object(properties: dict[str, Any]) -> dict[str, Any]:
    """Strict-mode object schema: every property required, nothing else
    accepted."""
    return {
        "type": "object",
        "properties": properties,
        "required": list(properties),
        "additionalProperties": False,
    }


def _enum(values: tuple[str, ...]) -> dict[str, Any]:
    return {"type": "string", "enum": list(values)}


_DOSSIER_PROPERTIES: dict[str, Any] = {
    "executive_summary": {"type": "string"},
    "object": {"type": "string"},
    "overall_risk": _enum(OVERALL_RISKS),
    "facts": {
        "type": "array",
        "items": _object(
            {
                "group": _enum(FACT_GROUPS),
                "key": {"type": "string"},
                "label": {"type": "string"},
                "value": {"type": "string"},
                "statement_kind": _enum(STATEMENT_KINDS),
                "confidence": _enum(CONFIDENCES),
                "citations": _CITATIONS_SCHEMA,
            }
        ),
    },
    "dates": {
        "type": "array",
        "items": _object(
            {
                "kind": _enum(DATE_KINDS),
                "label": {"type": "string"},
                "occurs_at": {"type": ["string", "null"]},
                "raw_text": {"type": "string"},
                "confidence": _enum(CONFIDENCES),
                "citations": _CITATIONS_SCHEMA,
            }
        ),
    },
    "requirements": {
        "type": "array",
        "items": _object(
            {
                "category": _enum(ANALYSIS_REQUIREMENT_CATEGORIES),
                "title": {"type": "string"},
                "description": {"type": "string"},
                "mandatory": {"type": "boolean"},
                "severity": _enum(SEVERITIES),
                "statement_kind": _enum(STATEMENT_KINDS),
                "confidence": _enum(CONFIDENCES),
                "citations": _CITATIONS_SCHEMA,
            }
        ),
    },
    "penalties": {
        "type": "array",
        "items": _object(
            {
                "description": {"type": "string"},
                "basis": {"type": ["string", "null"]},
                "confidence": _enum(CONFIDENCES),
                "citations": _CITATIONS_SCHEMA,
            }
        ),
    },
    "risks": {
        "type": "array",
        "items": _object(
            {
                "kind": _enum(RISK_KINDS),
                "severity": _enum(SEVERITIES),
                "title": {"type": "string"},
                "description": {"type": "string"},
                "recommendation": {"type": ["string", "null"]},
                "citations": _CITATIONS_SCHEMA,
            }
        ),
    },
    "missing": {
        "type": "array",
        "items": _object(
            {
                "field": {"type": "string"},
                "note": {"type": ["string", "null"]},
            }
        ),
    },
}

ANALYSIS_SCHEMA: dict[str, Any] = _object(
    {
        **{key: copy.deepcopy(ENRICHMENT_SCHEMA["properties"][key]) for key in _FACET_KEYS},
        **_DOSSIER_PROPERTIES,
    }
)

# Fact keys are identifiers, not prose: they key `tender_analysis_facts`
# (UNIQUE per procurement) and the UI groups on them.
_FACT_KEY_RE = re.compile(r"^[a-z_]+$")

# Suggested fact keys, surfaced in the prompt. Not enforced: an edital may
# carry a field we didn't anticipate, and dropping it would be worse than a
# key the UI doesn't have a label for.
BASIC_FACT_KEYS = (
    "procurement_method",
    "dispute_type",
    "judgment_criteria",
    "estimated_value",
    "contract_duration",
    "execution_location",
    "participation_scope",
)
COMMERCIAL_FACT_KEYS = (
    "delivery_deadline",
    "delivery_location",
    "payment_terms",
    "payment_deadline",
    "price_adjustment",
    "invoice_requirements",
)


def _text(value: Any, limit: int | None = None) -> str | None:
    """Stripped non-empty string, optionally truncated; None otherwise."""
    if not isinstance(value, str):
        return None
    stripped = value.strip()
    if not stripped:
        return None
    return stripped[:limit] if limit else stripped


def _one_of(value: Any, allowed: tuple[str, ...]) -> str | None:
    return value if isinstance(value, str) and value in allowed else None


def parse_occurs_at(value: Any) -> datetime | None:
    """ISO-8601 instant from the model; naive input is read as Brazilian civil
    time (-03:00). Anything unparsable becomes None — the row still carries
    `raw_text`, which is what the UI falls back to."""
    raw = _text(value)
    if raw is None:
        return None
    try:
        parsed = datetime.fromisoformat(raw)
    except ValueError:
        return None
    if parsed.tzinfo is None:
        return parsed.replace(tzinfo=BRAZIL_OFFSET)
    return parsed


def clean_citations(value: Any, doc_pages: dict[int, int]) -> list[dict[str, int]]:
    """Keeps `{sequence, page}` pairs that point at a document we actually fed
    the model and a page it really has, deduped in order."""
    if not isinstance(value, (list, tuple)):
        return []
    out: list[dict[str, int]] = []
    seen: set[tuple[int, int]] = set()
    for item in value:
        if not isinstance(item, dict):
            continue
        sequence = item.get("sequence")
        page = item.get("page")
        if isinstance(sequence, bool) or isinstance(page, bool):
            continue
        if not isinstance(sequence, int) or not isinstance(page, int):
            continue
        pages = doc_pages.get(sequence)
        if pages is None or not 1 <= page <= pages:
            continue
        key = (sequence, page)
        if key in seen:
            continue
        seen.add(key)
        out.append({"sequence": sequence, "page": page})
    return out


def _demote_uncited_fact(entry: dict[str, Any]) -> None:
    """A `fact` must cite. One that doesn't is an inference we trust least."""
    if entry["statement_kind"] == "fact" and not entry["citations"]:
        entry["statement_kind"] = "inference"
        entry["confidence"] = "low"


def _clean_facts(value: Any, doc_pages: dict[int, int]) -> list[dict[str, Any]]:
    if not isinstance(value, (list, tuple)):
        return []
    out: list[dict[str, Any]] = []
    seen: set[str] = set()
    for item in value:
        if not isinstance(item, dict):
            continue
        group = _one_of(item.get("group"), FACT_GROUPS)
        statement_kind = _one_of(item.get("statement_kind"), STATEMENT_KINDS)
        confidence = _one_of(item.get("confidence"), CONFIDENCES)
        key = _text(item.get("key"))
        key = key.lower() if key else None
        label = _text(item.get("label"))
        val = _text(item.get("value"))
        if not (group and statement_kind and confidence and key and label and val):
            continue
        if not _FACT_KEY_RE.match(key) or key in seen:
            continue
        seen.add(key)
        entry = {
            "group": group,
            "key": key,
            "label": label,
            "value": val,
            "statement_kind": statement_kind,
            "confidence": confidence,
            "citations": clean_citations(item.get("citations"), doc_pages),
        }
        _demote_uncited_fact(entry)
        out.append(entry)
        if len(out) >= MAX_FACTS:
            break
    return out


def _clean_dates(value: Any, doc_pages: dict[int, int]) -> list[dict[str, Any]]:
    if not isinstance(value, (list, tuple)):
        return []
    out: list[dict[str, Any]] = []
    for item in value:
        if not isinstance(item, dict):
            continue
        kind = _one_of(item.get("kind"), DATE_KINDS)
        confidence = _one_of(item.get("confidence"), CONFIDENCES)
        label = _text(item.get("label"))
        raw_text = _text(item.get("raw_text"))
        if not (kind and confidence and label and raw_text):
            continue
        out.append(
            {
                "kind": kind,
                "label": label,
                "occurs_at": parse_occurs_at(item.get("occurs_at")),
                "raw_text": raw_text,
                "confidence": confidence,
                "citations": clean_citations(item.get("citations"), doc_pages),
            }
        )
        if len(out) >= MAX_DATES:
            break
    return out


def _clean_analysis_requirements(value: Any, doc_pages: dict[int, int]) -> list[dict[str, Any]]:
    if not isinstance(value, (list, tuple)):
        return []
    out: list[dict[str, Any]] = []
    for item in value:
        if not isinstance(item, dict):
            continue
        category = _one_of(item.get("category"), ANALYSIS_REQUIREMENT_CATEGORIES)
        severity = _one_of(item.get("severity"), SEVERITIES)
        statement_kind = _one_of(item.get("statement_kind"), STATEMENT_KINDS)
        confidence = _one_of(item.get("confidence"), CONFIDENCES)
        title = _text(item.get("title"))
        description = _text(item.get("description"))
        if not (category and severity and statement_kind and confidence and title and description):
            continue
        mandatory = _as_bool(item.get("mandatory"))
        entry = {
            "category": category,
            "title": title,
            "description": description,
            # A requirement is binding unless the text says otherwise: the
            # safe default for something that can disqualify a bidder.
            "mandatory": True if mandatory is None else mandatory,
            "severity": severity,
            "statement_kind": statement_kind,
            "confidence": confidence,
            "citations": clean_citations(item.get("citations"), doc_pages),
        }
        _demote_uncited_fact(entry)
        out.append(entry)
        if len(out) >= MAX_ANALYSIS_REQUIREMENTS:
            break
    return out


def _clean_penalties(value: Any, doc_pages: dict[int, int]) -> list[dict[str, Any]]:
    if not isinstance(value, (list, tuple)):
        return []
    out: list[dict[str, Any]] = []
    for item in value:
        if not isinstance(item, dict):
            continue
        confidence = _one_of(item.get("confidence"), CONFIDENCES)
        description = _text(item.get("description"))
        if not (confidence and description):
            continue
        out.append(
            {
                "description": description,
                "basis": _text(item.get("basis")),
                "confidence": confidence,
                "citations": clean_citations(item.get("citations"), doc_pages),
            }
        )
        if len(out) >= MAX_PENALTIES:
            break
    return out


def _clean_risks(value: Any, doc_pages: dict[int, int]) -> list[dict[str, Any]]:
    if not isinstance(value, (list, tuple)):
        return []
    out: list[dict[str, Any]] = []
    for item in value:
        if not isinstance(item, dict):
            continue
        kind = _one_of(item.get("kind"), RISK_KINDS)
        severity = _one_of(item.get("severity"), SEVERITIES)
        title = _text(item.get("title"))
        description = _text(item.get("description"))
        if not (kind and severity and title and description):
            continue
        out.append(
            {
                "kind": kind,
                "severity": severity,
                "title": title,
                "description": description,
                "recommendation": _text(item.get("recommendation")),
                "citations": clean_citations(item.get("citations"), doc_pages),
            }
        )
        if len(out) >= MAX_RISKS:
            break
    return out


def _clean_missing(value: Any) -> list[dict[str, Any]]:
    if not isinstance(value, (list, tuple)):
        return []
    out: list[dict[str, Any]] = []
    for item in value:
        if not isinstance(item, dict):
            continue
        field = _text(item.get("field"))
        if not field:
            continue
        out.append({"field": field, "note": _text(item.get("note"))})
        if len(out) >= MAX_MISSING:
            break
    return out


def _derive_facet_requirements(requirements: list[dict[str, Any]]) -> list[dict[str, str]]:
    """Flattens the cited dossier requirements into the 1.0 facet shape stored
    in `procurement_requirements` (kind + short description)."""
    return _clean_requirements(
        [
            {
                "kind": FACET_KIND_BY_CATEGORY.get(item["category"], "other"),
                "description": f"{item['title']}: {item['description']}"[:FACET_REQUIREMENT_CHARS],
            }
            for item in requirements
        ]
    )


def validate_analysis(raw: Any, *, doc_pages: dict[int, int]) -> dict[str, Any] | None:
    """Coerce a raw model response into the persisted analysis shape.

    Returns None when the payload is unusable — not an object, or rejected by
    the 1.0 facet validator (which also guards `complexity`). Otherwise every
    key is present: the enrichment facets, the flat `facet_requirements` /
    `facet_risks` derived from the dossier, and the six dossier lists.

    `doc_pages` maps a document `sequence` to its page count; it is the only
    thing that makes a citation trustworthy, so it is required.
    """
    if not isinstance(raw, dict):
        return None

    facets = validate_payload(raw)
    if facets is None:
        return None

    facts = _clean_facts(raw.get("facts"), doc_pages)
    dates = _clean_dates(raw.get("dates"), doc_pages)
    requirements = _clean_analysis_requirements(raw.get("requirements"), doc_pages)
    penalties = _clean_penalties(raw.get("penalties"), doc_pages)
    risks = _clean_risks(raw.get("risks"), doc_pages)
    missing = _clean_missing(raw.get("missing"))

    return {
        **facets,
        # The 1.0 facet lists, derived rather than asked for; the dossier
        # shapes below keep the `requirements`/`risks` names.
        "facet_requirements": _derive_facet_requirements(requirements),
        "facet_risks": _clean_strings([item["title"] for item in risks]),
        "executive_summary": _text(raw.get("executive_summary"), EXECUTIVE_SUMMARY_CHARS),
        "object": _text(raw.get("object"), OBJECT_CHARS),
        "overall_risk": _one_of(raw.get("overall_risk"), OVERALL_RISKS),
        "facts": facts,
        "dates": dates,
        "requirements": requirements,
        "penalties": penalties,
        "risks": risks,
        "missing": missing,
    }
