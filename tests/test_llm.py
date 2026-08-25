"""Unit tests for src/plic/llm.py — mocked OpenAI SDK object, no network."""

import json
from unittest.mock import MagicMock

import pytest

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
