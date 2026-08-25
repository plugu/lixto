"""Provider-abstracted LLM client (ported from `plic.llm`, cycle 18).

One module the whole Python side uses, so switching provider (OpenAI, an
OpenAI-compatible gateway, a local server) is an env change and not a code
change. Three entry points:

- `complete_json_text` — Chat Completions with `response_format` json_schema,
  the portable shape every OpenAI-compatible provider implements.
- `complete_json_pdf`  — Responses API with `input_file` PDFs. OpenAI only.
- `embed`              — batched embeddings for `procurement_embeddings`.

Model tiers are env-configured (`LIXTO_LLM_MODEL_*`): cheap (clean text), doc
(PDF input), strong (reserved for deep reasoning). `LIXTO_LLM_MODEL_FALLBACK`,
when set, buys one retry on a second model after a tier-1 failure — useful
when the primary is rate-limited or briefly unavailable.
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

MODEL_CHEAP = os.environ.get("LIXTO_LLM_MODEL_CHEAP", "gpt-5-mini")
MODEL_DOC = os.environ.get("LIXTO_LLM_MODEL_DOC", "gpt-5.1")
MODEL_STRONG = os.environ.get("LIXTO_LLM_MODEL_STRONG", "gpt-5.1")
MODEL_FALLBACK = os.environ.get("LIXTO_LLM_MODEL_FALLBACK") or None
MODEL_EMBED = os.environ.get("LIXTO_LLM_MODEL_EMBED", "text-embedding-3-small")

EMBED_DIMS = 1536
EMBED_BATCH = 100
EMBED_CHARS = 8_000


def build_client() -> OpenAI:
    """OpenAI SDK client pointed at whatever provider the env names."""
    kwargs: dict[str, Any] = {"timeout": CLIENT_TIMEOUT}
    base_url = os.environ.get("LIXTO_LLM_BASE_URL")
    if base_url:
        kwargs["base_url"] = base_url
    api_key = os.environ.get("LIXTO_LLM_API_KEY") or os.environ.get("OPENAI_API_KEY")
    if api_key:
        kwargs["api_key"] = api_key
    return OpenAI(**kwargs)


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


def _responses_text(response: Any) -> str | None:
    """Output text of a Responses API response, or None on refusal."""
    for item in getattr(response, "output", None) or []:
        if getattr(item, "type", None) == "refusal":
            return None
        for block in getattr(item, "content", None) or []:
            if getattr(block, "type", None) == "refusal":
                return None
    return getattr(response, "output_text", None)


def _embedding_vectors(response: Any, expected: int) -> list[list[float]]:
    """Vectors of an embeddings response, ordered by the API's `index` field
    (providers are allowed to return them out of order)."""
    data = list(getattr(response, "data", None) or [])
    if len(data) != expected:
        raise ValueError(f"embeddings response has {len(data)} vectors, expected {expected}")
    if all(isinstance(getattr(item, "index", None), int) for item in data):
        data.sort(key=lambda item: item.index)
    return [list(item.embedding) for item in data]


class LlmClient:
    """Tiered, provider-agnostic JSON completion client."""

    def __init__(
        self,
        client: OpenAI | None = None,
        *,
        cheap: str | None = None,
        doc: str | None = None,
        strong: str | None = None,
        fallback: str | None = None,
        embed: str | None = None,
    ) -> None:
        self.client = client or build_client()
        self.cheap = cheap or MODEL_CHEAP
        self.doc = doc or MODEL_DOC
        self.strong = strong or MODEL_STRONG
        self.fallback = fallback if fallback is not None else MODEL_FALLBACK
        self.embed_model = embed or MODEL_EMBED

    def model_for(self, tier: str) -> str:
        if tier == "cheap":
            return self.cheap
        if tier == "strong":
            return self.strong
        raise ValueError(f"unknown tier: {tier!r}")

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
        row — except when a fallback model is configured, which buys exactly
        one retry."""
        model = self.model_for(tier)
        try:
            payload = self._chat_json(model, instructions, prompt, schema, name)
        except Exception:
            if not self.fallback:
                raise
            logger.warning("model %s failed; retrying on fallback %s", model, self.fallback)
            return self._chat_json(self.fallback, instructions, prompt, schema, name), self.fallback

        if payload is None and self.fallback:
            logger.warning(
                "model %s returned no usable JSON; retrying on fallback %s", model, self.fallback
            )
            return self._chat_json(self.fallback, instructions, prompt, schema, name), self.fallback
        return payload, model

    def _chat_json(
        self,
        model: str,
        instructions: str,
        prompt: str,
        schema: dict[str, Any],
        name: str,
    ) -> dict[str, Any] | None:
        response = self.client.chat.completions.create(
            model=model,
            messages=[
                {"role": "system", "content": instructions},
                {"role": "user", "content": prompt},
            ],
            response_format={
                "type": "json_schema",
                "json_schema": {"name": name, "strict": True, "schema": schema},
            },
        )
        return _loads(_chat_content(response))

    def complete_json_pdf(
        self,
        *,
        instructions: str,
        prompt: str,
        pdfs: list[dict[str, Any]],
        schema: dict[str, Any],
        name: str,
    ) -> tuple[dict[str, Any] | None, str]:
        """Responses API with `input_file` PDFs (OpenAI only). No fallback:
        the doc tier is already the expensive escape hatch."""
        content: list[dict[str, Any]] = []
        for pdf in pdfs:
            b64 = base64.b64encode(pdf["content"]).decode("ascii")
            content.append(
                {
                    "type": "input_file",
                    "filename": pdf.get("filename") or "documento.pdf",
                    "file_data": f"data:application/pdf;base64,{b64}",
                }
            )
        content.append({"type": "input_text", "text": prompt})

        response = self.client.responses.create(
            model=self.doc,
            instructions=instructions,
            input=[{"role": "user", "content": content}],
            text={
                "format": {
                    "type": "json_schema",
                    "name": name,
                    "strict": True,
                    "schema": schema,
                }
            },
        )
        return _loads(_responses_text(response)), self.doc

    def embed(self, texts: list[str]) -> tuple[list[list[float]], str]:
        """Embeddings for `texts`, in input order, plus the model used.

        Long inputs are truncated to EMBED_CHARS (the canonical enrichment
        text is far shorter; this only guards pathological rows) and the list
        is split into batches of EMBED_BATCH. SDK errors propagate — callers
        decide whether a missing embedding is fatal."""
        if not texts:
            return [], self.embed_model

        vectors: list[list[float]] = []
        for start in range(0, len(texts), EMBED_BATCH):
            batch = [t[:EMBED_CHARS] for t in texts[start : start + EMBED_BATCH]]
            response = self.client.embeddings.create(model=self.embed_model, input=batch)
            vectors.extend(_embedding_vectors(response, len(batch)))
        return vectors, self.embed_model
