# Lixto — Intelligence Layer (Cycle 16)

The Lixto agent combines global enrichment, per-empresa profile matching, and conversational search to answer: "What open bids can my company join?"

## Pipeline

```
PNCP → sync-incremental → licitacao + item + documento
         ↓
    documento_texto (text extracted by pypdf, stored once per PDF)
         ↓
    enriquecimento (canonical, global: categorias, requisitos, me_epp_exclusivo, riscos, etc.)
         ↓ + embedding (pgvector, text-embedding-3-small, 1536 dims)
         ↓
    empresa_perfil (per-tenant: produtos, termos, exclusões, UFs, valor_min/max)
         ↓ + embedding (on save, best-effort)
         ↓
    match engine (on-demand, deterministic: score 0–100 + motivos; includes semantic similarity)
         ↓
    tools (search_procurements, search_my_matches, get_procurement, calculate_match, analyze_procurement)
         ↓
    chat (agent routes user intent to tools, conversas + mensagens persisted)
```

## Database & Embeddings (Cycle 17)

**Production PostgreSQL** runs `pgvector/pgvector:pg18-trixie` (pgvector 0.8.6 with glibc 2.41, same collation as previous `postgres:18` for seamless migration). **Local development** uses `pgvector/pgvector:pg16-trixie` in Docker Compose. Both variants support the pgvector extension (enabled in `plic db init`), HNSW cosine-distance indexing, and the `::vector` cast operator.

Embeddings are 1536-dimensional vectors from `text-embedding-3-small` (configurable via `PLIC_LLM_MODEL_EMBED` environment variable, read by Python `cli`). Backfill command: `plic enrich embed [--limit N]` — idempotent, resumable, skips rows with existing embeddings, embed failures do not block the enrichment pipeline.

Profile embedding text is composed of: `produtos: <field> | palavras-chave: <field> | observações: <field>`.

## Data Model

| Table | Purpose |
|-------|---------|
| **enriquecimento** | One row per licitação: canonical, global, reused by all empresas. Fields: resumo, categorias, conceitos, palavras_chave, cnae_candidatos, requisitos, me_epp_exclusivo, me_epp_preferencia, exige_certificacao, exige_atestado_tecnico, entrega, riscos, complexidade, **embedding** (pgvector, 1536 dims), dados (JSONB), status (done/error). |
| **documento_texto** | Extracted text from edital PDFs (pypdf). Deterministic, stored once: metodo (pypdf/insuficiente/nao_pdf/falha), paginas, chars, texto. |
| **empresa_perfil** | Per-tenant match profile. Fields: produtos (raw), palavras_chave, exclusões, termos (normalized union), exclusoes_termos, ufs (empty = all), valor_min/max, **embedding** (pgvector, 1536 dims, on save), observacoes. |
| **conversa** | Persisted chat threads: empresa_id, usuario_id, titulo, timestamps. Tenant-scoped twice: both id and usuario_id gate reads. |
| **mensagem** | One turn per thread: role (user/assistant/tool), conteudo, tool_calls (JSONB array), tool_call_id, refs (LicitacaoRef[] shown as cards), modelo. |

## LLM Tier Routing

| Tier | Purpose | Model | Input |
|------|---------|-------|-------|
| **Tier 0 (Structured)** | No document available, only metadata. | — | licitacao.objeto_compra, item.descricao, CNAE, etc. |
| **Tier 1 (Cheap text)** | Edital text extracted by pypdf. | `PLIC_LLM_MODEL_CHEAP` (gpt-5-mini) | documento_texto.texto (up to 60K chars). |
| **Tier 2 (Doc)** | Scanned or insufficient-text PDFs. | `PLIC_LLM_MODEL_DOC` (gpt-5.1) | Raw PDF via Responses API (OpenAI only). |
| **Tier 3 (Strong)** | Deep reasoning, complex analysis. | `PLIC_LLM_MODEL_STRONG` (gpt-5.1) | Reserved for agents/deep.py. |

Fallback: `PLIC_LLM_MODEL_FALLBACK` (optional) buys one retry after tier-1 failure.

## Match Scoring (Cycle 17)

Deterministic scoring: **0–100 range** (clamped, max raw is 110 with all signals; see `scoreCandidate()` in `web/lib/match-engine.ts`). Each applied rule emits a `Motivo` (código, peso, detalhe) so the UI explains the score without re-deriving it.

| Motivo (código) | Peso | Trigger |
|---|---:|---|
| `cnae_principal` | +35 | Empresa CNAE matches principal candidate in enrichment. |
| `cnae_secundario` | +25 | Empresa CNAE matches secondary candidate (if no principal). |
| `termo_enriquecimento` | +35 (≥2 hits) / +25 (1 hit) | Enrichment keywords overlap empresa.termos. |
| `termo_texto` | +15 | Empresa terms found in licitacao.objeto or item.descricao (FTS fallback). |
| `uf_ok` | +10 | UF matches empresa_perfil.ufs (empty list = all UFs). |
| `uf_fora` | −20 | UF mismatch (quando ufs é não-vazio). |
| `valor_ok` | +10 | Licitacao.valor_total_estimado within empresa_perfil.valor_min/max. |
| `valor_fora` | −15 | Value outside range. |
| `valor_desconhecido` | +5 | Value unknown. |
| `me_epp_exclusivo` | −40 | Licitação reserved to ME/EPP; empresa is not (porte ∉ {MEI, ME, EPP}). |
| `exige_certificacao` | −5 | Enrichment flags certificação required. |
| `exige_atestado` | −5 | Enrichment flags atestado técnico required. |
| `exclusao` | −50 | Empresa exclusion term found in objeto/itens. |
| `semantico_alto` | +20 | Cosine similarity ≥ 0.55 between perfil and enrichment embeddings (high semantic match). |
| `semantico` | +10 | Cosine similarity ≥ 0.40 (lower semantic match). Null when either side lacks embedding. |
| `sem_perfil` | 0 | Empresa has no termos, no CNAE overlap, and no semantic signal (not scored). |

Final score clamped to **0–100** (motivos keep their raw values for UI display).

## Agent Tools

The chat model never writes SQL; all queries go through these five tools:

| Tool | Purpose |
|------|---------|
| **search_procurements** | Search public tenders by text, UF, modalidade, value range, status. Used for general discovery (no profile required). |
| **search_my_matches** | Search licitações compatible with logged-in empresa's profile, already scored 0–90 with motivos. Requires empresa_perfil or CNAEs; redirects to `/empresa/perfil` if missing. |
| **get_procurement** | Fetch full details of one tender: metadata, itens, edital/anexo links, enrichment summary, and legacy análise result (Fit badge). |
| **calculate_match** | Score up to 10 identified licitações against the empresa profile, returning score + motivos for each. For comparing or ranking already-found tenders. |
| **analyze_procurement** | Full dossier: tender details, itens, documents, enrichment, match score, legacy análise, plus empresa profile summary (termos, UFs, valor range). Explains "should we bid?" with all context. |

## "Not Yet" (Out of Scope)

- **Query-time semantic search:** On-demand search of licitações by embedding user queries (user-side vectors, like perfil embedding). Available in next cycle.
- **Proactive digest:** Daily digest, push notifications on new matches → next cycle.
- **Prepare/execute:** Document prep, proposal builder, submission, approval workflow → next cycle.
- **Learning loop:** Feedback capture tables, match score tuning via user signals.
- **Multi-agent architecture:** Single agent with tool layer; no separate vector DB or multi-model orchestration.
- **Re-enrichment per empresa:** One canonical enrichment per licitação, never per-customer re-analysis.
- **Deleting legacy triage/deep pipeline:** `agents/triage.py`, `agents/deep.py`, `analise` table, `company_profile.md` remain untouched. They still feed the Fit badge. Removal → later cycle.
