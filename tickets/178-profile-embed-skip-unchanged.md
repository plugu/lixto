---
id: 178
status: done
model: sonnet
depends_on: []
max_attempts: 3
files:
  - web/app/(app)/company/profile/actions.ts
  - web/app/(app)/company/profile/actions.test.ts
---
## Goal
Saving the company profile calls the embeddings API only when the embedding text actually changed.

## Context
`web/app/(app)/company/profile/actions.ts:72-79`: builds `text = buildProfileEmbeddingText({products, keywords, notes})` and calls `embedText(text)` unconditionally, then `upsertProfile(companyId, input, embedding ? {...embedding, text} : null)`. `upsertProfile` (`web/lib/profile-queries.ts:130-165`) leaves the `embedding`, `embedding_text`, `embedding_model` columns untouched when the third argument is null — the previous vector is kept. `getProfile(companyId)` (`profile-queries.ts:~55-70`) returns `embedding_text` (the text the stored vector was built from, null when none). The action already imports `requireAdmin` (`@/lib/auth`), `buildProfileEmbeddingText`/`embedText` (`@/lib/agent/embed`) and `revalidatePath`. There is no test file for this action yet; server-action tests in this repo mock the lib modules with `vi.mock` and relative paths (see `web/app/api/internal/cases/run/route.test.ts` for the style).

### Work
1. In the action, before embedding: `const current = await getProfile(session.user.companyId)`; if `text` is non-empty and `current?.embedding_text === text`, skip `embedText` and pass `null` to `upsertProfile` (previous vector kept). Otherwise behave exactly as today (including the "similaridade semântica indisponível" warning when the provider fails). Add a short comment: identical text ⇒ identical vector for a pinned model, so the call is pure waste.
2. `actions.test.ts` (new): mock `@/lib/auth` (or relative equivalent) `requireAdmin` → a session with `companyId: 7`; mock `@/lib/profile-queries` `getProfile`/`upsertProfile`; mock `@/lib/agent/embed` `embedText` (keep the real `buildProfileEmbeddingText`); mock `next/cache` `revalidatePath`. Cases: (a) unchanged text → `embedText` not called, `upsertProfile` third arg `null`; (b) changed text → `embedText` called once, embedding forwarded with `text`; (c) empty text → `embedText` not called (existing behaviour). If the action's form-parsing helpers make a `FormData` fixture necessary, build the minimal one in the test.

## Checks (run in order — cheapest first)
1. `cd web && npm run lint`
2. `cd web && npx tsc --noEmit`
3. `cd web && npx vitest run "app/(app)/company/profile/actions.test.ts"`

## Done when
- All checks green; an unchanged profile save issues no embeddings request; a changed one still re-embeds.

## Not included
- Text-hash columns; changing `buildProfileEmbeddingText`; re-embedding on model change; any `profile-queries.ts` change.
