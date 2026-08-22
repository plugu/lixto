# Graph Report - plataforma-licitante-cycle7  (2026-08-22)

## Corpus Check
- 110 files · ~43,275 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 939 nodes · 1797 edges · 69 communities (63 shown, 6 thin omitted)
- Extraction: 96% EXTRACTED · 4% INFERRED · 0% AMBIGUOUS · INFERRED: 73 edges (avg confidence: 0.8)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `b3f9e252`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- [[_COMMUNITY_Community 0|Community 0]]
- [[_COMMUNITY_Community 1|Community 1]]
- [[_COMMUNITY_Community 2|Community 2]]
- [[_COMMUNITY_Community 3|Community 3]]
- [[_COMMUNITY_Community 4|Community 4]]
- [[_COMMUNITY_Community 5|Community 5]]
- [[_COMMUNITY_Community 6|Community 6]]
- [[_COMMUNITY_Community 7|Community 7]]
- [[_COMMUNITY_Community 8|Community 8]]
- [[_COMMUNITY_Community 9|Community 9]]
- [[_COMMUNITY_Community 10|Community 10]]
- [[_COMMUNITY_Community 11|Community 11]]
- [[_COMMUNITY_Community 12|Community 12]]
- [[_COMMUNITY_Community 13|Community 13]]
- [[_COMMUNITY_Community 14|Community 14]]
- [[_COMMUNITY_Community 15|Community 15]]
- [[_COMMUNITY_Community 16|Community 16]]
- [[_COMMUNITY_Community 17|Community 17]]
- [[_COMMUNITY_Community 18|Community 18]]
- [[_COMMUNITY_Community 19|Community 19]]
- [[_COMMUNITY_Community 20|Community 20]]
- [[_COMMUNITY_Community 21|Community 21]]
- [[_COMMUNITY_Community 22|Community 22]]
- [[_COMMUNITY_Community 23|Community 23]]
- [[_COMMUNITY_Community 24|Community 24]]
- [[_COMMUNITY_Community 25|Community 25]]
- [[_COMMUNITY_Community 26|Community 26]]
- [[_COMMUNITY_Community 27|Community 27]]
- [[_COMMUNITY_Community 28|Community 28]]
- [[_COMMUNITY_Community 29|Community 29]]
- [[_COMMUNITY_Community 30|Community 30]]
- [[_COMMUNITY_Community 31|Community 31]]
- [[_COMMUNITY_Community 32|Community 32]]
- [[_COMMUNITY_Community 33|Community 33]]
- [[_COMMUNITY_Community 34|Community 34]]
- [[_COMMUNITY_Community 35|Community 35]]
- [[_COMMUNITY_Community 36|Community 36]]
- [[_COMMUNITY_Community 37|Community 37]]
- [[_COMMUNITY_Community 38|Community 38]]
- [[_COMMUNITY_Community 39|Community 39]]
- [[_COMMUNITY_Community 40|Community 40]]
- [[_COMMUNITY_Community 41|Community 41]]
- [[_COMMUNITY_Community 42|Community 42]]
- [[_COMMUNITY_Community 43|Community 43]]
- [[_COMMUNITY_Community 44|Community 44]]
- [[_COMMUNITY_Community 45|Community 45]]
- [[_COMMUNITY_Community 46|Community 46]]
- [[_COMMUNITY_Community 47|Community 47]]
- [[_COMMUNITY_Community 48|Community 48]]
- [[_COMMUNITY_Community 49|Community 49]]
- [[_COMMUNITY_Community 50|Community 50]]
- [[_COMMUNITY_Community 51|Community 51]]
- [[_COMMUNITY_Community 52|Community 52]]
- [[_COMMUNITY_Community 53|Community 53]]
- [[_COMMUNITY_Community 54|Community 54]]
- [[_COMMUNITY_Community 55|Community 55]]
- [[_COMMUNITY_Community 56|Community 56]]
- [[_COMMUNITY_Community 57|Community 57]]
- [[_COMMUNITY_Community 58|Community 58]]
- [[_COMMUNITY_Community 59|Community 59]]
- [[_COMMUNITY_Community 60|Community 60]]
- [[_COMMUNITY_Community 61|Community 61]]
- [[_COMMUNITY_Community 62|Community 62]]
- [[_COMMUNITY_Community 63|Community 63]]
- [[_COMMUNITY_Community 64|Community 64]]
- [[_COMMUNITY_Community 65|Community 65]]

## God Nodes (most connected - your core abstractions)
1. `PncpClient` - 21 edges
2. `sync_detalhes()` - 17 edges
3. `analyze_one()` - 16 edges
4. `_client_with_handler()` - 13 edges
5. `_mock_conn()` - 12 edges
6. `generate_plist()` - 12 edges
7. `LicitacaoDetailPage()` - 11 edges
8. `formatCurrencyBRL()` - 11 edges
9. `_doc()` - 11 edges
10. `triage()` - 11 edges

## Surprising Connections (you probably didn't know these)
- `test_backfill_failed_unit_is_skipped_not_fatal()` --calls--> `PncpApiError`  [INFERRED]
  /Users/aazevedo/dev/plataforma-licitante/tests/test_backfill.py → /Users/aazevedo/dev/plataforma-licitante/src/plic/pncp_client.py
- `_client_with_handler()` --calls--> `PncpClient`  [INFERRED]
  /Users/aazevedo/dev/plataforma-licitante/tests/test_pncp_client.py → /Users/aazevedo/dev/plataforma-licitante/src/plic/pncp_client.py
- `_client_with_handler()` --calls--> `PncpClient`  [INFERRED]
  /Users/aazevedo/dev/plataforma-licitante/tests/test_sync_detalhes.py → /Users/aazevedo/dev/plataforma-licitante/src/plic/pncp_client.py
- `_sync_modalidade()` --calls--> `upsert_licitacao()`  [INFERRED]
  /Users/aazevedo/dev/plataforma-licitante/src/plic/sync_incremental.py → /Users/aazevedo/dev/plataforma-licitante/src/plic/sync_publicacao.py
- `sync_publicacao()` --calls--> `PncpClient`  [INFERRED]
  /Users/aazevedo/dev/plataforma-licitante/src/plic/sync_publicacao.py → /Users/aazevedo/dev/plataforma-licitante/src/plic/pncp_client.py

## Communities (69 total, 6 thin omitted)

### Community 0 - "Community 0"
Cohesion: 0.08
Nodes (61): buildHref(), CATEGORIA_LABELS, Chip, FilterChips(), formatValor(), RawSearchParams, toURLSearchParams(), withoutValue() (+53 more)

### Community 1 - "Community 1"
Cohesion: 0.08
Nodes (43): AnalisePanel(), ATENDE_LABELS, DEEP_STATUS_NOTES, DocumentGroup(), DocumentosList(), FitBadge(), LABELS, STYLES (+35 more)

### Community 2 - "Community 2"
Cohesion: 0.13
Nodes (47): analyze_one(), build_context_text(), build_input_content(), build_instructions(), deep_analyze(), download_pdfs(), fetch_itens(), parse_response() (+39 more)

### Community 3 - "Community 3"
Cohesion: 0.04
Nodes (47): 1. Start the Database, 2. Initialize the Database, 3. Run the Full Backfill, 4. Install the Scheduler, Architecture, Backfill taking too long?, CLI Commands, code:bash (docker compose up -d) (+39 more)

### Community 4 - "Community 4"
Cohesion: 0.08
Nodes (25): PncpApiError, PncpClient, Thin sync HTTP client for the PNCP consulta API.  Policy (docs/PNCP_API.md, "Mea, Fetch one page of a `PaginaRetornoRecuperarCompra...DTO` endpoint.          Shar, Fetch one page of `/v1/contratacoes/publicacao`.          Returns the decoded `P, Fetch one page of `/v1/contratacoes/atualizacao` (incremental sync         by `d, Yield each page dict for a modalidade until `paginasRestantes` is 0., Yield each `/publicacao` page dict for a modalidade until drained. (+17 more)

### Community 5 - "Community 5"
Cohesion: 0.13
Nodes (37): fetch_arquivos(), _fetch_bare_array_pages(), fetch_itens(), `plic sync detalhes` — fetches items + edital/anexo metadata (arquivos) for lici, Flatten one `RecuperarCompraItemSigiloDTO` into `item` row params., Flatten one `RecuperarDadosDocumentoCompraDTO` into `documento` row params., Page a bare-array endpoint (itens/arquivos) until an empty page.      A 404 on t, Fetch itens + arquivos for licitações missing either sync stamp.      Selection: (+29 more)

### Community 6 - "Community 6"
Cohesion: 0.13
Nodes (28): ChartCard(), Dashboard(), SCOPE_SUBTITLES, SCOPES, BarList(), numberFormat, DailyLine(), formatDay() (+20 more)

### Community 7 - "Community 7"
Cohesion: 0.09
Nodes (35): generate_plist(), get_launchd_agent_path(), get_log_path(), get_repo_path(), get_uid(), get_uv_path(), install(), macOS launchd job scheduler for twice-daily incremental syncs. (+27 more)

### Community 8 - "Community 8"
Cohesion: 0.13
Nodes (30): get_profile_path(), load_profile(), Loads `company_profile.md`, the versioned config the agents score against.  mvp, Read the company profile markdown as plain text for prompt-building., build_instructions(), build_prompt(), parse_response(), Fit-triage agent (ticket 13).  For each new top-7-portal licitação (aberta/futur (+22 more)

### Community 9 - "Community 9"
Cohesion: 0.09
Nodes (28): `plic agents run` orchestration: fit-triage (ticket 13) then deep-analysis (tick, run_agents(), agents_run_cmd(), backfill_cmd(), classify_cmd(), db_init(), `plic` CLI entrypoint (typer)., Fetch items + edital/anexo metadata for licitações missing them. (+20 more)

### Community 10 - "Community 10"
Cohesion: 0.16
Nodes (25): backfill(), backfill_unit_key(), generate_chunks(), _get_done_unit_keys(), _mark_unit_done(), `plic backfill` — resumable full backfill of every modalidade over 7-day date ch, Resumable backfill: every (modalidade, 7-day chunk) unit from `since`     to `un, Split the inclusive range [since, until] into `chunk_days`-wide,     non-overlap (+17 more)

### Community 11 - "Community 11"
Cohesion: 0.29
Nodes (19): _atualizacao_page(), _dto(), _mock_conn(), _patch_db_helpers(), Unit tests for src/plic/sync_incremental.py.  No network, no live database: wate, test_advance_watermark_upserts_sync_state_value(), test_bootstrap_start_date_falls_back_to_today_when_db_empty(), test_bootstrap_start_date_uses_newest_data_atualizacao_global() (+11 more)

### Community 12 - "Community 12"
Cohesion: 0.23
Nodes (14): `plic sync publicacao` — pages PNCP's `/contratacoes/publicacao` per modalidade, Flatten one `RecuperarCompraPublicacaoDTO` into `licitacao` row params.      Nes, Map one publicacao DTO to a row and upsert it (freshness-guarded)., Page `/contratacoes/publicacao` for each modalidade and upsert results.      Ret, row_from_publicacao_dto(), sync_publicacao(), upsert_licitacao(), _load_fixture_dtos() (+6 more)

### Community 13 - "Community 13"
Cohesion: 0.32
Nodes (15): _client_with_handler(), _load_fixture_page(), _no_sleep(), Unit tests for src/plic/pncp_client.py.  No live network calls: httpx.MockTransp, Every test in this module runs with retry/backoff sleeps stubbed out., test_does_not_retry_on_400(), test_get_atualizacao_page_204_returns_empty_page(), test_get_atualizacao_page_success_returns_decoded_json() (+7 more)

### Community 14 - "Community 14"
Cohesion: 0.24
Nodes (11): apply_migration(), ensure_migrations_table(), get_applied_migrations(), get_connection(), list_migration_files(), Plain-SQL migration runner (no ORM, no Alembic).  Applies `migrations/*.sql` in, Return .sql migration files sorted by filename (ascending)., Apply all pending migrations in filename order. Returns filenames applied. (+3 more)

### Community 15 - "Community 15"
Cohesion: 0.15
Nodes (11): Base URLs, Endpoints used by this project, `GET /api/consulta/v1/contratacoes/atualizacao` — incremental by update date, `GET /api/consulta/v1/contratacoes/proposta` — open proposal windows (not used for sync; useful for reconciliation), `GET /api/consulta/v1/contratacoes/publicacao` — backfill by publication date, `GET /api/pncp/v1/orgaos/{cnpj}/compras/{ano}/{sequencial}/arquivos` — edital + anexos, `GET /api/pncp/v1/orgaos/{cnpj}/compras/{ano}/{sequencial}/itens` — line items, Key DTO fields (+3 more)

### Community 16 - "Community 16"
Cohesion: 0.15
Nodes (12): Out of scope, plataforma-licitante — multi-tenant empresa / usuário (cycle 7), Primary user story, Scope, Success demo, What / why, Out of scope, plataforma-licitante — largura da lista de licitações (cycle 5) (+4 more)

### Community 17 - "Community 17"
Cohesion: 0.33
Nodes (7): bricolage, hanken, metadata, RootLayout(), isActive(), NAV_ITEMS, Sidebar()

### Community 18 - "Community 18"
Cohesion: 0.47
Nodes (9): formatCEP(), formatCNPJ(), formatCPF(), isValidCEP(), isValidCNPJ(), isValidCPF(), isValidEmail(), modulo11CheckDigit() (+1 more)

### Community 19 - "Community 19"
Cohesion: 0.18
Nodes (10): DOCUMENTO_TIPOS, DocumentoEmpresa, DocumentoTipo, Empresa, EmpresaCnae, Porte, PORTES, Role (+2 more)

### Community 20 - "Community 20"
Cohesion: 0.44
Nodes (9): _mock_connection(), Unit tests for the migration runner (src/plic/db.py).  No live database required, Build a MagicMock psycopg.Connection whose cursor supports the     `with conn.cu, test_list_migration_files_missing_dir_returns_empty(), test_list_migration_files_sorted_by_filename(), test_run_migrations_applies_pending_in_order(), test_run_migrations_noop_when_all_applied(), test_run_migrations_skips_already_applied() (+1 more)

### Community 21 - "Community 21"
Cohesion: 0.18
Nodes (10): Blockers, Decisions, Next, Now, STATE — rewrite after every ticket completes; never append. ≤30 lines total., Blockers, Decisions, Next (+2 more)

### Community 22 - "Community 22"
Cohesion: 0.2
Nodes (8): CNAEs, Empresa, Exclusões, Faixa de valor, O que fornecemos, Palavras-chave, Perfil da empresa, UFs de interesse

### Community 23 - "Community 23"
Cohesion: 0.42
Nodes (7): build_prompt(), classify(), classify_batch(), parse_response(), Sector classification of licitações via a local LLM (Ollama).  One-time/backlog, Classify pending abertas/futuras in batches until drained (or `limit`     licita, Returns {n: setor} for valid entries only. Tolerates ```json fences and     stra

### Community 24 - "Community 24"
Cohesion: 0.39
Nodes (6): Checks (run in order — cheapest first), code:tsx (<div className="mx-auto max-w-5xl px-8 py-10 has-[.page-wide), Context, Done when, Goal, Not included

### Community 25 - "Community 25"
Cohesion: 0.25
Nodes (6): Components, Dashboard style guide (cycle 2 — revised), Layout, pt-BR conventions, Tokens, Type

### Community 26 - "Community 26"
Cohesion: 0.25
Nodes (6): Out of scope, plataforma-licitante — dashboard de licitações (cycle 2), Primary user story, Scope, Success demo, What / why

### Community 27 - "Community 27"
Cohesion: 0.25
Nodes (6): Out of scope, plataforma-licitante — PNCP ingestion agent, Primary user story, Scope, Success demo, What / why

### Community 28 - "Community 28"
Cohesion: 0.48
Nodes (5): test_build_prompt_numbers_rows_and_includes_labels(), test_parse_response_drops_unknown_labels_and_bad_n(), test_parse_response_garbage_returns_empty(), test_parse_response_plain_array(), test_parse_response_tolerates_fences_and_prose()

### Community 29 - "Community 29"
Cohesion: 0.48
Nodes (5): Checks (run in order — cheapest first), Context, Done when, Goal, Not included

### Community 30 - "Community 30"
Cohesion: 0.29
Nodes (6): Checks (run in order — cheapest first), code:yaml (paths:), Context, Done when, Goal, Not included

### Community 31 - "Community 31"
Cohesion: 0.48
Nodes (5): Checks (run in order — cheapest first), Context, Done when, Goal, Not included

### Community 32 - "Community 32"
Cohesion: 0.48
Nodes (5): Checks (run in order — cheapest first), Context, Done when, Goal, Not included

### Community 33 - "Community 33"
Cohesion: 0.48
Nodes (5): Checks (run in order — cheapest first), Context, Done when, Goal, Not included

### Community 34 - "Community 34"
Cohesion: 0.48
Nodes (5): Checks (run in order — cheapest first), Context, Done when, Goal, Not included

### Community 35 - "Community 35"
Cohesion: 0.48
Nodes (5): Checks (run in order — cheapest first), Context, Done when, Goal, Not included

### Community 36 - "Community 36"
Cohesion: 0.29
Nodes (6): Checks (run in order — cheapest first), code:dockerfile (FROM python:3.12-slim), Context, Done when, Goal, Not included

### Community 37 - "Community 37"
Cohesion: 0.29
Nodes (5): Checks (run in order — cheapest first), Context, Done when, Goal, Not included

### Community 38 - "Community 38"
Cohesion: 0.29
Nodes (6): Checks (run in order — cheapest first), code:block1 (SRC_URL=postgresql://... DST_URL=postgresql://... scripts/se), Context, Done when, Goal, Not included

### Community 39 - "Community 39"
Cohesion: 0.29
Nodes (5): Blockers, Decisions, Next, Now, STATE — rewrite after every ticket completes; never append. ≤30 lines total.

### Community 40 - "Community 40"
Cohesion: 0.48
Nodes (5): Checks (run in order — cheapest first), Context, Done when, Goal, Not included

### Community 41 - "Community 41"
Cohesion: 0.48
Nodes (5): Checks (run in order — cheapest first), Context, Done when, Goal, Not included

### Community 42 - "Community 42"
Cohesion: 0.48
Nodes (5): Checks (run in order — cheapest first), Context, Done when, Goal, Not included

### Community 43 - "Community 43"
Cohesion: 0.29
Nodes (5): Blockers, Decisions, Next, Now, STATE — rewrite after every ticket completes; never append. ≤30 lines total.

### Community 44 - "Community 44"
Cohesion: 0.48
Nodes (5): Checks (run in order — cheapest first), Context, Done when, Goal, Not included

### Community 45 - "Community 45"
Cohesion: 0.48
Nodes (5): Checks (run in order — cheapest first), Context, Done when, Goal, Not included

### Community 46 - "Community 46"
Cohesion: 0.48
Nodes (5): Checks (run in order — cheapest first), Context, Done when, Goal, Not included

### Community 47 - "Community 47"
Cohesion: 0.48
Nodes (5): Checks (run in order — cheapest first), Context, Done when, Goal, Not included

### Community 48 - "Community 48"
Cohesion: 0.48
Nodes (5): Checks (run in order — cheapest first), Context, Done when, Goal, Not included

### Community 49 - "Community 49"
Cohesion: 0.48
Nodes (5): Checks (run in order — cheapest first), Context, Done when, Goal, Not included

### Community 50 - "Community 50"
Cohesion: 0.33
Nodes (5): Checks (run in order — cheapest first), Context, Done when, Goal, Not included

### Community 51 - "Community 51"
Cohesion: 0.33
Nodes (5): Checks (run in order — cheapest first), Context, Done when, Goal, Not included

### Community 52 - "Community 52"
Cohesion: 0.33
Nodes (5): Checks (run in order — cheapest first), Context, Done when, Goal, Not included

### Community 53 - "Community 53"
Cohesion: 0.33
Nodes (5): Checks (run in order — cheapest first), Context, Done when, Goal, Not included

### Community 54 - "Community 54"
Cohesion: 0.33
Nodes (5): Checks (run in order — cheapest first), Context, Done when, Goal, Not included

### Community 55 - "Community 55"
Cohesion: 0.33
Nodes (5): Checks (run in order — cheapest first), Context, Done when, Goal, Not included

### Community 56 - "Community 56"
Cohesion: 0.33
Nodes (5): Checks (run in order — cheapest first), Context, Done when, Goal, Not included

### Community 57 - "Community 57"
Cohesion: 0.33
Nodes (5): Checks (run in order — cheapest first), Context, Done when, Goal, Not included

### Community 58 - "Community 58"
Cohesion: 0.33
Nodes (5): Checks (run in order — cheapest first), Context, Done when, Goal, Not included

### Community 59 - "Community 59"
Cohesion: 0.47
Nodes (4): code:bash (npm run dev), Deploy on Vercel, Getting Started, Learn More

## Knowledge Gaps
- **232 isolated node(s):** `nextConfig`, `Porte`, `PORTES`, `Role`, `DocumentoTipo` (+227 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **6 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `PncpApiError` connect `Community 4` to `Community 10`, `Community 5`, `Community 7`?**
  _High betweenness centrality (0.054) - this node is a cross-community bridge._
- **Why does `PncpClient` connect `Community 4` to `Community 5`, `Community 10`, `Community 12`, `Community 13`?**
  _High betweenness centrality (0.048) - this node is a cross-community bridge._
- **Why does `test_triage_stops_run_on_api_error_without_marking_rows()` connect `Community 8` to `Community 7`?**
  _High betweenness centrality (0.043) - this node is a cross-community bridge._
- **Are the 6 inferred relationships involving `PncpClient` (e.g. with `_client_with_handler()` and `_client_with_handler()`) actually correct?**
  _`PncpClient` has 6 INFERRED edges - model-reasoned connections that need verification._
- **Are the 9 inferred relationships involving `sync_detalhes()` (e.g. with `test_sync_detalhes_fetches_upserts_and_stamps_both_columns()` and `test_sync_detalhes_stamps_even_when_both_arrays_empty()`) actually correct?**
  _`sync_detalhes()` has 9 INFERRED edges - model-reasoned connections that need verification._
- **Are the 5 inferred relationships involving `analyze_one()` (e.g. with `test_analyze_one_persists_done_with_pdf()` and `test_analyze_one_no_documents_skips_with_metadata_only_analysis()`) actually correct?**
  _`analyze_one()` has 5 INFERRED edges - model-reasoned connections that need verification._
- **What connects `nextConfig`, `Porte`, `PORTES` to the rest of the system?**
  _232 weakly-connected nodes found - possible documentation gaps or missing edges._