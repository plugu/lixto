"""Deep, cited tender analysis (cycle 25).

One doc-tier LLM pass per open procurement over the page-tagged text of every
active PDF produces, in a single transaction:

- the canonical enrichment facets this repo already relies on
  (`procurement_enrichments` plus `procurement_categories`,
  `procurement_requirements`, `procurement_cnaes`,
  `procurement_embeddings`) — the match engine, semantic search, recommend
  and digest are untouched, only `schema_version` moves to 2.0;
- the company-agnostic dossier: `tender_analyses` plus its children
  (`tender_analysis_facts`, `_dates`, `_requirements`, `_penalties`,
  `_risks`, `_missing`), where every statement is a cited `fact`, a justified
  `inference`, or a `missing` entry.

`schema.py` holds the contract (JSON schema + validator), `prompt.py` the
Portuguese instructions and the page-tagged prompt builder, `worker.py` the
select → LLM → persist loop behind `lixto analyze run`. Text extraction stays
in `lixto.enrich.documents`; the facet contract stays in
`lixto.enrich.schema`.
"""
