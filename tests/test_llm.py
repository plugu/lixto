"""Unit tests for src/plic/llm.py — mocked OpenAI SDK object, no network."""

import json
from unittest.mock import MagicMock

import pytest

from plic import llm as llm_module
from plic.llm import LlmClient

SCHEMA = {"type": "object", "properties": {"a": {"type": "string"}}, "required": ["a"]}


def _chat_response(content, refusal=None):
    message = MagicMock()
    message.content = content
    message.refusal = refusal
    choice = MagicMock()
    choice.message = message
    response = MagicMock()
    response.choices = [choice]
    return response


def _responses_response(text, refused=False):
    response = MagicMock()
    if refused:
        item = MagicMock()
        item.type = "refusal"
        item.content = []
        response.output = [item]
        response.output_text = ""
    else:
        response.output = []
        response.output_text = text
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


# --- request payload -----------------------------------------------------


def test_response_format_is_portable_json_schema():
    sdk = _client()
    _llm(sdk).complete_json_text(
        tier="cheap", instructions="sys", prompt="user", schema=SCHEMA, name="enriquecimento"
    )

    kwargs = sdk.chat.completions.create.call_args.kwargs
    assert kwargs["response_format"] == {
        "type": "json_schema",
        "json_schema": {"name": "enriquecimento", "strict": True, "schema": SCHEMA},
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


# --- PDF tier ------------------------------------------------------------


def test_complete_json_pdf_uses_doc_model_and_input_file_blocks():
    sdk = MagicMock()
    sdk.responses.create.return_value = _responses_response(json.dumps({"a": "b"}))

    payload, model = _llm(sdk).complete_json_pdf(
        instructions="sys",
        prompt="context",
        pdfs=[{"filename": "edital.pdf", "content": b"%PDF-1.4"}],
        schema=SCHEMA,
        name="enriquecimento",
    )

    assert payload == {"a": "b"}
    assert model == "doc-model"
    kwargs = sdk.responses.create.call_args.kwargs
    assert kwargs["model"] == "doc-model"
    content = kwargs["input"][0]["content"]
    assert content[0]["type"] == "input_file"
    assert content[0]["filename"] == "edital.pdf"
    assert content[0]["file_data"].startswith("data:application/pdf;base64,")
    assert content[-1] == {"type": "input_text", "text": "context"}
    assert kwargs["text"]["format"]["name"] == "enriquecimento"


def test_complete_json_pdf_refusal_returns_none():
    sdk = MagicMock()
    sdk.responses.create.return_value = _responses_response("", refused=True)

    payload, _model = _llm(sdk).complete_json_pdf(
        instructions="s",
        prompt="p",
        pdfs=[{"filename": "a.pdf", "content": b"%PDF"}],
        schema=SCHEMA,
        name="n",
    )
    assert payload is None


# --- embeddings ----------------------------------------------------------


def _embedding_response(vectors, *, shuffle=False):
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
    return response


def _embed_sdk(dims=3):
    sdk = MagicMock()
    sdk.embeddings.create.side_effect = lambda model, input: _embedding_response(
        [[float(i)] * dims for i in range(len(input))]
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
    sdk.embeddings.create.return_value = _embedding_response([[0.0], [1.0], [2.0]], shuffle=True)

    vectors, _model = _llm(sdk, embed="embed-model").embed(["a", "b", "c"])

    assert vectors == [[0.0], [1.0], [2.0]]


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
