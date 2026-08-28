---
id: 101
status: doing
model: sonnet
depends_on: []
max_attempts: 3
files:
  - src/lixto/fence.py
  - src/lixto/sync/details.py
  - src/lixto/cli/backfill.py
  - tests/test_fence.py
  - tests/test_sync_details.py
  - tests/test_backfill.py
---
## Goal
An env-configured fence (portals × modalities × open/upcoming) limits which procurements get items/documents fetched, and `lixto backfill --days N` backfills the last N days.

## Context

Ingestion of the procurement *list* stays unfenced (all portals/modalities via `/atualizacao`). Only the expensive per-row work is fenced: details (4 PNCP requests/row) here, enrichment in ticket 102.

Create `src/lixto/fence.py`:
```python
@dataclass(frozen=True)
class Fence:
    portals: tuple[str, ...]      # origin_system values; empty = all
    modalities: tuple[int, ...]   # modality_id values; empty = all
    open_only: bool
    def is_active(self) -> bool
    def sql(self, alias: str = "procurements") -> tuple[str, dict]  # " AND (...)" fragment + params, "" when inactive
    def describe(self) -> str     # one line for status/logs
def get_fence() -> Fence          # env: LIXTO_FENCE_PORTALS (comma-separated, trimmed), LIXTO_FENCE_MODALITIES (comma-separated ints), LIXTO_FENCE_OPEN_ONLY ("1"/"true", default "1" when either list is set, else "0")
```
`sql()` uses psycopg named params `%(fence_portals)s` / `%(fence_modalities)s` (`= ANY(...)`) and the open predicate `({alias}.proposal_closes_at >= now() OR {alias}.proposal_opens_at > now())`. Portal comparison is exact on `origin_system` (values like `Compras.gov.br`, `ECustomize Consultoria em Software S.A`, `IPM Sistemas`).

`src/lixto/sync/details.py`: `_select_pending(conn, *, limit, offset, fence: Fence | None)` appends `fence.sql()` to `_SELECT_PENDING_SQL` (WHERE has `items_synced_at IS NULL OR documents_synced_at IS NULL` — wrap it in parentheses before appending `AND`). `sync_details(..., fence: Fence | None = None)`; when `None`, call `get_fence()`. The queue ordering is unchanged. Also select `origin_system`/`modality_id` are not needed — fence is pure SQL.

`src/lixto/cli/backfill.py`: add `--days N` option (mutually exclusive with `--since`; `since = today - N`). Default modalities stay all; the fence doesn't apply to the publication phase (list rows are cheap), only to the details drain it triggers (through `sync_details`).

Tests: `test_fence.py` (env parsing, inactive → empty sql, active → both predicates + params, open_only default); `test_sync_details.py` add: fence params reach `cur.execute`; `test_backfill.py` add: `--days 45` computes `since`.

## Checks (run in order — cheapest first)
1. `uv run ruff check src tests && uv run ruff format --check src tests`
2. `uv run pytest tests/test_fence.py tests/test_sync_details.py tests/test_backfill.py -q`
3. `uv run pytest -q`

## Done when
- With `LIXTO_FENCE_PORTALS="Compras.gov.br,ECustomize Consultoria em Software S.A,IPM Sistemas" LIXTO_FENCE_MODALITIES=6,8`, `sync_details` SQL contains `origin_system = ANY(%(fence_portals)s)`, `modality_id = ANY(%(fence_modalities)s)` and the open/upcoming predicate; unset → SQL identical to today.
- `lixto backfill --days 45 --until 2026-08-27` runs with `since=2026-07-13`.

## Not included
- Enrichment fence/cap (ticket 102 reuses `get_fence()`).
- Fencing the publication/list sync.
- Status output (ticket 105).
