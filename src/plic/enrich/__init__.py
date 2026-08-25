"""Global licitação enrichment (cycle 16).

One canonical, versioned enrichment per licitação — produced once at
ingestion and reused by every empresa, never re-run per tenant. This package
holds the contract: the LLM JSON schema and normalization rules
(`schema.py`) plus the deterministic edital text extraction that feeds it
(`documents.py`). Persisted in `enriquecimento` / `documento_texto`
(migrations/010_enriquecimento.sql).
"""
