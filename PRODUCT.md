---
mode: mvp
routing_profile: cloud
parallel_default: parallel
---

# Lixto — query-time semantic search (cycle 20)

## What / why
Lixto already stores a 1536-d vector per procurement (`procurement_embeddings`, HNSW cosine) but uses it only for profile × procurement matching. Free-text search — the `search_procurements` chat tool and the `/procurements` page — is still keyword-only (FTS/ILIKE), so "material escolar para crianças" misses a procurement for "cadernos e lápis". The vision (§7, §11) calls for embedding the user's free text and retrieving by meaning. This cycle closes that gap using the existing table and model tier (`LIXTO_LLM_MODEL_EMBED`) — no new infrastructure, no schema change.

1. **Hybrid retrieval, one builder.** When a search carries free text, embed it once and build candidates as FTS hits ∪ vector top-K (cosine ≥ minimum, both constants alongside `SEMANTIC_TOP_K`/`SEMANTIC_MIN` in `match-queries.ts`). Structured filters (UF, modalidade, faixa de valor, situação, dates) stay hard SQL `WHERE` clauses applied to both branches. Ranking = reciprocal-rank fusion of the two lists; deterministic, no LLM. Queries without free text are unchanged. If the embedding call fails, fall back to FTS-only and log — search never errors because of the embedder.
2. **Two callers, same builder.** `search_procurements` (`web/lib/agent/tools.ts`) and the `/procurements` list query call the same hybrid query builder with bound params. Results expose why a row surfaced (`keyword`, `semantic`, or both) so the chat can say "encontrei por similaridade".
3. **Embeddings as part of the pipeline.** `lixto enrich run` already embeds inline (`worker.py` → `_embed_payload`) and `lixto enrich embed` backfills rows whose inline call failed. What's missing is operational: the Dokploy `enrich-embed` schedule is manual-only (`0 0 31 2 *`) — this cycle gives it a real cadence after `enrich-run` so failures self-heal, and documents the search path. No code change on the Python side unless a test reveals a gap.

Guardrails from the vision: deterministic first (fusion, not LLM re-ranking); process once globally (one vector per procurement, reused by matching and search); no LLM SQL (builder with bound params); pgvector only, no separate vector store.

## Primary user story
As a user searching for opportunities, I type what I sell in my own words — in chat or in the `/procurements` box — and get procurements that mean the same thing even when they use different words, still respecting my UF/value/status filters, so I stop missing opportunities that don't share my vocabulary.

## Out of scope
- Item-level embeddings / `search_items` tool
- LLM re-ranking or query rewriting
- Full-history embedding backfill beyond the scheduled catch-up job
- Golden-set recall evaluation (manual demo only)
- Streaming chat; notifications; prepare/execute; learning from feedback
- Plans/contracts in search or matching
- Richer profile fields

## Success demo
Done when I can ask the chat "material escolar para crianças" and get the "cadernos e lápis" procurement (no shared keyword), see the same result list from the `/procurements` search box with a UF filter applied, and find a procurement ingested today searchable after the next `enrich run` without running `enrich embed` by hand.
