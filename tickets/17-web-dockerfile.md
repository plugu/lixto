---
id: 17
status: done
model: sonnet
depends_on: []
max_attempts: 3
files:
  - web/Dockerfile
  - web/.dockerignore
  - web/next.config.ts
---
## Goal
`web/` builds into a production Docker image that serves the Next.js app on `$PORT` (default 3000) as a non-root user and reads `PLIC_DATABASE_URL` at runtime.

## Context
Stack: Next.js 16.3 + React 19 + `pg`, TypeScript, Tailwind v4. `npm start` = `next start`. `web/package-lock.json` exists (verify; if missing run `npm install --package-lock-only` and include it in `files`). `web/lib/db.ts` reads `process.env.PLIC_DATABASE_URL` lazily at request time — no DB needed at build time, but Next may try to prerender; pages are dynamic (query-param driven) so build works offline. If `next build` fails trying to connect to Postgres, set `export const dynamic = "force-dynamic"` on the offending page — but prefer not touching pages; report if you had to.

Use Next.js standalone output to keep the image small:
- `web/next.config.ts`: add `output: "standalone"`.
- Multi-stage Dockerfile based on `node:22-alpine`:
  1. `deps`: `COPY package*.json ./` → `npm ci`.
  2. `builder`: copy deps `node_modules`, `COPY . .`, `ENV NEXT_TELEMETRY_DISABLED=1`, `RUN npm run build`.
  3. `runner`: `ENV NODE_ENV=production HOSTNAME=0.0.0.0`, copy `.next/standalone` → `/app`, `.next/static` → `/app/.next/static`, `public` → `/app/public` (all `--chown=node:node`), `USER node`, `EXPOSE 3000`, `CMD ["sh","-c","PORT=${PORT:-3000} node server.js"]`.
- `web/.dockerignore`: `node_modules`, `.next`, `.git`, `.env*`, `*.test.ts`, `AGENTS.md`, `CLAUDE.md`.

Reference pattern: `~/.claude/skills/deploying-plugu-projects/dockerfile-patterns.md` §"Node (Next.js / build step required)" — adapted to standalone output.

Local Postgres for the runtime check is on the host at `localhost:5433` (docker-compose `db`); from inside the container use `host.docker.internal:5433`.

## Checks (run in order — cheapest first)
1. `cd web && npx tsc --noEmit`
2. `cd web && docker build -t plic-web:local .`
3. `docker run -d --rm --name plic-web-check -p 3200:3000 -e PLIC_DATABASE_URL=postgresql://plic:plic@host.docker.internal:5433/plic plic-web:local && sleep 4 && curl -sf localhost:3200/licitacoes | grep -q "page-wide"; rc=$?; docker rm -f plic-web-check >/dev/null; exit $rc`
4. `docker run --rm plic-web:local id -u | grep -qv '^0$'`

## Done when
- Image builds from `web/` alone; container serves `/licitacoes` with real data on the mapped port; runs as non-root.

## Not included
- No root-level Dockerfile, no compose changes, no CI files, no Dokploy calls. Do not change `web/lib/db.ts` or any page unless `next build` forces it (then report).
