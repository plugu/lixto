---
id: 07
status: todo
model: sonnet
depends_on: []
max_attempts: 3
files:
  - migrations/002_web_read.sql
  - web/package.json
  - web/next.config.ts
  - web/tsconfig.json
  - web/app/layout.tsx
  - web/app/globals.css
  - web/app/page.tsx
  - web/components/sidebar.tsx
  - web/components/status-badge.tsx
  - web/lib/db.ts
  - web/lib/format.ts
  - web/lib/format.test.ts
  - web/lib/status.ts
---
## Goal
Next.js app in `web/` showing a paginated, styled list of real licitações, plus the read-side migration.

## Context
Next.js 15 (App Router, TypeScript, server components), Tailwind v4, `pg` pool reading `PLIC_DATABASE_URL` (same default as `src/plic/settings.py`), vitest for unit tests. Column names: `migrations/001_schema.sql`. Style + pt-BR rules: `docs/WEB_STYLE.md` — follow exactly.

`migrations/002_web_read.sql` (applied via `uv run plic db init`):
- `licitacao.portal TEXT GENERATED ALWAYS AS (substring(link_sistema_origem from '^https?://([^/]+)')) STORED` + btree index; NULL when no link.
- GIN index on `to_tsvector('portuguese', coalesce(descricao,''))` on `item`.

Page `/`: rows per WEB_STYLE (objeto clamped, órgão, município/UF, modalidade, status badge, valor estimado R$, encerramento). Status logic in `lib/status.ts` mirroring the `v_abertas`/`v_futuras`/`v_encerradas` definitions (001_schema.sql). Order: abertas closing soonest, then futuras, then fechadas newest. Pagination 25/page via `?pagina=N`. Rows link to `/licitacao/[numeroControlePncp]` (page itself is ticket 09 — dead link OK now).

## Checks (run in order — cheapest first)
1. `cd web && npx tsc --noEmit`
2. `cd web && npx vitest run`
3. `cd web && npm run build`
4. `uv run plic db init && docker compose exec -T db psql -U plic -d plic -tc "select count(distinct portal) from licitacao" | awk '{exit ($1>0)?0:1}'`
5. `cd web && (npm run start -- -p 3100 &) && sleep 5 && curl -s localhost:3100/ | grep -qi "licita" && pkill -f "next start"`

## Done when
- `/` renders real DB rows styled per WEB_STYLE with working pagination; migration 002 applied and populated.
- Unit tests: `lib/format.ts` (R$, datas pt-BR) and `lib/status.ts` boundaries.

## Not included
- No search/filters (ticket 08), no detail page (ticket 09), no auth, no dark mode, no mobile work.
