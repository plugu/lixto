#!/usr/bin/env bash
# Revert every setting written by step A / step B to Postgres defaults.
# shared_buffers only reverts after a restart.
set -euo pipefail
ssh -o ConnectTimeout=15 plugu-prod01 \
  'docker exec -i $(docker ps --format "{{.Names}}" | grep pg-shared | head -1) psql -U shared -d postgres -X -v ON_ERROR_STOP=1' <<'SQL'
ALTER SYSTEM RESET random_page_cost;
ALTER SYSTEM RESET jit;
ALTER SYSTEM RESET work_mem;
ALTER SYSTEM RESET effective_cache_size;
ALTER SYSTEM RESET shared_buffers;
SELECT pg_reload_conf();
SQL
