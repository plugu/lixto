---
mode: mvp
routing_profile: cloud
parallel_default: sequential
---

# Lixto — Future Procurement Radar, MVP V1 (cycle 24)

## What / why
Lixto today is reactive: it finds procurements already published on PNCP. The Radar surfaces public purchases that are *likely to happen* before the notice exists, so a supplier can quote, stock, and get compliant ahead of competitors. V1 tests one hypothesis — "users value seeing planned public purchases before the tender is published" — using only PNCP Annual Procurement Plans (PCA) matched against the company profile.

Repo facts that shape V1:
- PCA ingestion already exists (`lixto plans sync` → `procurement_plans` / `procurement_plan_items`, with `desired_date`, values, PDM/catalog codes, Portuguese FTS). The `plans-sync` Dokploy schedule is disabled; V1 enables it (daily) and adds nothing to that pipeline beyond an embedding backfill for plan items.
- Cycle-18 tables are never altered (ADR 001). Radar state lives in **new tables** in a new migration: a future-opportunity row per PCA item, its signals (`[{code, weight, detail}]`, same shape as `matches.reasons`), a per-company match row, and per-company actions (saved / ignored) plus the cached AI analysis.
- **One opportunity = one PCA item.** Traceable evidence, no clustering logic. Grouping by agency+PDM is V2.
- **Two separate scores.** *Opportunity score* (0–100, will-it-happen): PCA-only in V1 — `PCA_ITEM` base + `DATE_APPROACHING` (desired date within horizon) + `RECENT_PLAN_UPDATE`; weights from env (`LIXTO_RADAR_WEIGHT_*`), defaults documented. *Company match score* (0–100): deterministic — profile `terms`/`exclusion_terms` FTS on item description, `states` vs agency state, `min/max_value` band, plus cosine similarity between profile embedding and a new plan-item embedding (same embed pipeline as procurements). **No LLM per item.**
- **Deterministic "why", on-demand AI.** "Why are we showing this?" is always rendered from the signal list. "Analyze with AI" calls the LLM once per opportunity×company (why it may happen / compatibility / what to prepare), result cached; zero LLM spend for unopened items. Copy must say *likely / estimated / possible* — never a confirmed fact.
- **Validation deferred, but not lost.** Each opportunity row carries `detected_at` and `status` (`predicted` now; `procurement_found` / `expired` set by a V2 linker), so "found N days before publication" is computable retroactively over V1 data.
- Horizon: items whose `desired_date` is today or later (or null) and plan `year` ≥ current year. Items past their desired date age out of the list.

## Primary user story
As a Lixto user whose company profile is filled in, I open **Radar** and see planned public purchases matched to what I sell, ranked by score, each explaining exactly which PCA item, agency, date and value it rests on — so I can prepare for the tender weeks or months before it is published.

## Out of scope
- Historical-pattern, expiring-contract, price-registration signals (V2/V3)
- Prediction linker / `procurement_found` transitions and lead-time badge (V2; only `detected_at`+`status` columns ship now)
- Clustering items into agency-level opportunities
- Price intelligence, competitor/winner analysis, preparation workflows
- Alerts, notes, follow, 👍/👎 feedback, digest-email inclusion
- Radar dashboard tiles / product metrics
- Any LLM classification of PCA items; any ML model
- Fencing PCA ingestion (stays nationwide as today)

## Success demo
Done when I can log in as a company with a profile, open `/radar`, see PCA-derived future opportunities matched to my profile ranked by score, filter by state / period / value / min score, open one and see its evidence (agency, PCA item, desired date, estimated value, PNCP link) plus the deterministic "why" and an "Analyze with AI" result, then save or ignore it and find that choice persisted on reload — all on prod data after `lixto plans sync` and the new radar CLI job have run.
