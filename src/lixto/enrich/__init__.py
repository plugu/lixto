"""Global procurement enrichment support.

The worker that used to live in this package (`lixto enrich run`) was
replaced in cycle 25 by `lixto.analyze` (`lixto analyze run` / `lixto
analyze jobs`), which writes the same enrichment facets plus the deep
tender-analysis dossier in one pass. This package now holds what that
worker — and the rest of the app — still depends on: the deterministic
edital text extraction (`documents.py`), the enrichment facet schema and
normalization contract (`schema.py`), and the embedding backfill used by
both `lixto enrich embed` and `lixto.analyze` (`embed.py`).

Persisted in `procurement_enrichments` plus the facet tables
`procurement_categories`, `procurement_requirements`, `procurement_cnaes`,
`procurement_embeddings` and `procurement_document_texts` (ADR 001 §D3).
"""
