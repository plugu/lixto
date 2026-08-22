"""Agentic triage/deep-analysis pipeline (cycle 4).

`plic agents run` scores new licitações against `company_profile.md` (fit
triage, ticket 13) and, later, deep-reads promising editais (ticket 14).
Verdicts persist in the `analise` table (migrations/006_analise.sql).
"""
