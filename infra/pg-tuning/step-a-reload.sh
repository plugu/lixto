#!/usr/bin/env bash
# pg-shared planner settings that apply with a config reload (no restart, no downtime).
# Sized for the current 2 GB / 2 CPU container cap and 64 MB /dev/shm.
# Run from the laptop (Tailscale up):  bash infra/pg-tuning/step-a-reload.sh
set -euo pipefail
ssh -o ConnectTimeout=15 plugu-prod01 \
  'docker exec -i $(docker ps --format "{{.Names}}" | grep pg-shared | head -1) psql -U shared -d postgres -X -v ON_ERROR_STOP=1' <<'SQL'
ALTER SYSTEM SET random_page_cost = 1.1;
ALTER SYSTEM SET jit = off;
ALTER SYSTEM SET work_mem = '8MB';
ALTER SYSTEM SET effective_cache_size = '1536MB';
SELECT pg_reload_conf();
SELECT pg_sleep(1);
SELECT name, setting, unit, source, pending_restart
  FROM pg_settings
 WHERE name IN ('random_page_cost','jit','work_mem','effective_cache_size','shared_buffers')
 ORDER BY 1;
SQL
