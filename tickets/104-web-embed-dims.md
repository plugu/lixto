---
id: 104
status: doing
model: haiku
depends_on: []
max_attempts: 3
files:
  - web/lib/agent/embed.ts
  - web/lib/agent/embed.test.ts
---
## Goal
Web-side embeddings request 1536 dimensions explicitly so Gemini's `gemini-embedding-001` (default 3072) matches `vector(1536)`.

## Context

`web/lib/agent/embed.ts` `embedText` calls `client.embeddings.create({ model, input })` and already rejects vectors whose length != `EMBED_DIMS` (1536). Add `dimensions: EMBED_DIMS` to the request. Chat and recommend clients need no code change (provider/model are env: `LIXTO_LLM_BASE_URL`, `LIXTO_CHAT_MODEL`, `LIXTO_RECOMMEND_MODEL`).

Test (`embed.test.ts`, injected-client pattern in the `embedText` describe): the mocked `embeddings.create` is called with `dimensions: 1536`.

## Checks (run in order — cheapest first)
1. `cd web && npm run lint`
2. `cd web && npx tsc --noEmit`
3. `cd web && npx vitest run lib/agent/embed.test.ts`
4. `cd web && npm test`

## Done when
- `embedText("x", { client })` invokes `client.embeddings.create` with `{ model, input: "x", dimensions: 1536 }`.

## Not included
- Cross-provider fallback on the web side.
- Any model default changes in `llm.ts` / `recommend.ts`.
