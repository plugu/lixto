---
id: 123
status: done
model: haiku
depends_on: []
max_attempts: 3
files:
  - .env.example
  - web/.env.example
  - README.md
  - CLAUDE.md
  - docs/ARCHITECTURE.md
  - docs/VISION.md
---
## Goal
Remove every documentation and env-example trace of the chat interface and `LIXTO_CHAT_MODEL`.

## Context
Cycle 23 (PRODUCT.md): the `/lixto` chat page, `/api/chat` route, and chat agent modules are deleted in ticket 122. Clean the paper trail:
- `.env.example` and `web/.env.example`: delete the `LIXTO_CHAT_MODEL` line (and any comment that exists only for it).
- `README.md`: remove `LIXTO_CHAT_MODEL` from the env table and any chat-feature mention.
- `CLAUDE.md`: remove the `LIXTO_CHAT_MODEL` env-table row and the "Chat API" row in Key Code Locations; scan for other chat mentions.
- `docs/ARCHITECTURE.md`: remove/rewrite the chat/agent-loop section; keep everything about embeddings, semantic search, and `LIXTO_RECOMMEND_MODEL` (those stay).
- `docs/VISION.md`: add a one-line note under the current cycle that the chat interface was removed in cycle 23 (unused); do not rewrite history elsewhere.

Do NOT touch `LIXTO_RECOMMEND_MODEL`, embeddings, or semantic-search documentation — that machinery stays.

## Checks (run in order — cheapest first)
1. `! grep -rn "LIXTO_CHAT_MODEL" README.md CLAUDE.md .env.example web/.env.example docs/`
2. `! grep -rni "chat" CLAUDE.md | grep -v -i "história\|conversa"`
3. `grep -c "LIXTO_RECOMMEND_MODEL" CLAUDE.md`

## Done when
- No `LIXTO_CHAT_MODEL` or chat-interface references remain in docs/env examples; recommend/embed docs intact.

## Not included
- Code changes (ticket 122).
- Ticket files under `tickets/` (historical record, leave as-is).
- graphify-out/ (regenerated, not hand-edited).
