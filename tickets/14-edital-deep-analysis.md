---
id: 14
status: done
model: sonnet
depends_on: [13]
max_attempts: 3
files:
  - src/plic/agents/deep.py
  - src/plic/agents/run.py
  - tests/test_agents_deep.py
---
## Goal
Deep-analysis agent: for fit/borderline licitações, download edital PDFs and have Claude Opus extract requirements, prazos and risks, refining the verdict into `analise.deep_*` columns.

## Context
`deep.py` processes one licitação at a time. Selection: `analise.verdict IN ('fit','borderline') AND deep_status IS NULL`, ordered by `data_encerramento_proposta ASC NULLS LAST`, limit `max_deep`. For each: pick documento rows (`status_ativo`, prefer `tipo_documento_id = 2` /nome ILIKE '%edital%', else first active), download up to 2 PDFs via `httpx` (follow redirects — PNCP URLs redirect; 60s timeout). Skip non-PDF content-types. If combined size > 30 MB or zero PDFs downloadable → `deep_status='skipped'`, `error` notes why, still write a metadata-only analysis from objeto/itens.

API call: `openai.OpenAI()` (reads `OPENAI_API_KEY`), Responses API, model `gpt-5.1` (env `PLIC_ANALYSIS_MODEL`), 300s client timeout. Input: one user message whose content lists `{"type": "input_file", "filename": "...", "file_data": "data:application/pdf;base64,<b64>"}` blocks first, then an `input_text` block containing the company profile (reuse `profile.py` from ticket 13) plus triage verdict/reasoning and licitação summary. Structured outputs (`text.format` json_schema, strict): `{deep_verdict: fit|no_fit|borderline, fit_score, reasoning, requirements: [{tipo, descricao, atende: sim|nao|incerto}], prazos: [{evento, data}], risks: [string]}`; parse `response.output_text`. If the response contains a `refusal` output item or empty `output_text` → `deep_status='error'`. Persist into `analise` (`deep_verdict`, `requirements`, `prazos`, `risks` as JSONB via `json.dumps`, `deep_model`, `deep_analyzed_at=now()`, `deep_status='done'`), commit per licitação (resumable). Per-licitação exception → `deep_status='error'` + `error`, continue with next.

Wire into `run.py`: replace the ticket-13 stub so `plic agents run` does triage then deep. No CLI changes needed.

Tests: mock OpenAI client and httpx PDF download; cover selection SQL, skip paths (no docs, oversized, non-PDF), refusal handling, persistence, per-row error isolation, resumability.

## Checks (run in order — cheapest first)
1. `uv run ruff check src tests`
2. `uv run pytest tests/test_agents_deep.py tests/test_agents_triage.py`
3. `set -a && source ~/dev/hackaview/.env && set +a && uv run plic agents run --max-triage 0 --max-deep 1`

## Done when
- Check 3 exits 0 and one `analise` row has `deep_status='done'` with non-null `deep_verdict`, `requirements`, `prazos` populated from a real edital PDF.

## Not included
- No web UI (ticket 15). No OCR for scanned PDFs beyond what Claude's native PDF support gives. No impugnação detection, no supplier search. No parallelism — strictly sequential.
