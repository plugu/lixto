---
id: 116
status: todo
model: opus
depends_on: []
max_attempts: 4
files:
  - web/lib/email/outbox.ts
  - web/lib/email/outbox.test.ts
  - src/lixto/status.py
  - tests/test_status.py
---
## Goal
No message can be lost or stranded: stuck `sending` rows are recovered, suppression can't be raced, the sent subject is recorded, and `sending` is visible in status.

## Context

Reviewer findings against the merged outbox:
1. **Stranded rows** — `claimBatch` (`outbox.ts:207`) only selects `status='queued'`; nothing ever returns a `sending` row (container kill, `maxDuration=300` cut-off, DB blip after claim). The sweep referenced in `sender.ts:333` and the index comment in `migrations/003_email.sql:34` does not exist. Add `requeueStale({ olderThanMinutes = 15, client? })`: rows `status='sending' AND updated_at < now() - interval` go back to `queued` (or to `failed` with `last_error='stale after N attempts'` once `attempts >= MAX_ATTEMPTS`); return the counts. Ticket 117 calls it at the top of the worker.
2. **Suppression race** — `enqueue` (`outbox.ts:176`) reads `email_suppressions` then inserts, non-atomically: an unsubscribe committing in between leaves a deliverable row. Make it one statement — `INSERT INTO email_messages (…) SELECT … WHERE NOT EXISTS (SELECT 1 FROM email_suppressions WHERE email = $1) ON CONFLICT (dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING RETURNING id` — and derive `skipped: "suppressed" | "duplicate"` from a follow-up check only when no row came back (keep the current return shape).
3. **Subject never stored** — `markSent` (`outbox.ts:232`) doesn't write `subject`, so the column added for exactly this is always NULL. Add an optional `subject` parameter: `markSent(id, messageId, subject?, client?)` — keep positional compatibility with ticket 117's call site in mind and state the final signature in your report.
4. **`sending` invisible** — `emailStats` (`outbox.ts:340`) and `_EMAIL_STATS_SQL` (`src/lixto/status.py:95`) omit `sending`, so a stranded queue looks empty. Add `sending` to both, and to the `email:` block in `format_status` (a line `sending: <n>` after `queued`). Update `tests/test_status.py` accordingly.

Tests (mocked `pool`): `requeueStale` SQL targets `sending` + the interval and flips exhausted rows to `failed`; `enqueue` emits a single INSERT…SELECT…WHERE NOT EXISTS with the ON CONFLICT predicate; `markSent` persists the subject when given; `emailStats` returns `sending`.

## Checks (run in order — cheapest first)
1. `cd web && npx next typegen && npm run lint && npx tsc --noEmit`
2. `uv run ruff check src tests && uv run ruff format --check src tests`
3. `cd web && npx vitest run lib/email/outbox.test.ts`
4. `uv run pytest tests/test_status.py -q`
5. `cd web && npm test && uv run pytest -q`

## Done when
- `requeueStale` recovers a 20-minute-old `sending` row; `enqueue` is a single statement that cannot insert for a suppressed address; `markSent` stores the subject; `lixto status` shows a `sending:` line.

## Not included
- Calling `requeueStale` from the worker or the send-time suppression check (ticket 117); digest keys (118).
