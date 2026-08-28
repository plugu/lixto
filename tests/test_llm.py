"""Unit tests for src/lixto/llm.py — mocked OpenAI SDK object, no network."""

from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest

from lixto import llm as llm_module
from lixto.llm import LlmClient


def _usage(**fields):
    """Usage object carrying only the fields a real provider would send."""
    return SimpleNamespace(**fields)


SCHEMA = {"type": "object", "properties": {"a": {"type": "string"}}, "required": ["a"]}


def _chat_response(content, refusal=None, usage=None):
    message = MagicMock()
    message.content = content
    message.refusal = refusal
    choice = MagicMock()
    choice.message = message
    response = MagicMock()
    response.choices = [choice]
    response.usage = usage
    return response


def _client(chat_return=None):
    sdk = MagicMock()
    sdk.chat.completions.create.return_value = chat_return or _chat_response('{"a": "b"}')
    return sdk


def _llm(sdk, **kwargs):
    kwargs.setdefault("cheap", "cheap-model")
    kwargs.setdefault("doc", "doc-model")
    kwargs.setdefault("strong", "strong-model")
    kwargs.setdefault("fallback", None)
    kwargs.setdefault("fallback_cheap", None)
    kwargs.setdefault("fallback_doc", None)
    kwargs.setdefault("fallback_strong", None)
    return LlmClient(sdk, **kwargs)


# --- tier selection ------------------------------------------------------


def test_cheap_tier_uses_cheap_model():
    sdk = _client()
    payload, model = _llm(sdk).complete_json_text(
        tier="cheap", instructions="sys", prompt="user", schema=SCHEMA, name="n"
    )

    assert payload == {"a": "b"}
    assert model == "cheap-model"
    assert sdk.chat.completions.create.call_args.kwargs["model"] == "cheap-model"


def test_strong_tier_uses_strong_model():
    sdk = _client()
    _payload, model = _llm(sdk).complete_json_text(
        tier="strong", instructions="sys", prompt="user", schema=SCHEMA, name="n"
    )
    assert model == "strong-model"
    assert sdk.chat.completions.create.call_args.kwargs["model"] == "strong-model"


def test_unknown_tier_raises():
    with pytest.raises(ValueError):
        _llm(_client()).complete_json_text(
            tier="doc", instructions="s", prompt="p", schema=SCHEMA, name="n"
        )


# --- env prefix ----------------------------------------------------------


def test_env_defaults_use_the_lixto_prefix(monkeypatch):
    monkeypatch.setenv("LIXTO_LLM_BASE_URL", "https://gateway.example/v1")
    monkeypatch.setenv("LIXTO_LLM_API_KEY", "sk-lixto")
    client = llm_module.build_client()

    assert str(client.base_url).startswith("https://gateway.example/v1")
    assert client.api_key == "sk-lixto"


def test_api_key_falls_back_to_openai_api_key(monkeypatch):
    monkeypatch.delenv("LIXTO_LLM_API_KEY", raising=False)
    monkeypatch.delenv("LIXTO_LLM_BASE_URL", raising=False)
    monkeypatch.setenv("OPENAI_API_KEY", "sk-openai")

    assert llm_module.build_client().api_key == "sk-openai"


def test_fallback_client_reads_the_fallback_prefix(monkeypatch):
    monkeypatch.setenv("LIXTO_LLM_FALLBACK_BASE_URL", "https://api.openai.com/v1")
    monkeypatch.setenv("LIXTO_LLM_FALLBACK_API_KEY", "sk-second")

    client = llm_module.build_fallback_client()

    assert str(client.base_url).startswith("https://api.openai.com/v1")
    assert client.api_key == "sk-second"


def test_no_fallback_client_without_a_fallback_key(monkeypatch):
    monkeypatch.delenv("LIXTO_LLM_FALLBACK_API_KEY", raising=False)
    monkeypatch.setenv("LIXTO_LLM_FALLBACK_BASE_URL", "https://api.openai.com/v1")

    assert llm_module.build_fallback_client() is None


# --- request payload -----------------------------------------------------


def test_response_format_is_portable_json_schema():
    sdk = _client()
    _llm(sdk).complete_json_text(
        tier="cheap", instructions="sys", prompt="user", schema=SCHEMA, name="enrichment"
    )

    kwargs = sdk.chat.completions.create.call_args.kwargs
    assert kwargs["response_format"] == {
        "type": "json_schema",
        "json_schema": {"name": "enrichment", "strict": True, "schema": SCHEMA},
    }
    assert kwargs["messages"] == [
        {"role": "system", "content": "sys"},
        {"role": "user", "content": "user"},
    ]


# --- tolerant parsing ----------------------------------------------------


def test_malformed_json_returns_none():
    sdk = _client(_chat_response("not json at all"))
    payload, _model = _llm(sdk).complete_json_text(
        tier="cheap", instructions="s", prompt="p", schema=SCHEMA, name="n"
    )
    assert payload is None


def test_refusal_returns_none():
    sdk = _client(_chat_response(None, refusal="I can't help with that"))
    payload, _model = _llm(sdk).complete_json_text(
        tier="cheap", instructions="s", prompt="p", schema=SCHEMA, name="n"
    )
    assert payload is None


def test_non_object_json_returns_none():
    sdk = _client(_chat_response("[1, 2, 3]"))
    payload, _model = _llm(sdk).complete_json_text(
        tier="cheap", instructions="s", prompt="p", schema=SCHEMA, name="n"
    )
    assert payload is None


# --- fallback ------------------------------------------------------------


def test_sdk_error_propagates_without_fallback():
    sdk = _client()
    sdk.chat.completions.create.side_effect = RuntimeError("rate limited")

    with pytest.raises(RuntimeError):
        _llm(sdk).complete_json_text(
            tier="cheap", instructions="s", prompt="p", schema=SCHEMA, name="n"
        )
    assert sdk.chat.completions.create.call_count == 1


def test_fallback_retries_once_on_sdk_error():
    sdk = _client()
    sdk.chat.completions.create.side_effect = [
        RuntimeError("rate limited"),
        _chat_response('{"a": "b"}'),
    ]

    payload, model = _llm(sdk, fallback="backup-model").complete_json_text(
        tier="cheap", instructions="s", prompt="p", schema=SCHEMA, name="n"
    )

    assert payload == {"a": "b"}
    assert model == "backup-model"
    assert sdk.chat.completions.create.call_count == 2
    models = [c.kwargs["model"] for c in sdk.chat.completions.create.call_args_list]
    assert models == ["cheap-model", "backup-model"]


def test_fallback_retries_only_once_and_then_propagates():
    sdk = _client()
    sdk.chat.completions.create.side_effect = RuntimeError("down")

    with pytest.raises(RuntimeError):
        _llm(sdk, fallback="backup-model").complete_json_text(
            tier="cheap", instructions="s", prompt="p", schema=SCHEMA, name="n"
        )
    assert sdk.chat.completions.create.call_count == 2


def test_fallback_retries_on_unparseable_response():
    sdk = _client()
    sdk.chat.completions.create.side_effect = [
        _chat_response("garbage"),
        _chat_response('{"a": "b"}'),
    ]

    payload, model = _llm(sdk, fallback="backup-model").complete_json_text(
        tier="cheap", instructions="s", prompt="p", schema=SCHEMA, name="n"
    )

    assert payload == {"a": "b"}
    assert model == "backup-model"
    assert sdk.chat.completions.create.call_count == 2


# --- cross-provider fallback --------------------------------------------


def test_fallback_provider_handles_the_retry_on_sdk_error():
    primary = _client()
    primary.chat.completions.create.side_effect = RuntimeError("gemini down")
    secondary = _client()

    payload, model = _llm(
        primary, fallback_client=secondary, fallback_cheap="gpt-5-mini"
    ).complete_json_text(tier="cheap", instructions="s", prompt="p", schema=SCHEMA, name="n")

    assert payload == {"a": "b"}
    assert model == "gpt-5-mini"
    assert primary.chat.completions.create.call_count == 1
    assert secondary.chat.completions.create.call_count == 1
    assert secondary.chat.completions.create.call_args.kwargs["model"] == "gpt-5-mini"


def test_fallback_provider_not_touched_when_primary_succeeds():
    primary = _client()
    secondary = _client()

    _payload, model = _llm(
        primary, fallback_client=secondary, fallback_cheap="gpt-5-mini"
    ).complete_json_text(tier="cheap", instructions="s", prompt="p", schema=SCHEMA, name="n")

    assert model == "cheap-model"
    secondary.chat.completions.create.assert_not_called()


def test_fallback_provider_retries_on_unparseable_response():
    primary = _client(_chat_response("garbage"))
    secondary = _client()

    payload, model = _llm(
        primary, fallback_client=secondary, fallback_strong="gpt-5.1"
    ).complete_json_text(tier="strong", instructions="s", prompt="p", schema=SCHEMA, name="n")

    assert payload == {"a": "b"}
    assert model == "gpt-5.1"
    assert secondary.chat.completions.create.call_count == 1


def test_tier_without_a_fallback_model_falls_back_on_the_same_client():
    """A configured second provider still has no lane for a tier whose
    fallback model is unset; LIXTO_LLM_MODEL_FALLBACK keeps working."""
    primary = _client()
    primary.chat.completions.create.side_effect = [
        RuntimeError("down"),
        _chat_response('{"a": "b"}'),
    ]
    secondary = _client()

    _payload, model = _llm(
        primary, fallback_client=secondary, fallback="backup-model"
    ).complete_json_text(tier="cheap", instructions="s", prompt="p", schema=SCHEMA, name="n")

    assert model == "backup-model"
    secondary.chat.completions.create.assert_not_called()


def test_injected_client_does_not_pick_up_env_fallback_provider(monkeypatch):
    monkeypatch.setenv("LIXTO_LLM_FALLBACK_API_KEY", "sk-second")

    assert _llm(_client()).fallback_client is None


# --- PDF tier ------------------------------------------------------------


def test_complete_json_pdf_uses_doc_model_and_file_content_parts():
    sdk = _client()

    payload, model = _llm(sdk).complete_json_pdf(
        instructions="sys",
        prompt="context",
        pdfs=[{"filename": "edital.pdf", "content": b"%PDF-1.4"}],
        schema=SCHEMA,
        name="enrichment",
    )

    assert payload == {"a": "b"}
    assert model == "doc-model"
    sdk.responses.create.assert_not_called()

    kwargs = sdk.chat.completions.create.call_args.kwargs
    assert kwargs["model"] == "doc-model"
    assert kwargs["messages"][0] == {"role": "system", "content": "sys"}
    content = kwargs["messages"][1]["content"]
    assert content[0]["type"] == "file"
    assert content[0]["file"]["filename"] == "edital.pdf"
    assert content[0]["file"]["file_data"].startswith("data:application/pdf;base64,")
    assert content[-1] == {"type": "text", "text": "context"}
    assert kwargs["response_format"] == {
        "type": "json_schema",
        "json_schema": {"name": "enrichment", "strict": True, "schema": SCHEMA},
    }


def test_complete_json_pdf_refusal_returns_none():
    sdk = _client(_chat_response(None, refusal="no"))

    payload, _model = _llm(sdk).complete_json_pdf(
        instructions="s",
        prompt="p",
        pdfs=[{"filename": "a.pdf", "content": b"%PDF"}],
        schema=SCHEMA,
        name="n",
    )
    assert payload is None


def test_complete_json_pdf_uses_the_fallback_doc_model():
    primary = _client()
    primary.chat.completions.create.side_effect = RuntimeError("down")
    secondary = _client()

    _payload, model = _llm(
        primary, fallback_client=secondary, fallback_doc="gpt-5.1"
    ).complete_json_pdf(
        instructions="s",
        prompt="p",
        pdfs=[{"filename": "a.pdf", "content": b"%PDF"}],
        schema=SCHEMA,
        name="n",
    )

    assert model == "gpt-5.1"
    assert secondary.chat.completions.create.call_args.kwargs["model"] == "gpt-5.1"


# --- embeddings ----------------------------------------------------------


def _vec(value, dims=None):
    return [float(value)] * (dims if dims is not None else llm_module.EMBED_DIMS)


def _embedding_response(vectors, *, shuffle=False, usage=None):
    """Mimics an embeddings response: `.data` items with `.index`/`.embedding`."""
    items = []
    for i, vec in enumerate(vectors):
        item = MagicMock()
        item.index = i
        item.embedding = vec
        items.append(item)
    if shuffle:
        items.reverse()
    response = MagicMock()
    response.data = items
    response.usage = usage
    return response


def _embed_sdk(dims=None):
    sdk = MagicMock()
    sdk.embeddings.create.side_effect = lambda model, input, dimensions: _embedding_response(
        [_vec(i, dims if dims is not None else dimensions) for i in range(len(input))]
    )
    return sdk


def test_embed_uses_model_from_ctor():
    sdk = _embed_sdk()
    vectors, model = _llm(sdk, embed="embed-model").embed(["a", "b"])

    assert model == "embed-model"
    assert len(vectors) == 2
    assert sdk.embeddings.create.call_args.kwargs["model"] == "embed-model"
    assert sdk.embeddings.create.call_args.kwargs["input"] == ["a", "b"]


def test_embed_model_defaults_from_env(monkeypatch):
    monkeypatch.setattr(llm_module, "MODEL_EMBED", "env-embed-model")
    sdk = _embed_sdk()

    _vectors, model = LlmClient(sdk).embed(["a"])

    assert model == "env-embed-model"
    assert sdk.embeddings.create.call_args.kwargs["model"] == "env-embed-model"


def test_embed_env_default_is_text_embedding_3_small():
    assert llm_module.MODEL_EMBED == "text-embedding-3-small"
    assert llm_module.EMBED_DIMS == 1536


def test_embed_empty_input_makes_no_call():
    sdk = _embed_sdk()
    vectors, model = _llm(sdk, embed="embed-model").embed([])

    assert vectors == []
    assert model == "embed-model"
    sdk.embeddings.create.assert_not_called()


def test_embed_splits_batches_over_100():
    sdk = _embed_sdk()
    texts = [f"t{i}" for i in range(250)]

    vectors, _model = _llm(sdk, embed="embed-model").embed(texts)

    assert len(vectors) == 250
    sizes = [len(c.kwargs["input"]) for c in sdk.embeddings.create.call_args_list]
    assert sizes == [100, 100, 50]


def test_embed_preserves_input_order_despite_shuffled_response():
    sdk = MagicMock()
    sdk.embeddings.create.return_value = _embedding_response(
        [_vec(0), _vec(1), _vec(2)], shuffle=True
    )

    vectors, _model = _llm(sdk, embed="embed-model").embed(["a", "b", "c"])

    assert vectors == [_vec(0), _vec(1), _vec(2)]


def test_embed_pins_dimensions_to_1536():
    sdk = _embed_sdk()
    vectors, _model = _llm(sdk, embed="embed-model").embed(["a"])

    assert sdk.embeddings.create.call_args.kwargs["dimensions"] == 1536
    assert len(vectors[0]) == 1536


def test_embed_rejects_vectors_of_the_wrong_size():
    sdk = _embed_sdk(dims=768)

    with pytest.raises(ValueError, match="768"):
        _llm(sdk, embed="embed-model").embed(["a"])


def test_embed_never_falls_back_to_the_second_provider():
    primary = MagicMock()
    primary.embeddings.create.side_effect = RuntimeError("rate limited")
    secondary = MagicMock()

    with pytest.raises(RuntimeError):
        _llm(
            primary,
            fallback_client=secondary,
            fallback_cheap="gpt-5-mini",
            embed="embed-model",
        ).embed(["a"])

    secondary.embeddings.create.assert_not_called()


def test_embed_truncates_long_texts():
    sdk = _embed_sdk()
    _llm(sdk, embed="embed-model").embed(["x" * 20_000])

    sent = sdk.embeddings.create.call_args.kwargs["input"][0]
    assert len(sent) == llm_module.EMBED_CHARS


def test_embed_sdk_error_propagates():
    sdk = MagicMock()
    sdk.embeddings.create.side_effect = RuntimeError("rate limited")

    with pytest.raises(RuntimeError):
        _llm(sdk, embed="embed-model").embed(["a"])


# --- usage and cost ------------------------------------------------------


def test_usage_accumulates_per_model_across_calls():
    sdk = _client(
        _chat_response('{"a": "b"}', usage=_usage(prompt_tokens=1000, completion_tokens=500))
    )
    llm = _llm(sdk, cheap="gemini-2.5-flash-lite")

    for _ in range(2):
        llm.complete_json_text(tier="cheap", instructions="s", prompt="p", schema=SCHEMA, name="n")

    assert llm.usage == {
        "gemini-2.5-flash-lite": {"calls": 2, "prompt_tokens": 2000, "completion_tokens": 1000},
    }
    # 2000 in @ $0.10/M + 1000 out @ $0.40/M
    assert llm.estimated_usd() == pytest.approx(0.0002 + 0.0004)


def test_embedding_usage_uses_total_tokens_when_prompt_is_absent():
    sdk = MagicMock()
    sdk.embeddings.create.return_value = _embedding_response(
        [_vec(0)], usage=_usage(total_tokens=10_000)
    )
    llm = _llm(sdk, embed="gemini-embedding-001")

    llm.embed(["a"])

    assert llm.usage["gemini-embedding-001"] == {
        "calls": 1,
        "prompt_tokens": 10_000,
        "completion_tokens": 0,
    }
    assert llm.estimated_usd() == pytest.approx(10_000 / 1_000_000 * 0.15)


def test_usage_summary_totals_every_model():
    sdk = _client(
        _chat_response('{"a": "b"}', usage=_usage(prompt_tokens=1000, completion_tokens=500))
    )
    llm = _llm(sdk, cheap="gemini-2.5-flash-lite", embed="gemini-embedding-001")
    llm.complete_json_text(tier="cheap", instructions="s", prompt="p", schema=SCHEMA, name="n")

    sdk.embeddings.create.return_value = _embedding_response(
        [_vec(0)], usage=_usage(prompt_tokens=10_000, total_tokens=10_000)
    )
    llm.embed(["a"])

    assert llm.usage_summary() == {
        "calls": 2,
        "prompt_tokens": 11_000,
        "completion_tokens": 500,
        # chat: 1000 in @ $0.10/M + 500 out @ $0.40/M = 300 micros;
        # embeddings: 10k in @ $0.15/M = 1500 micros
        "est_usd_micros": 1800,
        "unpriced_models": [],
    }


def test_unknown_model_is_free_and_reported_as_unpriced():
    sdk = _client(
        _chat_response('{"a": "b"}', usage=_usage(prompt_tokens=1000, completion_tokens=500))
    )
    llm = _llm(sdk, cheap="brand-new-model")

    llm.complete_json_text(tier="cheap", instructions="s", prompt="p", schema=SCHEMA, name="n")

    assert llm.estimated_usd() == 0.0
    assert llm.unpriced_models() == ["brand-new-model"]
    assert llm.usage_summary()["est_usd_micros"] == 0
    assert llm.usage_summary()["unpriced_models"] == ["brand-new-model"]


def test_fallback_call_is_billed_to_the_fallback_model():
    primary = _client()
    primary.chat.completions.create.side_effect = RuntimeError("down")
    secondary = _client(
        _chat_response('{"a": "b"}', usage=_usage(prompt_tokens=1000, completion_tokens=1000))
    )
    llm = _llm(
        primary,
        fallback_client=secondary,
        cheap="gemini-2.5-flash-lite",
        fallback_cheap="gpt-5-mini",
    )

    llm.complete_json_text(tier="cheap", instructions="s", prompt="p", schema=SCHEMA, name="n")

    assert set(llm.usage) == {"gpt-5-mini"}
    # 1000 in @ $0.25/M + 1000 out @ $2.00/M
    assert llm.usage_summary()["est_usd_micros"] == 2250


def test_prices_cover_the_configured_provider_models():
    for model in (
        "gemini-2.5-flash-lite",
        "gemini-2.5-flash",
        "gemini-embedding-001",
        "gpt-5-mini",
        "gpt-5.1",
        "gpt-5",
        "text-embedding-3-small",
    ):
        assert model in llm_module.PRICES_USD_PER_M


def test_pdf_primary_file_rejection_short_circuits_to_fallback():
    """Gemini's endpoint 400s on `file` parts: after the first rejection the
    doc tier goes straight to the fallback client without paying a failed
    primary call."""
    primary = MagicMock()
    primary.chat.completions.create.side_effect = Exception(
        "Error code: 400 - Invalid content part type: file"
    )
    fallback = MagicMock()
    fallback.chat.completions.create.return_value = _chat_response('{"ok": true}')
    llm = LlmClient(
        client=primary,
        fallback_client=fallback,
        doc="gemini-3.7-flash",
        fallback_doc="gpt-5-mini",
    )
    pdfs = [{"filename": "e.pdf", "content": b"%PDF-1.1"}]
    out, model = llm.complete_json_pdf(
        instructions="i", prompt="p", pdfs=pdfs, schema=SCHEMA, name="t"
    )
    assert out == {"ok": True} and model == "gpt-5-mini"
    assert primary.chat.completions.create.call_count == 1
    assert llm._primary_rejects_files is True

    llm.complete_json_pdf(instructions="i", prompt="p", pdfs=pdfs, schema=SCHEMA, name="t")
    assert primary.chat.completions.create.call_count == 1  # not called again
    assert fallback.chat.completions.create.call_count == 2


def test_reasoning_effort_minimal_only_for_gpt5_models():
    client = _client(chat_return=_chat_response('{"a": "x"}'))
    llm = _llm(client, cheap="gpt-5-mini", strong="gemini-3.7-flash")
    llm.complete_json_text(tier="cheap", instructions="i", prompt="p", schema=SCHEMA, name="t")
    assert client.chat.completions.create.call_args.kwargs["reasoning_effort"] == "minimal"
    llm.complete_json_text(tier="strong", instructions="i", prompt="p", schema=SCHEMA, name="t")
    assert "reasoning_effort" not in client.chat.completions.create.call_args.kwargs
