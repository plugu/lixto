---
mode: mvp
routing_profile: cloud
parallel_default: sequential
---

# Lixto — Classification at ingest: CNAE, segment, keywords (cycle 32)

## What / why
The match engine already rewards a shared CNAE and keyword overlap, and `/procurements` has a category facet. All three read tables only `lixto analyze run` writes, and that cron is **off**. Result: empty tables for nearly every open tender, a CNAE signal that never fires, a facet fed by a few dossiers.

This cycle gives every open tender a cheap, global classification right after sync, independent of the dossier: probable CNAE subclasses, one closed segment, one nature, a short keyword list.

Repo facts that shape the cycle:
- **Deterministic first.** `procurement_embeddings` already holds a vector for every open/upcoming tender (description + items). CNAE subclasses (`cnae_codes`, IBGE descriptions) and the segment list get embedded once; pgvector nearest neighbours are the candidate set. No LLM generates a CNAE code.
- **LLM only chooses.** One tier-CHEAP call per tender (description, items, candidates), closed-set output: ≤3 CNAEs with confidence, 1 segment, 1 nature (`bens|servicos|obras`), ≤10 keywords. Codes outside the candidates are dropped. Daily cap by env, `agent_runs` counters. ~US$ 0.0007 per tender; keywords add ~15%.
- **Scope = all open/upcoming tenders of modalities 6 and 8, any portal.** No `LIXTO_FENCE_PORTALS`: first step toward match-first over all of PNCP.
- **Coexistence with the dossier.** `procurement_cnaes.origin` currently allows only `'enrichment'`; the analysis worker deletes and rewrites the CNAE and category rows per tender. New origin for ingest classification; dossier results, when present, win on CNAE confidence but never erase ingest rows, and ingest never overwrites dossier rows. Needs a migration (009) and a change to the worker's delete.
- **Closed taxonomy.** Segments (~24) and nature live in a seed table mirrored in code; the `/procurements` category facet becomes the segment facet. Keywords live on the new `procurement_classifications` row (GIN); the match's `term_enrichment` reads them together with dossier keywords; never a facet. (Not `procurement_enrichments`: a row there would pull the tender out of the ingest-embedding queue and mark it analysed.)
- **Pipeline.** `lixto classify run` chained after `lixto enrich embed` in `sync-incremental` (`;` semantics preserved); the same command backfills already-synced open tenders. Match reasons `cnae_primary`/`cnae_secondary` consume the new rows with no weight change. The batch match today only scores tenders whose dossier changed since the last run; it must also pick up tenders whose classification changed, or nothing new reaches `/opportunities`.
- **ME/EPP from items, no LLM.** `procurement_items.benefit_type_id` (PNCP `tipoBeneficio`; 1 = exclusive ME/EPP) is already ingested and unused. The match's existing `me_epp_exclusive` reason reads it when the dossier flag is null; same weight.
- **Cache.** New rows change facets; the run ends with the existing `cache/revalidate` call.

## Primary user story
As a company with CNAEs on its profile, the morning after a sync I open `/opportunities` and see tenders whose score explains "CNAE 4751-2/01 em comum" even though nobody ran an analysis on them; on `/procurements` I filter by segment "Informática" and the list is only tenders classified that way.

## Out of scope
- Classifying closed tenders or other modalities (backfill covers open ones only)
- Changing match weights, the semantic band, or the recommendation prompt
- Human correction UI for wrong CNAEs; feedback loop
- Replacing the deep analysis facets (`risks`, requirements, ME/EPP flags)
- Jev / any non-OpenAI-compatible provider; local models
- Removing `LIXTO_FENCE_PORTALS` from `analyze run`
- New portal adapters; Radar (PCA) classification

## Success demo
Done when, on prod after one `sync-incremental`, ≥95% of open/upcoming modality 6/8 tenders have ≥1 CNAE and a segment within an hour; a 100-tender sample reviewed by the owner has the top-1 CNAE right in ≥80% and the segment in ≥90%; a company with CNAEs sees `cnae_primary`/`cnae_secondary` reasons on `/opportunities`; and `/procurements` filters by segment.
