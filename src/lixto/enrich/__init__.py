"""Global procurement enrichment (ported from `plic.enrich`, cycle 18).

One canonical, versioned enrichment per procurement — produced once and
reused by every company, never re-run per tenant. This package holds the
contract (`schema.py`: the LLM JSON schema and normalization rules), the
deterministic edital text extraction that feeds it (`documents.py`), the
worker that persists it (`worker.py`) and the embedding backfill
(`embed.py`).

Persisted in `procurement_enrichments` plus the facet tables
`procurement_categories`, `procurement_requirements`, `procurement_cnaes`,
`procurement_embeddings` and `procurement_document_texts` (ADR 001 §D3).
"""
