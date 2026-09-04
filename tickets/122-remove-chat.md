---
id: 122
status: done
model: sonnet
depends_on: []
max_attempts: 3
files:
  - web/app/(app)/lixto/page.tsx
  - web/app/api/chat/route.ts
  - web/components/chat/chat.tsx
  - web/components/chat/composer.tsx
  - web/components/chat/message-list.tsx
  - web/components/chat/procurement-ref-card.tsx
  - web/components/chat/quick-filters.tsx
  - web/components/sidebar.tsx
  - web/lib/agent/run.ts
  - web/lib/agent/run.test.ts
  - web/lib/agent/tools.ts
  - web/lib/agent/tools.test.ts
  - web/lib/agent/conversation-queries.ts
  - web/lib/agent/conversation-queries.test.ts
  - web/lib/agent/types.ts
  - web/app/(app)/opportunities/actions.ts
  - web/app/(app)/signup/actions.ts
  - web/lib/email/callsites.test.ts
---
## Goal
Delete the chat feature: `/lixto` page, `/api/chat` route, chat components, and the chat-only modules of `lib/agent/` — with every dangling reference fixed.

## Context
Cycle 23 (PRODUCT.md): the chat interface is unused surface. Delete these entirely (git history is the archive):
- `web/app/(app)/lixto/` (whole directory), `web/app/api/chat/` (whole directory), `web/components/chat/` (whole directory)
- `web/lib/agent/run.ts`, `tools.ts`, `conversation-queries.ts`, `types.ts` + their `.test.ts` files

**KEEP** `web/lib/agent/embed.ts`, `embed.test.ts`, `llm.ts` — imported by procurements semantic search, `lib/recommend.ts`, and profile embedding. Do not move or rename them.

Dangling references to fix (the complete list — no discovery needed):
- `web/components/sidebar.tsx` line ~70: remove the `{ href: "/lixto", label: "Lixto", icon: Chart }` nav item (and the `Chart` icon import if now unused).
- `web/app/(app)/opportunities/actions.ts` line ~18: remove `revalidatePath("/lixto");`.
- `web/app/(app)/signup/actions.ts` line ~92: welcome email CTA `appUrl: `${APP_URL}/lixto`` → `${APP_URL}/dashboard`.
- `web/lib/email/callsites.test.ts` line ~304: expectation `expect.stringContaining("/lixto")` → `expect.stringContaining("/dashboard")`.

DB schema untouched: `conversations` / `conversation_messages` tables stay (ADR 001).

## Checks (run in order — cheapest first)
1. `cd web && npm run lint`
2. `cd web && npx next typegen && npx tsc --noEmit`
3. `cd web && npm test`
4. `cd web && npm run build`
5. `! grep -rn "agent/run\|agent/tools\|agent/types\|conversation-queries\|components/chat\|api/chat\|\"/lixto\"" web/app web/components web/lib --include="*.ts*" | grep -v node_modules`

## Done when
- `/lixto` and `/api/chat` no longer exist in the app tree; sidebar has no Lixto entry; welcome email links to `/dashboard`.
- Full web suite green with the deleted test files gone; `embed.ts`/`llm.ts` untouched and still imported by recommend/semantic search.

## Not included
- Docs / env-example cleanup (ticket 123).
- Dropping `conversations` tables, touching migrations, or removing `LIXTO_CHAT_MODEL` from the deployed Dokploy env.
- Moving `embed.ts`/`llm.ts` out of `lib/agent/`.
