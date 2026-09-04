---
mode: mvp
routing_profile: cloud
parallel_default: sequential
---

# Lixto — remove the chat interface and the "Lixto" nav entry (cycle 23)

## What / why
The `/lixto` chat page and its agent loop shipped in cycle 18 and have not earned their keep: the dashboard, procurements list with filters/semantic search, opportunities and digest cover the real workflows, and the chat is unused surface that still costs LLM budget risk, auth surface, and maintenance on every cycle. Remove it entirely — git history is the archive if it ever comes back.

**Delete** (chat-only, verified no other consumers):
- `web/app/(app)/lixto/` (page) and the `/lixto` sidebar entry (`components/sidebar.tsx`)
- `web/app/api/chat/route.ts`
- `web/components/chat/` (chat, composer, message-list, procurement-ref-card, quick-filters)
- `web/lib/agent/run.ts`, `tools.ts`, `conversation-queries.ts`, chat-specific `types.ts`, and their tests
- `LIXTO_CHAT_MODEL` from `.env.example` files, README, CLAUDE.md, docs (ARCHITECTURE/VISION note the removal)

**Keep** (shared infrastructure that merely lives in `lib/agent/`):
- `web/lib/agent/embed.ts` and `llm.ts` — used by procurements semantic search, company profile embedding, and `lib/recommend.ts`. If keeping them under `lib/agent/` reads wrong once the agent is gone, moving them is allowed but not required.
- Database schema untouched: `conversations` / `conversation_messages` tables stay (ADR 001 — cycle-18 tables are never altered); they simply gain no new rows.

## Primary user story
As a Lixto user, I no longer see a dead "Lixto" chat entry in the navigation, and the app I do use (dashboard, procurements, opportunities) builds, tests, and deploys without 1,500+ lines of unused chat code behind it.

## Out of scope
- Dropping or migrating the `conversations` tables
- Removing `embed.ts` / `llm.ts` or any semantic-search/recommendation code
- Redesigning the sidebar/navigation beyond deleting the one entry
- Removing `LIXTO_CHAT_MODEL` from the deployed Dokploy env (ops cleanup, one-line, done at deploy time)
- Any replacement feature ("ask about this procurement" buttons etc.)

## Success demo
Done when I can log in, see no "Lixto" nav entry, get a 404 on `/lixto` and `/api/chat`, and `tsc + vitest + next build` pass with `components/chat/` and the chat modules of `lib/agent/` gone — while semantic search on `/procurements` still works.
