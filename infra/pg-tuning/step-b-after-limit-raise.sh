#!/usr/bin/env bash
# Run ONLY after raising pg-shared limits in Dokploy (Advanced -> Resources: memory 6 GB, CPU 3).
# Writes restart-only settings; they take effect on the next pg-shared redeploy/restart
# (~15 s downtime for every database on pg-shared, Evolution included).
# work_mem stays 8MB: /dev/shm is 64 MB and parallel hash joins need work_mem x 2 x 3 procs.
set -euo pipefail
ssh -o ConnectTimeout=15 plugu-prod01 \
  'docker exec -i $(docker ps --format "{{.Names}}" | grep pg-shared | head -1) psql -U shared -d postgres -X -v ON_ERROR_STOP=1' <<'SQL'
ALTER SYSTEM SET shared_buffers = '1536MB';
ALTER SYSTEM SET effective_cache_size = '4GB';
SELECT name, setting, unit, pending_restart FROM pg_settings WHERE name IN ('shared_buffers','effective_cache_size');
SQL
echo "Now redeploy pg-shared in Dokploy (or: docker service update --force pg-shared-nyfajl)."
