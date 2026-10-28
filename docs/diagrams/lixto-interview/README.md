# Lixto — interview architecture

Open [presentation.html](presentation.html) for a five-slide presentation with arrow-key navigation, fullscreen and printing. It works offline; the SVGs are embedded. Drag either `.excalidraw` file into Excalidraw to edit its native shapes, text and arrows. Frames are arranged vertically. Select a frame to focus on one view.

- [Current architecture](lixto-current.excalidraw): system overview, hybrid retrieval, analysis and decision loop.
- [Proposed AWS architecture](lixto-aws.excalidraw): deployment and migration mapping.
- Individual SVG files are presentation-ready previews; edit the Excalidraw originals and export again if making changes.

The current view is based on repository revision `3004550`, inspected on 2026-10-28. Production schedule status comes from README's **2026-09-08 snapshot**, not a live infrastructure audit. Model/provider configuration is described by the repository, not verified against deployed secrets. The AWS view is a proposal; no infrastructure was provisioned.

## Five-minute walkthrough

**1 — Product and architecture (60 seconds).** “Lixto helps suppliers discover Brazilian public procurement opportunities and decide whether to pursue them. Python handles ingestion and document processing; Next.js serves the UI and runs company-specific domain logic. Both use PostgreSQL. Public procurement data is ingested and enriched once, while company profiles, opportunities and cases are scoped to each tenant.” Point to the separation between shared evidence and company decisions.

**2 — Retrieval (60 seconds).** “We use two representations of a procurement: Portuguese full-text search for exact terminology and embeddings for semantic similarity. PostgreSQL holds both, through GIN and pgvector HNSW indexes. The query applies structured filters to both branches and combines rankings with RRF. If query embedding fails, keyword search still works.” Clarify that the keyword ranker is `ts_rank`, not BM25. The search unit is a procurement, not a PDF chunk. Keyword indexes cover source descriptions/items; analysis-derived text refreshes the semantic vector.

**3 — Evidence and decisions (90 seconds).** “Detailed analysis is queued when requested by a user or needed for a case. The worker fetches the selected tender's documents, extracts page text, calls a model, validates structured output and persists a reusable dossier. This is direct document analysis; the search ranking is not wired into a generic RAG chatbot. Matching and document checks are deterministic. Models are used for interpretation and recommendations; the operator makes the final decision.” Note that page-range validation supports citation integrity but does not prove every model claim correct.

**4 — AWS deployment (45 seconds).** “I would preserve the domain boundaries and move the web service and CLI tasks onto ECS Fargate. EventBridge Scheduler launches scheduled tasks. RDS PostgreSQL retains relational data and hybrid search. S3 replaces local uploads, Bedrock supplies the model APIs, and SES replaces our mail server.” Arrows show selected call/data paths; the managed-services row is shared by web and job tasks, rather than an execution sequence.

**5 — Migration and tradeoffs (45 seconds).** “This needs adapters and operational work. S3 changes file access; SES changes delivery feedback; Bedrock requires model evaluation and coordinated re-embedding. Managed services reduce server maintenance but add networking, service and startup costs. I would benchmark actual workload and availability requirements before sizing.”

## Questions to be ready for

| Question | Defensible answer |
|---|---|
| Why one database? | Relational joins, transaction boundaries, full-text and vector retrieval already fit PostgreSQL. It reduces operational components. Mixed batch and interactive load can contend; measure query latency, connections and index behavior before separating stores. |
| How do you avoid repeated AI cost? | Reuse global dossiers, keep deterministic scoring, cap company analysis/recommendations and record usage in `agent_runs`. Analysis versions follow document-set changes. |
| What happens when dependencies fail? | Sync tracks watermarks and raw payloads; embedding batches commit progressively; failed query embedding falls back to keywords; analysis failures are persisted; email has a durable outbox with bounded retries. Avoid claiming exactly-once delivery. |
| How is tenant isolation enforced? | Session-derived company identity and typed, parameterized query builders. Public tender evidence is shared; private company data and decisions are scoped. This does not imply database-per-tenant or RLS. |
| Where is RAG? | Current hybrid retrieval returns tender records. Dossier generation directly consumes the selected tender's documents. Recommendation prompts combine stored tender/company context. The diagram does not claim chunk retrieval followed by conversational generation. |
| Does feedback train the model? | Outcomes and operator feedback are captured. Automatic learning or ranking retraining is not implemented. |
| Is Radar live? | The implementation exists, but its scheduled ingestion/detection jobs are disabled in the documented deployment snapshot. Confirm live status separately before claiming otherwise. |
| What has not been measured here? | Traffic, corpus size, p95 latency, retrieval quality, model accuracy, availability and monthly cost. Present measured numbers only if you have them. |

## AWS implementation details

This is a managed-services target, not a claim that configuration changes alone will migrate the application.

- **Compute and scheduling:** Package the existing web and CLI workloads in ECR. Run the web as an ECS service and scheduled CLI work as finite Fargate tasks. Override the CLI image's current sleeping entrypoint. Preserve application-level idempotency and review overlapping jobs. Scheduler acceptance of `RunTask` is not successful job completion: monitor ECS task exit status and `agent_runs`. Very frequent jobs may justify a persistent polling worker after measuring startup delay and cost.
- **Internal calls:** CLI commands that delegate match/recommend/case/email work need private service discovery or an internal load balancer to reach the web service. Preserve endpoint authentication, restrict ingress with security groups, and avoid relying on public routing for internal batch calls. These details are collapsed into the “internal HTTP” arrow.
- **Networking:** ALB sits in public subnets; application tasks and RDS sit in private subnets. PNCP is an external dependency, so private tasks need outbound internet routing such as NAT. Scope database access to application security groups. Choose a region and supported model set; these diagrams make no latency, residency or pricing promises. [AWS Fargate networking](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/fargate-task-networking.html).
- **Database:** Confirm extension versions, back up and restore the schema/data, validate migrations and indexes, and configure connection budgets. RDS supports pgvector HNSW. Multi-AZ is a decision based on recovery/availability needs, with a corresponding cost. [RDS pgvector support](https://aws.amazon.com/about-aws/whats-new/2023/10/amazon-rds-postgresql-pgvector-hnsw-indexing/).
- **Uploads:** Replace filesystem paths with private S3 object keys and a storage adapter. Authorize company access before issuing short-lived presigned URLs or streaming files. Maintain encryption, retention and deletion rules. [S3 presigned uploads](https://docs.aws.amazon.com/AmazonS3/latest/userguide/PresignedUrlUploadObject.html).
- **Models:** Add Bedrock provider adapters for the selected generation/PDF and embedding APIs. Evaluate schema compliance, citation quality, recommendation quality, latency and cost. API/model compatibility varies. Do not treat this as an untested endpoint substitution. [Bedrock API compatibility](https://docs.aws.amazon.com/bedrock/latest/userguide/models-api-compatibility.html).
- **Vector migration:** The existing vectors have 1536 dimensions and a shared embedding model. A new model means rebuilding procurement, company-profile, CNAE, classification-label and Radar vectors; a different dimension also requires schema/index changes. Version the embedding space, backfill, evaluate and cut over query/index embeddings together. Keep rollback possible; do not mix spaces.
- **Email:** Preserve the outbox/deduplication logic and use an SES sender adapter. Verify sending identities and obtain production access as applicable. Replace the Postfix DSN maildir path with SNS bounce/complaint events handled by a signature-validated HTTPS endpoint, with idempotent suppression updates and failed-delivery handling. [SES identities](https://docs.aws.amazon.com/ses/latest/dg/verify-addresses-and-domains.html), [SES event notifications](https://docs.aws.amazon.com/ses/latest/dg/monitor-sending-activity-using-notifications.html).
- **Operations:** Use task IAM roles, Secrets Manager, ECR and CloudWatch alongside the application audit tables. Alert on failed/overdue jobs, queue age, database saturation and model cost. [Scheduling ECS tasks](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/tasks-scheduled-eventbridge-scheduler.html).
- **Caches and scaling:** Current caches are local to a web process. Before multiple replicas, implement cache invalidation fan-out or explicitly accept bounded TTL staleness. Preserve session authorization and size aggregate connection pools. The diagrams do not claim that horizontal scaling is already solved.

An incremental migration can first retain existing model providers while moving compute and storage; the diagram's Bedrock target is a separate, evaluated model migration. Neither OpenSearch nor Bedrock Knowledge Bases is required to preserve the current SQL-based hybrid retrieval.

## Repository evidence

Paths are relative to the repository root:

- `CLAUDE.md`, `README.md` (Production Schedules), `docs/ARCHITECTURE.md`: system and deployment context. Some architecture-document sections retain older plans; source code and the newer README schedule snapshot take precedence here.
- `src/lixto/enrich/embed.py`: raw-text and enrichment-text embedding paths, batch persistence.
- `src/lixto/analyze/worker.py`: direct document analysis, input routing, output validation and persistence.
- `web/lib/procurement-queries.ts`: keyword matching, description-based `ts_rank`, semantic retrieval and RRF.
- `web/lib/command-search-queries.ts`: keyword-only command palette.
- `migrations/001_core.sql`, `migrations/005_radar.sql`: full-text and HNSW indexes.
- `web/lib/match-engine.ts`, `web/lib/recommend.ts`, `web/lib/case-batch.ts`: scoring, recommendations, cases and outcomes.
- `web/lib/email/outbox.ts`, `web/lib/cache.ts`: durable outbox and local caching.

Validation: native scene JSON structure, IDs and frame bounds checked; all five SVG previews rendered in Chrome and visually inspected. Application behavior is unchanged; application tests were not run for these presentation artifacts.
