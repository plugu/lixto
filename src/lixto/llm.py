"""Provider-abstracted LLM client.

One module the whole Python side uses, so switching provider (Gemini's
OpenAI-compatible endpoint, OpenAI itself, a gateway, a local server) is an env
change and not a code change. Three entry points:

- `complete_json_text` — Chat Completions with `response_format` json_schema,
  the portable shape every OpenAI-compatible provider implements.
- `complete_json_pdf`  — the same Chat Completions shape with inline base64
  PDFs as `file` content parts (portable; no Responses API).
- `embed`              — batched embeddings for `procurement_embeddings`,
  pinned to EMBED_DIMS so every vector in the table is comparable.

Model tiers are env-configured (`LIXTO_LLM_MODEL_*`): cheap (clean text), doc
(PDF input), strong (reserved for deep reasoning).

Failure handling buys exactly one retry per call, on the first of these that is
configured:

1. a second *provider* (`LIXTO_LLM_FALLBACK_BASE_URL` / `_API_KEY` plus
   `LIXTO_LLM_FALLBACK_MODEL_CHEAP|DOC|STRONG`) — the cross-provider lane, used
   when the primary errors or returns unusable JSON;
2. a second *model on the same client* (`LIXTO_LLM_MODEL_FALLBACK`).

Embeddings never fall back: all vectors in a table must come from one model.

Every chat/embeddings response's token usage accumulates in `self.usage` (per
model) and is priced by `PRICES_USD_PER_M`; `usage_summary()` is what run
counters persist.
"""

from __future__ import annotations

import base64
import json
import logging
import os
from typing import Any

from openai import OpenAI

logger = logging.getLogger(__name__)

CLIENT_TIMEOUT = 300.0

PRIMARY_PREFIX = "LIXTO_LLM"
FALLBACK_PREFIX = "LIXTO_LLM_FALLBACK"

MODEL_CHEAP = os.environ.get("LIXTO_LLM_MODEL_CHEAP", "gpt-5-mini")
MODEL_DOC = os.environ.get("LIXTO_LLM_MODEL_DOC", "gpt-5.1")
MODEL_STRONG = os.environ.get("LIXTO_LLM_MODEL_STRONG", "gpt-5.1")
MODEL_FALLBACK = os.environ.get("LIXTO_LLM_MODEL_FALLBACK") or None
MODEL_EMBED = os.environ.get("LIXTO_LLM_MODEL_EMBED", "text-embedding-3-small")

# Second-provider tier models. All optional: a tier without a name has no
# cross-provider lane (it may still use MODEL_FALLBACK on the primary client).
FALLBACK_MODEL_CHEAP = os.environ.get("LIXTO_LLM_FALLBACK_MODEL_CHEAP") or None
FALLBACK_MODEL_DOC = os.environ.get("LIXTO_LLM_FALLBACK_MODEL_DOC") or None
FALLBACK_MODEL_STRONG = os.environ.get("LIXTO_LLM_FALLBACK_MODEL_STRONG") or None

EMBED_DIMS = 1536
EMBED_BATCH = 100
EMBED_CHARS = 8_000
REASONING_EFFORT_OPENAI = os.environ.get("LIXTO_LLM_OPENAI_REASONING_EFFORT", "minimal")

# (input, output) USD per 1M tokens. Embedding models price input only.
# Unknown models are billed as 0 and reported by `unpriced_models()`.
PRICES_USD_PER_M: dict[str, tuple[float, float]] = {
    # Gemini list prices, verified 2026-08-28 (ai.google.dev/gemini-api/docs/pricing).
    # 2.5 models are retired for new keys; 3.6/3.7 Flash are promo-priced through 2026-12-31.
    "gemini-2.5-flash-lite": (0.10, 0.40),
    "gemini-2.5-flash": (0.30, 2.50),
    "gemini-3.1-flash-lite": (0.25, 1.50),
    "gemini-3.5-flash-lite": (0.30, 2.50),
    "gemini-3.5-flash": (1.50, 9.00),
    "gemini-3.6-flash": (0.75, 3.75),
    "gemini-3.7-flash": (0.75, 3.75),
    "gemini-embedding-001": (0.15, 0.0),
    "gemini-embedding-2": (0.20, 0.0),
    "gpt-5-nano": (0.05, 0.40),
    "gpt-5-mini": (0.25, 2.00),
    "gpt-5.1": (1.25, 10.00),
    "gpt-5": (1.25, 10.00),
    "text-embedding-3-small": (0.02, 0.0),
}


def build_client(prefix: str = PRIMARY_PREFIX) -> OpenAI:
    """OpenAI SDK client pointed at whatever provider `{prefix}_BASE_URL` /
    `{prefix}_API_KEY` name. The primary prefix also accepts a bare
    `OPENAI_API_KEY` for the key."""
    kwargs: dict[str, Any] = {"timeout": CLIENT_TIMEOUT}
    base_url = os.environ.get(f"{prefix}_BASE_URL")
    if base_url:
        kwargs["base_url"] = base_url
    api_key = os.environ.get(f"{prefix}_API_KEY")
    if not api_key and prefix == PRIMARY_PREFIX:
        api_key = os.environ.get("OPENAI_API_KEY")
    if api_key:
        kwargs["api_key"] = api_key
    return OpenAI(**kwargs)


def build_fallback_client() -> OpenAI | None:
    """Second-provider client, or None when no fallback key is configured.

    The key is the switch: a fallback base URL alone would silently point at
    the primary provider's credentials."""
    if not os.environ.get(f"{FALLBACK_PREFIX}_API_KEY"):
        return None
    return build_client(FALLBACK_PREFIX)


def _loads(text: str | None) -> dict[str, Any] | None:
    """Tolerant JSON parse: None on empty, malformed, or non-object output."""
    if not text:
        return None
    try:
        payload = json.loads(text)
    except (json.JSONDecodeError, TypeError):
        return None
    return payload if isinstance(payload, dict) else None


def _chat_content(response: Any) -> str | None:
    """Message text of a Chat Completions response, or None when the model
    refused / returned nothing."""
    choices = getattr(response, "choices", None) or []
    if not choices:
        return None
    message = getattr(choices[0], "message", None)
    if message is None:
        return None
    if getattr(message, "refusal", None):
        return None
    return getattr(message, "content", None)


def _int(value: Any) -> int:
    """Token counts are advisory: anything that isn't a plain int (missing
    field, mocked attribute, None) counts as zero."""
    return value if isinstance(value, int) and not isinstance(value, bool) else 0


def _embedding_vectors(response: Any, expected: int) -> list[list[float]]:
    """Vectors of an embeddings response, ordered by the API's `index` field
    (providers are allowed to return them out of order) and checked against
    EMBED_DIMS — a shorter vector would poison `procurement_embeddings`."""
    data = list(getattr(response, "data", None) or [])
    if len(data) != expected:
        raise ValueError(f"embeddings response has {len(data)} vectors, expected {expected}")
    if all(isinstance(getattr(item, "index", None), int) for item in data):
        data.sort(key=lambda item: item.index)
    vectors = [list(item.embedding) for item in data]
    for vector in vectors:
        if len(vector) != EMBED_DIMS:
            raise ValueError(f"embedding has {len(vector)} dims, expected {EMBED_DIMS}")
    return vectors


class LlmClient:
    """Tiered, provider-agnostic JSON completion client with a cross-provider
    fallback and token/cost accounting."""

    def __init__(
        self,
        client: OpenAI | None = None,
        *,
        fallback_client: OpenAI | None = None,
        cheap: str | None = None,
        doc: str | None = None,
        strong: str | None = None,
        fallback: str | None = None,
        fallback_cheap: str | None = None,
        fallback_doc: str | None = None,
        fallback_strong: str | None = None,
        embed: str | None = None,
    ) -> None:
        self.client = client or build_client()
        # Only read the fallback provider from the env when the primary client
        # came from the env too: an injected client must not silently acquire a
        # second provider behind the caller's back.
        if fallback_client is None and client is None:
            fallback_client = build_fallback_client()
        self.fallback_client = fallback_client
        self.cheap = cheap or MODEL_CHEAP
        self.doc = doc or MODEL_DOC
        self.strong = strong or MODEL_STRONG
        self.fallback = fallback if fallback is not None else MODEL_FALLBACK
        self.fallback_cheap = fallback_cheap if fallback_cheap is not None else FALLBACK_MODEL_CHEAP
        self.fallback_doc = fallback_doc if fallback_doc is not None else FALLBACK_MODEL_DOC
        self.fallback_strong = (
            fallback_strong if fallback_strong is not None else FALLBACK_MODEL_STRONG
        )
        self.embed_model = embed or MODEL_EMBED
        self._primary_rejects_files = False
        self.usage: dict[str, dict[str, int]] = {}

    # --- models ----------------------------------------------------------

    def model_for(self, tier: str) -> str:
        if tier == "cheap":
            return self.cheap
        if tier == "strong":
            return self.strong
        raise ValueError(f"unknown tier: {tier!r}")

    def _fallback_route(self, tier: str) -> tuple[Any, str] | None:
        """The one retry a failed call gets: (client, model), or None when no
        fallback is configured for this tier."""
        if self.fallback_client is not None:
            model = {
                "cheap": self.fallback_cheap,
                "doc": self.fallback_doc,
                "strong": self.fallback_strong,
            }.get(tier)
            if model:
                return self.fallback_client, model
        if self.fallback:
            return self.client, self.fallback
        return None

    # --- usage -----------------------------------------------------------

    def _record_usage(self, model: str, response: Any) -> None:
        """Accumulate one response's tokens under its model. Embeddings report
        `prompt_tokens`/`total_tokens` and no completion side."""
        entry = self.usage.setdefault(
            model, {"calls": 0, "prompt_tokens": 0, "completion_tokens": 0}
        )
        entry["calls"] += 1
        usage = getattr(response, "usage", None)
        if usage is None:
            return
        prompt = _int(getattr(usage, "prompt_tokens", None))
        if not prompt:
            prompt = _int(getattr(usage, "total_tokens", None))
        entry["prompt_tokens"] += prompt
        entry["completion_tokens"] += _int(getattr(usage, "completion_tokens", None))

    def unpriced_models(self) -> list[str]:
        """Models we billed as zero because `PRICES_USD_PER_M` has no entry."""
        return sorted(model for model in self.usage if model not in PRICES_USD_PER_M)

    def estimated_usd(self) -> float:
        total = 0.0
        for model, entry in self.usage.items():
            price = PRICES_USD_PER_M.get(model)
            if price is None:
                continue
            price_in, price_out = price
            total += entry["prompt_tokens"] / 1_000_000 * price_in
            total += entry["completion_tokens"] / 1_000_000 * price_out
        return total

    def usage_summary(self) -> dict[str, Any]:
        """Flat, JSON-safe view for `RunCounters` / `agent_runs.counters`.
        USD is carried as integer micros so the counters stay whole numbers."""
        return {
            "calls": sum(e["calls"] for e in self.usage.values()),
            "prompt_tokens": sum(e["prompt_tokens"] for e in self.usage.values()),
            "completion_tokens": sum(e["completion_tokens"] for e in self.usage.values()),
            "est_usd_micros": round(self.estimated_usd() * 1_000_000),
            "unpriced_models": self.unpriced_models(),
        }

    # --- completions -----------------------------------------------------

    def complete_json_text(
        self,
        *,
        tier: str,
        instructions: str,
        prompt: str,
        schema: dict[str, Any],
        name: str,
    ) -> tuple[dict[str, Any] | None, str]:
        """Chat Completions with `response_format` json_schema (portable
        across OpenAI-compatible providers). Returns (parsed dict or None,
        model actually used). SDK errors propagate — callers handle them per
        row — except when a fallback is configured, which buys exactly one
        retry."""
        return self._complete(
            tier=tier,
            model=self.model_for(tier),
            content=prompt,
            instructions=instructions,
            schema=schema,
            name=name,
        )

    def complete_json_pdf(
        self,
        *,
        instructions: str,
        prompt: str,
        pdfs: list[dict[str, Any]],
        schema: dict[str, Any],
        name: str,
    ) -> tuple[dict[str, Any] | None, str]:
        """Doc tier: the same Chat Completions json_schema call with the PDFs
        inlined as base64 `file` content parts (OpenAI). Gemini's compatible
        endpoint rejects `file` parts with 400 "Invalid content part type";
        the first such rejection flips `_primary_rejects_files` so later PDFs
        go straight to the fallback route instead of paying a failed call."""
        content: list[dict[str, Any]] = []
        for pdf in pdfs:
            b64 = base64.b64encode(pdf["content"]).decode("ascii")
            content.append(
                {
                    "type": "file",
                    "file": {
                        "filename": pdf.get("filename") or "documento.pdf",
                        "file_data": f"data:application/pdf;base64,{b64}",
                    },
                }
            )
        content.append({"type": "text", "text": prompt})

        if self._primary_rejects_files:
            route = self._fallback_route("doc")
            if route is not None:
                client, fallback_model = route
                return (
                    self._chat_json(client, fallback_model, instructions, content, schema, name),
                    fallback_model,
                )
        try:
            return self._complete(
                tier="doc",
                model=self.doc,
                content=content,
                instructions=instructions,
                schema=schema,
                name=name,
            )
        except Exception as exc:
            if "Invalid content part type" in str(exc):
                self._primary_rejects_files = True
            raise

    def _complete(
        self,
        *,
        tier: str,
        model: str,
        content: Any,
        instructions: str,
        schema: dict[str, Any],
        name: str,
    ) -> tuple[dict[str, Any] | None, str]:
        """Primary call plus, at most, one retry on the tier's fallback
        route (second provider, else second model on the same client)."""
        try:
            payload = self._chat_json(self.client, model, instructions, content, schema, name)
        except Exception as exc:
            if tier == "doc" and "Invalid content part type" in str(exc):
                self._primary_rejects_files = True
            route = self._fallback_route(tier)
            if route is None:
                raise
            client, fallback_model = route
            logger.warning("model %s failed; retrying on fallback %s", model, fallback_model)
            return (
                self._chat_json(client, fallback_model, instructions, content, schema, name),
                fallback_model,
            )

        if payload is None:
            route = self._fallback_route(tier)
            if route is not None:
                client, fallback_model = route
                logger.warning(
                    "model %s returned no usable JSON; retrying on fallback %s",
                    model,
                    fallback_model,
                )
                return (
                    self._chat_json(client, fallback_model, instructions, content, schema, name),
                    fallback_model,
                )
        return payload, model

    def _chat_json(
        self,
        client: Any,
        model: str,
        instructions: str,
        content: Any,
        schema: dict[str, Any],
        name: str,
    ) -> dict[str, Any] | None:
        kwargs: dict[str, Any] = {
            "model": model,
            "messages": [
                {"role": "system", "content": instructions},
                {"role": "user", "content": content},
            ],
            "response_format": {
                "type": "json_schema",
                "json_schema": {"name": name, "strict": True, "schema": schema},
            },
        }
        # gpt-5 family bills hidden reasoning tokens as output ($2/M on
        # gpt-5-mini); this is structured extraction, so ask for the minimum.
        # Only OpenAI models understand the knob — Gemini's endpoint rejects it.
        if model.startswith("gpt-5"):
            kwargs["reasoning_effort"] = REASONING_EFFORT_OPENAI
        response = client.chat.completions.create(**kwargs)
        self._record_usage(model, response)
        return _loads(_chat_content(response))

    # --- embeddings ------------------------------------------------------

    def embed(self, texts: list[str]) -> tuple[list[list[float]], str]:
        """Embeddings for `texts`, in input order, plus the model used.

        Long inputs are truncated to EMBED_CHARS (the canonical enrichment
        text is far shorter; this only guards pathological rows) and the list
        is split into batches of EMBED_BATCH. Dimensions are pinned to
        EMBED_DIMS. No fallback provider: a column of vectors must all come
        from one model. SDK errors propagate — callers decide whether a
        missing embedding is fatal."""
        if not texts:
            return [], self.embed_model

        vectors: list[list[float]] = []
        for start in range(0, len(texts), EMBED_BATCH):
            batch = [t[:EMBED_CHARS] for t in texts[start : start + EMBED_BATCH]]
            response = self.client.embeddings.create(
                model=self.embed_model, input=batch, dimensions=EMBED_DIMS
            )
            self._record_usage(self.embed_model, response)
            vectors.extend(_embedding_vectors(response, len(batch)))
        return vectors, self.embed_model
