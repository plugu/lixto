---
mode: mvp
routing_profile: cloud
parallel_default: parallel
---

# Lixto — semantic layer: pgvector embeddings (cycle 17)

## What / why
Cycle 16 shipped global enrichment, the per-empresa profile, an on-demand match engine and the Lixto chat — with semantic similarity deliberately deferred because production Postgres lacked pgvector. That blocker is gone: `pg-shared` now runs `pgvector/pgvector:pg18-trixie` (pgvector 0.8.6, same glibc as before). This cycle completes the "pgvector semantic search" box of the pipeline:

1. **Embed at enrichment.** Every `enriquecimento` row gets a vector of its canonical text (resumo + conceitos + palavras_chave + categorias), produced once by the worker through the same `LlmClient` abstraction (`PLIC_LLM_MODEL_EMBED`, default `text-embedding-3-small`, 1536 dims). Backfill command for rows enriched before this cycle.
2. **Embed the empresa profile.** Saving `/empresa/perfil` also stores an embedding of the profile text, so the company side of the match has a vector too.
3. **Semantic signal in the match engine.** Cosine similarity between profile and licitação vectors becomes one more deterministic fact (`semantico`) with a fixed weight and a motivo, and a semantic top-K becomes an additional candidate source — so a licitação for "cadernos e apontadores" surfaces for a company selling "material escolar" even with zero keyword overlap.

Everything else (tools, chat, UI) stays as is; cards simply show the new motivo chip.

## Primary user story
As an empresa user, when I ask Lixto "quais licitações combinam com minha empresa?", opportunities that are semantically close to what I sell appear with an "aderência semântica" reason even when the edital never uses my exact keywords.

## Out of scope
- Semantic free-text search in `search_procurements` (query embedding) — next cycle
- Reranking with an LLM; hybrid-score tuning beyond the fixed weights
- Re-enriching existing rows (only the embedding is backfilled)
- Any UI beyond the motivo chip label

## Success demo
Done when `plic enrich run` / `plic enrich embed` fill `enriquecimento.embedding`, saving the profile fills `empresa_perfil.embedding`, and `fetchMatches` returns rows carrying a `semantico` motivo with the cosine score in `detalhe` — with `pytest`, `vitest` and `next build` green.
