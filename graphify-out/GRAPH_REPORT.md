# Graph Report - plataforma-licitante  (2026-08-21)

## Corpus Check
- 93 files · ~35,764 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 741 nodes · 1090 edges · 53 communities (47 shown, 6 thin omitted)
- Extraction: 93% EXTRACTED · 7% INFERRED · 0% AMBIGUOUS · INFERRED: 73 edges (avg confidence: 0.8)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `dc54185a`
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

## God Nodes (most connected - your core abstractions)
1. `PncpClient` - 20 edges
2. `sync_detalhes()` - 16 edges
3. `analyze_one()` - 15 edges
4. `_client_with_handler()` - 12 edges
5. `_mock_conn()` - 11 edges
6. `generate_plist()` - 11 edges
7. `LicitacaoDetailPage()` - 10 edges
8. `_doc()` - 10 edges
9. `triage()` - 10 edges
10. `plataforma-licitante — PNCP Ingestion Agent` - 10 edges

## Surprising Connections (you probably didn't know these)
- `test_row_from_publicacao_dto_handles_nullable_dates_and_missing_nested_objects()` --calls--> `row_from_publicacao_dto()`  [INFERRED]
  tests/test_sync_publicacao.py → src/plic/sync_publicacao.py
- `test_sync_publicacao_syncs_all_13_modalidades_by_default()` --calls--> `sync_publicacao()`  [INFERRED]
  tests/test_sync_publicacao.py → src/plic/sync_publicacao.py
- `test_generate_chunks_splits_into_7_day_windows()` --calls--> `generate_chunks()`  [INFERRED]
  tests/test_backfill.py → src/plic/backfill.py
- `test_generate_chunks_partial_last_chunk()` --calls--> `generate_chunks()`  [INFERRED]
  tests/test_backfill.py → src/plic/backfill.py
- `test_generate_chunks_single_day_range()` --calls--> `generate_chunks()`  [INFERRED]
  tests/test_backfill.py → src/plic/backfill.py

## Communities (53 total, 6 thin omitted)

### Community 0 - "Community 0"
Cohesion: 0.06
Nodes (60): buildHref(), CATEGORIA_LABELS, Chip, FilterChips(), formatValor(), RawSearchParams, toURLSearchParams(), withoutValue() (+52 more)

### Community 1 - "Community 1"
Cohesion: 0.06
Nodes (38): AnalisePanel(), ATENDE_LABELS, DEEP_STATUS_NOTES, DocumentosList(), FitBadge(), LABELS, STYLES, ItensTable() (+30 more)

### Community 2 - "Community 2"
Cohesion: 0.1
Nodes (45): analyze_one(), build_context_text(), build_input_content(), build_instructions(), deep_analyze(), download_pdfs(), fetch_itens(), parse_response() (+37 more)

### Community 3 - "Community 3"
Cohesion: 0.04
Nodes (47): 1. Start the Database, 2. Initialize the Database, 3. Run the Full Backfill, 4. Install the Scheduler, Architecture, Backfill taking too long?, CLI Commands, code:bash (docker compose up -d) (+39 more)

### Community 4 - "Community 4"
Cohesion: 0.1
Nodes (36): fetch_arquivos(), _fetch_bare_array_pages(), fetch_itens(), `plic sync detalhes` — fetches items + edital/anexo metadata (arquivos) for lici, Flatten one `RecuperarCompraItemSigiloDTO` into `item` row params., Flatten one `RecuperarDadosDocumentoCompraDTO` into `documento` row params., Page a bare-array endpoint (itens/arquivos) until an empty page.      A 404 on t, Fetch itens + arquivos for licitações missing either sync stamp.      Selection: (+28 more)

### Community 5 - "Community 5"
Cohesion: 0.08
Nodes (34): generate_plist(), get_launchd_agent_path(), get_log_path(), get_repo_path(), get_uid(), get_uv_path(), install(), macOS launchd job scheduler for twice-daily incremental syncs. (+26 more)

### Community 6 - "Community 6"
Cohesion: 0.1
Nodes (26): Dashboard(), SCOPE_SUBTITLES, SCOPES, BarList(), numberFormat, DailyLine(), formatDay(), numberFormat (+18 more)

### Community 7 - "Community 7"
Cohesion: 0.1
Nodes (24): get_profile_path(), load_profile(), Loads `company_profile.md`, the versioned config the agents score against.  mvp, Read the company profile markdown as plain text for prompt-building., build_instructions(), build_prompt(), parse_response(), Fit-triage agent (ticket 13).  For each new top-7-portal licitação (aberta/futur (+16 more)

### Community 8 - "Community 8"
Cohesion: 0.07
Nodes (28): `plic agents run` orchestration: fit-triage (ticket 13) then deep-analysis (tick, run_agents(), agents_run_cmd(), backfill_cmd(), classify_cmd(), db_init(), `plic` CLI entrypoint (typer)., Fetch items + edital/anexo metadata for licitações missing them. (+20 more)

### Community 9 - "Community 9"
Cohesion: 0.1
Nodes (27): _advance_watermark(), _bootstrap_start_date(), _get_existing_watermarks(), `plic sync incremental` — the twice-daily run: pulls everything changed since ea, Page `/atualizacao` for one modalidade, upserting each DTO.      Returns `(rows_, Sync every modalidade's `/atualizacao` changes since its watermark,     then `sy, All `incremental:*` watermarks already recorded, keyed by modalidade., First-ever-run fallback: the newest `data_atualizacao_global` already     in the (+19 more)

### Community 10 - "Community 10"
Cohesion: 0.12
Nodes (24): backfill(), backfill_unit_key(), generate_chunks(), _get_done_unit_keys(), _mark_unit_done(), `plic backfill` — resumable full backfill of every modalidade over 7-day date ch, Resumable backfill: every (modalidade, 7-day chunk) unit from `since`     to `un, Split the inclusive range [since, until] into `chunk_days`-wide,     non-overlap (+16 more)

### Community 11 - "Community 11"
Cohesion: 0.11
Nodes (12): PncpApiError, PncpClient, Thin sync HTTP client for the PNCP consulta API.  Policy (docs/PNCP_API.md, "Mea, Fetch one page of a `PaginaRetornoRecuperarCompra...DTO` endpoint.          Shar, Fetch one page of `/v1/contratacoes/publicacao`.          Returns the decoded `P, Fetch one page of `/v1/contratacoes/atualizacao` (incremental sync         by `d, Yield each page dict for a modalidade until `paginasRestantes` is 0., Yield each `/publicacao` page dict for a modalidade until drained. (+4 more)

### Community 12 - "Community 12"
Cohesion: 0.22
Nodes (15): _atualizacao_page(), _dto(), _mock_conn(), _patch_db_helpers(), Unit tests for src/plic/sync_incremental.py.  No network, no live database: wate, test_advance_watermark_upserts_sync_state_value(), test_bootstrap_start_date_falls_back_to_today_when_db_empty(), test_bootstrap_start_date_uses_newest_data_atualizacao_global() (+7 more)

### Community 13 - "Community 13"
Cohesion: 0.24
Nodes (15): _client_with_handler(), _load_fixture_page(), _no_sleep(), Unit tests for src/plic/pncp_client.py.  No live network calls: httpx.MockTransp, Every test in this module runs with retry/backoff sleeps stubbed out., test_does_not_retry_on_400(), test_get_atualizacao_page_204_returns_empty_page(), test_get_atualizacao_page_success_returns_decoded_json() (+7 more)

### Community 14 - "Community 14"
Cohesion: 0.21
Nodes (11): apply_migration(), ensure_migrations_table(), get_applied_migrations(), get_connection(), list_migration_files(), Plain-SQL migration runner (no ORM, no Alembic).  Applies `migrations/*.sql` in, Return .sql migration files sorted by filename (ascending)., Apply all pending migrations in filename order. Returns filenames applied. (+3 more)

### Community 15 - "Community 15"
Cohesion: 0.17
Nodes (11): Base URLs, Endpoints used by this project, `GET /api/consulta/v1/contratacoes/atualizacao` — incremental by update date, `GET /api/consulta/v1/contratacoes/proposta` — open proposal windows (not used for sync; useful for reconciliation), `GET /api/consulta/v1/contratacoes/publicacao` — backfill by publication date, `GET /api/pncp/v1/orgaos/{cnpj}/compras/{ano}/{sequencial}/arquivos` — edital + anexos, `GET /api/pncp/v1/orgaos/{cnpj}/compras/{ano}/{sequencial}/itens` — line items, Key DTO fields (+3 more)

### Community 16 - "Community 16"
Cohesion: 0.36
Nodes (8): _mock_connection(), Unit tests for the migration runner (src/plic/db.py).  No live database required, Build a MagicMock psycopg.Connection whose cursor supports the     `with conn.cu, test_list_migration_files_sorted_by_filename(), test_run_migrations_applies_pending_in_order(), test_run_migrations_noop_when_all_applied(), test_run_migrations_skips_already_applied(), _write_sql()

### Community 17 - "Community 17"
Cohesion: 0.25
Nodes (5): bricolage, hanken, metadata, NAV_ITEMS, Sidebar()

### Community 18 - "Community 18"
Cohesion: 0.22
Nodes (8): CNAEs, Empresa, Exclusões, Faixa de valor, O que fornecemos, Palavras-chave, Perfil da empresa, UFs de interesse

### Community 19 - "Community 19"
Cohesion: 0.36
Nodes (7): build_prompt(), classify(), classify_batch(), parse_response(), Sector classification of licitações via a local LLM (Ollama).  One-time/backlog, Classify pending abertas/futuras in batches until drained (or `limit`     licita, Returns {n: setor} for valid entries only. Tolerates ```json fences and     stra

### Community 20 - "Community 20"
Cohesion: 0.29
Nodes (6): Out of scope, plataforma-licitante — largura da lista de licitações (cycle 5), Primary user story, Scope, Success demo, What / why

### Community 21 - "Community 21"
Cohesion: 0.29
Nodes (6): Checks (run in order — cheapest first), code:tsx (<div className="mx-auto max-w-5xl px-8 py-10 has-[.page-wide), Context, Done when, Goal, Not included

### Community 22 - "Community 22"
Cohesion: 0.29
Nodes (6): Components, Dashboard style guide (cycle 2 — revised), Layout, pt-BR conventions, Tokens, Type

### Community 23 - "Community 23"
Cohesion: 0.29
Nodes (6): Out of scope, plataforma-licitante — dashboard de licitações (cycle 2), Primary user story, Scope, Success demo, What / why

### Community 24 - "Community 24"
Cohesion: 0.29
Nodes (6): Out of scope, plataforma-licitante — PNCP ingestion agent, Primary user story, Scope, Success demo, What / why

### Community 26 - "Community 26"
Cohesion: 0.33
Nodes (5): Blockers, Decisions, Next, Now, STATE — rewrite after every ticket completes; never append. ≤30 lines total.

### Community 27 - "Community 27"
Cohesion: 0.33
Nodes (5): Checks (run in order — cheapest first), Context, Done when, Goal, Not included

### Community 28 - "Community 28"
Cohesion: 0.33
Nodes (5): Checks (run in order — cheapest first), Context, Done when, Goal, Not included

### Community 29 - "Community 29"
Cohesion: 0.33
Nodes (5): Checks (run in order — cheapest first), Context, Done when, Goal, Not included

### Community 30 - "Community 30"
Cohesion: 0.33
Nodes (5): Checks (run in order — cheapest first), Context, Done when, Goal, Not included

### Community 31 - "Community 31"
Cohesion: 0.33
Nodes (5): Checks (run in order — cheapest first), Context, Done when, Goal, Not included

### Community 32 - "Community 32"
Cohesion: 0.33
Nodes (5): Checks (run in order — cheapest first), Context, Done when, Goal, Not included

### Community 33 - "Community 33"
Cohesion: 0.33
Nodes (5): Blockers, Decisions, Next, Now, STATE — rewrite after every ticket completes; never append. ≤30 lines total.

### Community 34 - "Community 34"
Cohesion: 0.33
Nodes (5): Checks (run in order — cheapest first), Context, Done when, Goal, Not included

### Community 35 - "Community 35"
Cohesion: 0.33
Nodes (5): Checks (run in order — cheapest first), Context, Done when, Goal, Not included

### Community 36 - "Community 36"
Cohesion: 0.33
Nodes (5): Checks (run in order — cheapest first), Context, Done when, Goal, Not included

### Community 37 - "Community 37"
Cohesion: 0.33
Nodes (5): Blockers, Decisions, Next, Now, STATE — rewrite after every ticket completes; never append. ≤30 lines total.

### Community 38 - "Community 38"
Cohesion: 0.33
Nodes (5): Checks (run in order — cheapest first), Context, Done when, Goal, Not included

### Community 39 - "Community 39"
Cohesion: 0.33
Nodes (5): Checks (run in order — cheapest first), Context, Done when, Goal, Not included

### Community 40 - "Community 40"
Cohesion: 0.33
Nodes (5): Checks (run in order — cheapest first), Context, Done when, Goal, Not included

### Community 41 - "Community 41"
Cohesion: 0.33
Nodes (5): Checks (run in order — cheapest first), Context, Done when, Goal, Not included

### Community 42 - "Community 42"
Cohesion: 0.33
Nodes (5): Checks (run in order — cheapest first), Context, Done when, Goal, Not included

### Community 43 - "Community 43"
Cohesion: 0.33
Nodes (5): Checks (run in order — cheapest first), Context, Done when, Goal, Not included

### Community 44 - "Community 44"
Cohesion: 0.4
Nodes (4): code:bash (npm run dev), Deploy on Vercel, Getting Started, Learn More

## Knowledge Gaps
- **310 isolated node(s):** `config`, `eslintConfig`, `nextConfig`, `hanken`, `bricolage` (+305 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **6 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `PncpApiError` connect `Community 11` to `Community 10`, `Community 4`, `Community 7`?**
  _High betweenness centrality (0.076) - this node is a cross-community bridge._
- **Why does `PncpClient` connect `Community 11` to `Community 9`, `Community 10`, `Community 4`, `Community 13`?**
  _High betweenness centrality (0.068) - this node is a cross-community bridge._
- **Are the 6 inferred relationships involving `PncpClient` (e.g. with `_client_with_handler()` and `_client_with_handler()`) actually correct?**
  _`PncpClient` has 6 INFERRED edges - model-reasoned connections that need verification._
- **Are the 9 inferred relationships involving `sync_detalhes()` (e.g. with `test_sync_detalhes_fetches_upserts_and_stamps_both_columns()` and `test_sync_detalhes_stamps_even_when_both_arrays_empty()`) actually correct?**
  _`sync_detalhes()` has 9 INFERRED edges - model-reasoned connections that need verification._
- **Are the 5 inferred relationships involving `analyze_one()` (e.g. with `test_analyze_one_persists_done_with_pdf()` and `test_analyze_one_no_documents_skips_with_metadata_only_analysis()`) actually correct?**
  _`analyze_one()` has 5 INFERRED edges - model-reasoned connections that need verification._
- **What connects `config`, `eslintConfig`, `nextConfig` to the rest of the system?**
  _310 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Community 0` be split into smaller, more focused modules?**
  _Cohesion score 0.06 - nodes in this community are weakly interconnected._