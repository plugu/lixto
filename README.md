# Lixto — AI Procurement Agent

An AI agent that mirrors Brazilian public tenders (licitações) from PNCP (Portal Nacional de Contratações Públicas) into PostgreSQL, enriches them with structured insights and embeddings, and helps suppliers find and prepare competitive bids through conversational search.

## Quick Start

### Prerequisites
- **Docker & Docker Compose** (PostgreSQL 16 with pgvector)
- **uv** (Python package manager)
- **Python 3.12+**
- **Node.js 20+** (for the web interface)

### 1. Start the Database

```bash
docker compose up -d
```

Database: `lixto` on `localhost:5433` (user: `lixto`, password: `lixto`).

### 2. Initialize Schema

```bash
uv run lixto db init
```

Applies all SQL migrations. Schema name: `lixto` (v1.0, English identifiers).

### 3. Seed Reference Data

```bash
uv run lixto cnae seed
```

Fetches IBGE CNAE subclasses (industry classifications) — ~8,800 codes.

### 4. Sync Procurement Data

```bash
# Full historical backfill
uv run lixto backfill

# Incremental sync (new/updated procurements since last run)
uv run lixto sync incremental

# Detailed sync (items + documents for procurements missing them)
uv run lixto sync details

# Results (homologated winners/prices)
uv run lixto results sync

# Annual procurement plans (PCA)
uv run lixto plans sync

# Contracts + amendments
uv run lixto contracts sync
```

### 5. Enrich & Embed

```bash
# Global enrichment (once per procurement, every LLM tier routed automatically)
uv run lixto enrich run

# Backfill pgvector embeddings (for semantic search)
uv run lixto enrich embed
```

### 6. Web Interface

```bash
cd web
npm install
npm run dev
```

Opens at `http://localhost:3000`. Routes:
- `/login`, `/signup`, `/invite/[token]` — authentication
- `/company/profile` — match profile (CNAEs, products, keywords, states, value range)
- `/company/users`, `/company/documents` — team & habilitação
- `/procurements` — list/search open tenders
- `/procurement/[sourceId]` — detail, items, edital download
- `/lixto` — conversational agent; ask "quais licitações combinam com minha empresa?"
- `/dashboard` — system status

## Environment Variables

| Variable | Purpose | Example / Default |
|---|---|---|
| `LIXTO_DATABASE_URL` | PostgreSQL | `postgresql://lixto:lixto@localhost:5433/lixto` |
| `LIXTO_INTERNAL_TOKEN` | Shared secret for batch endpoints (`/api/internal/*`); same value on web + CLI | — (required in prod) |
| `LIXTO_WEB_INTERNAL_URL` | Base URL of the web app's internal batch endpoints (CLI only) | `http://localhost:3000` (dev), `http://lixto-web-evs842:3000` (prod) |
| `LIXTO_LLM_BASE_URL` | Primary LLM provider base URL (OpenAI-compatible) | `https://generativelanguage.googleapis.com/v1beta/openai/` (Gemini) |
| `LIXTO_LLM_API_KEY` | Primary provider API key | — (Gemini key) |
| `LIXTO_LLM_MODEL_CHEAP` | Text classification model | `gemini-3.5-flash-lite` |
| `LIXTO_LLM_MODEL_DOC` | PDF parsing model (chat completions with file parts) | `gemini-3.7-flash` |
| `LIXTO_LLM_MODEL_STRONG` | Deep reasoning model | `gemini-3.7-flash` |
| `LIXTO_LLM_MODEL_EMBED` | Embedding model (1536 dims, never falls back) | `gemini-embedding-001` |
| `LIXTO_CHAT_MODEL` | Chat agent model | `gemini-3.7-flash` |
| `LIXTO_RECOMMEND_MODEL` | Recommendation model (GO/NO-GO, Tier-3) | `gemini-3.7-flash` |
| `LIXTO_LLM_FALLBACK_BASE_URL` | Secondary provider base URL (used on primary error) | `https://api.openai.com/v1` (OpenAI) |
| `LIXTO_LLM_FALLBACK_API_KEY` | Secondary provider API key | — (OpenAI key) |
| `LIXTO_LLM_FALLBACK_MODEL_CHEAP` | Fallback cheap model | `gpt-5-mini` |
| `LIXTO_LLM_FALLBACK_MODEL_DOC` | Fallback doc model | `gpt-5-mini` |
| `LIXTO_LLM_FALLBACK_MODEL_STRONG` | Fallback strong model | `gpt-5.1` |
| `LIXTO_FENCE_PORTALS` | Comma-separated list of allowed portals (cost fence) | `Compras.gov.br,ECustomize Consultoria em Software S.A,IPM Sistemas` |
| `LIXTO_FENCE_MODALITIES` | Comma-separated modality IDs (cost fence) | `6,8` |
| `LIXTO_FENCE_OPEN_ONLY` | Restrict to open/upcoming procurements (cost fence) | `1` |
| `LIXTO_ENRICH_DAILY_CAP` | Max enrichment rows/day; 0 or unset = unlimited | `1500` |
| `LIXTO_IBGE_CNAE_URL` | CNAE seed source | `https://concla.ibge.gov.br/export/tabelas/ascii/subclasses.txt` |
| `LIXTO_MIN_REQUEST_INTERVAL` | Seconds between PNCP requests | `0.5` |
| `UPLOADS_DIR` | Document storage path | `./uploads` (dev), `/app/uploads` (prod) |

## CLI Commands

### Database
- `lixto db init` — Apply all pending SQL migrations.

### Sync (incremental, resumable)
- `lixto sync incremental [--since YYYY-MM-DD] [--max-details N]` — Pull changes from PNCP's `/v1/contratacoes/atualizacao` (watermarked per modality).
- `lixto sync details [--limit N]` — Fetch items/documents for procurements missing them.

### Sync (targeted domains)
- `lixto results sync [--limit N]` — Drain the demand queue for homologated results.
- `lixto plans sync [--since YYYY-MM-DD] [--until YYYY-MM-DD]` — Fetch annual procurement plans (PCA) from `/v1/pca/atualizacao`.
- `lixto contracts sync [--since YYYY-MM-DD] [--until YYYY-MM-DD] [--max-amendments N]` — Fetch contracts from `/v1/contratos/atualizacao` and amendments from `/v1/orgaos/{cnpj}/contratos/{ano}/{seq}/termos`.

### Backfill
- `lixto backfill [--since YYYY-MM-DD] [--until YYYY-MM-DD] [--modality CODE ...]` — Full fetch from PNCP since a date (resumable).

### Enrichment
- `lixto enrich run [--limit N] [--days N] [--retry-errors]` — Produce one canonical enrichment per open procurement (routes to cheap/doc tier automatically).
- `lixto enrich embed [--limit N]` — Backfill pgvector embeddings for semantic search; both chat and `/procurements` search support free-text semantic matching (in addition to keyword search).

### Proactive Agent Loop
- `lixto match run [--company-id N] [--since YYYY-MM-DD]` — Score procurements enriched since the last run against every company profile/CNAEs, persist `matches` and upsert `opportunities` (POST `/api/internal/match/run` on the web app).
- `lixto recommend run [--company-id N] [--limit N]` — Build GO/NO-GO/borderline recommendations with rationale and confidence for the top new opportunities per company (POST `/api/internal/recommend/run` on the web app).

### Reference Data
- `lixto cnae seed` — Fetch IBGE CNAE subclasses and upsert (idempotent).

### Status
- `lixto status` — Print database statistics.

## Schema

**Entity layers** (see `docs/DATA_MODEL.md` for full reference):

1. **World model** — `procurements`, `procurement_items`, `procurement_documents`, `procurement_results`, `agencies`, `agency_units`
2. **Enrichment** — `procurement_enrichments`, `procurement_categories`, `procurement_requirements`, `procurement_cnaes`, `procurement_embeddings`
3. **Plans & contracts** — `procurement_plans`, `procurement_plan_items`, `contracts`, `contract_amendments`
4. **Companies** — `companies`, `company_cnaes`, `company_profiles`, `company_documents`
5. **Users & auth** — `users`, `sessions`
6. **Agent core** — `agent_runs`, `conversations`, `messages`, `opportunities`, `matches`, `recommendations`, `agent_actions`, `opportunity_feedback`
7. **Reference** — `sources`, `source_payloads`, `cnae_codes`, `sync_state`

## Production Schedules

Dokploy project `lixto`, app `lixto-cli`, timezone `America/Sao_Paulo`:

| Schedule | Cron | Command | Status |
|---|---|---|---|
| sync-incremental | `0 6,13,20 * * *` | `lixto sync incremental --max-details 2000` | Enabled |
| results-sync | `0 3 * * *` | `lixto results sync --limit 2000` | Enabled |
| plans-sync | `0 4 * * *` | `lixto plans sync` | Disabled (manual) |
| contracts-sync | `0 5 * * *` | `lixto contracts sync --max-amendments 500` | Disabled (manual) |
| enrich-run | `30 7,14,21 * * *` | `lixto enrich run --days 30 --limit 300` | Enabled |
| match-run | `0 8,15,22 * * *` | `lixto match run` | Disabled (user decision) |
| recommend-run | `15 8 * * *` | `lixto recommend run` | Disabled (user decision) |
| enrich-embed | `45 7,14,21 * * *` | `lixto enrich embed` | Disabled (created disabled until ingestion enabled) |
| db-init | `0 0 31 2 *` | `lixto db init` | Disabled (manual) |

Dates `0 0 31 2 *` (Feb 31st) never fire; use for manual-only schedules.

## Transactional email

Lixto sends transactional email (account invites, password reset, welcome, daily digest) via a self-hosted Postfix MTA on `plugu-prod01`.

### Outbox Model

New table `email_messages` persists all outbound mail:
- `id`, `to_email`, `template` (welcome|invite|password_reset|daily_digest), `payload JSONB`, `subject`, `status` (queued|sending|sent|failed|suppressed), `attempts`, `last_error`, `provider_message_id`, `scheduled_for`, `sent_at`
- `email_suppressions` tracks hard bounces and unsubscribes (address, reason, created_at)

### Templates

| Template | Purpose | Unsubscribable |
|---|---|---|
| `welcome` | Account created | No (transactional) |
| `invite` | Accept invite link | No (transactional) |
| `password_reset` | Reset token + link | No (transactional) |
| `daily_digest` | New attention-scoring opportunities | Yes (footer link suppresses future digests) |

All render HTML + text from a shared Portuguese layout with unsubscribe footer (digest only).

### CLI Commands

```bash
# Drain outbox (sends up to N messages; default 20)
lixto email worker [--limit N]

# Enqueue digest for a company (runs after `lixto recommend run`)
lixto email digest [--company-id N]
```

### Dokploy Schedules (on `lixto-cli`)

| Schedule | Cron | Command |
|---|---|---|
| `email-worker` | `*/5 * * * *` | `lixto email worker --limit 20` |
| `email-digest` | `30 8 * * *` | `lixto email digest` |

### Status Monitoring

`lixto status` includes an email block:
```
email:
  queued: <n>
  sent (24h): <n>
  failed (24h): <n>
  suppressed: <n>
```

### Deploy Runbook (First-Time Setup)

1. **Adopt the two existing apex records — mandatory, before any apply.** The zone already has `TXT "v=spf1 -all"` and `MX 0 .`; with empty state Terraform *creates* its own alongside them, and two SPF records is an SPF permerror that fails DMARC on every message. Import them (ids via the Cloudflare API — see `infra/terraform/README.md` § *Mandatory pre-apply import*) or delete both in the dashboard first:
   ```bash
   terraform -chdir=infra/terraform init
   terraform -chdir=infra/terraform import cloudflare_dns_record.apex_spf "$ZONE_ID/<spf_record_id>"
   terraform -chdir=infra/terraform import cloudflare_dns_record.apex_mx  "$ZONE_ID/<mx_record_id>"
   ```

2. **Provision DNS records** (Terraform):
   ```bash
   terraform -chdir=infra/terraform plan -out=mail.tfplan   # apex_spf/apex_mx must be ~ update, not + create
   terraform -chdir=infra/terraform apply mail.tfplan
   ```
   Creates `mail.lixto.com.br` A record (grey-cloud, no proxying), MX, SPF, DKIM (public half), DMARC on Cloudflare. Verify singularity right after: `dig +short TXT lixto.com.br` and `dig +short MX lixto.com.br` must each return exactly one line.

3. **Deploy MTA container**:
   - Create `lixto-mail` app in Dokploy from `infra/mail/Dockerfile`
   - Service runs Postfix + opendkim, reachable on internal Docker network (submission port 25 only); **do not publish port 25 to the host** — docker-proxy would rewrite every client to the bridge gateway and put it inside `$mynetworks`
   - Set `MYNETWORKS` to the app's own subnet — nothing wider. Get it on the host with:
     ```bash
     docker network inspect dokploy-network -f '{{range .IPAM.Config}}{{.Subnet}} {{end}}'
     ```
     e.g. `MYNETWORKS="127.0.0.0/8 [::1]/128 10.0.1.0/24"`. The entrypoint refuses to start on `0.0.0.0/0`, on a whole RFC1918 block, or on anything wider than a `/16`; envelope senders are additionally restricted to `@lixto.com.br` by `smtpd_sender_restrictions`
   - On startup, generates DKIM keypair in volume at `/var/db/dkim/{selector}.private`

4. **Extract and apply DKIM public key**:
   - Read DKIM public key from MTA container logs (`docker logs lixto-mail | grep -A4 'DKIM public record'`)
   - Set `dkim_public_key` in `infra/terraform/terraform.tfvars` (untracked; the Terraform variable name, not an env var)
   - Re-run `terraform -chdir=infra/terraform apply` to publish DNS record

5. **Set PTR record** (manual, via Hostinger hPanel):
   - IP: `187.127.16.246`
   - Hostname: `mail.lixto.com.br`
   - (No Hostinger Terraform provider; this must be done out-of-band)

6. **Authorise DMARC reporting** in the `dmarc_rua` domain's zone (default `plugu.solutions`), otherwise the aggregate reports are dropped by every reporter:
   ```
   lixto.com.br._report._dmarc.plugu.solutions.  TXT  "v=DMARC1"
   ```

7. **Send test email** and verify:
   - Create a test user and invite
   - Check inbox (not spam) for SPF, DKIM, DMARC headers
   - View in Gmail "Show original" — all three should pass
   - Note: Hostinger caps outbound at 5 msg/min. Postfix stays under it with `default_transport_rate_delay = 15s` **plus** `smtp … maxproc=1` in `infra/mail/master.cf`: one message per 15 s = 4 msg/min globally, regardless of how many destination domains are queued. Both settings are load-bearing — the per-destination delay alone does not cap the host.

**Escape hatch**: If the IP reputation causes filtering (Gmail/Outlook), point Postfix `relayhost` at an external submission service on 587/465 (config change only, no code changes).

## Go-live runbook

When moving Lixto to production ingestion:

1. **Set environment on both apps** in Dokploy:
   - `lixto-cli`: All vars from `.env.example` (Gemini key, fence, cap, fallback OpenAI key)
   - `lixto-web`: All vars from `web/.env.example` (Gemini key, embedding and chat models)

2. **Backfill the last 45 days** (one-off, resumable):
   ```bash
   lixto backfill --days 45 --max-details 0
   ```
   This fetches 45 days of fenced procurements and queues items/documents for drain by the scheduled details sync.

3. **Drain enrichment** until `daily cap reached`:
   ```bash
   lixto enrich run
   ```
   The cap is enforced per day; monitor `lixto status` for tokens and estimated USD.

4. **Enable schedules in order** in Dokploy (one-off each):
   - `sync-incremental` — pulls new fenced procurements
   - `enrich-run` — produces enrichments up to the daily cap
   - `enrich-embed` — backfills missing vector embeddings for semantic search
   - `match-run` — scores procurements against company profiles; persists opportunities
   - `recommend-run` — builds GO/NO-GO recommendations for top scoring opportunities

5. **Monitor cost** with `lixto status` — shows today's LLM spend (calls, tokens, estimated USD) and last 7 days' total.

**Important**: The embedding model (`LIXTO_LLM_MODEL_EMBED`) must never change after ingestion starts, as all vectors in the table would become incomparable. If you need to re-embed, either run a full backfill or set up a new vector table and migrate indices.

## Troubleshooting

### Database connection refused
```bash
docker compose ps
docker compose up -d
```

### No results after sync?
Check `lixto status` for watermarks and error counts. Verify PNCP availability with:
```bash
curl -s https://pncp.gov.br/api/swagger-ui.html
```

### LLM rate-limited?
Adjust `LIXTO_MIN_REQUEST_INTERVAL` (PNCP, not LLM) and set `LIXTO_LLM_MODEL_FALLBACK` for retry.

### Enrichment stuck?
```bash
lixto enrich run --limit 10 --retry-errors  # Reprocess failures
```

## Architecture

See `docs/ARCHITECTURE.md` for the pipeline, LLM tiers, scoring, and tools.

See `docs/VISION.md` for the product vision and implementation status.

## License

(Placeholder)
