import { Pool } from "pg";

// Same default as src/lixto/settings.py's DEFAULT_DATABASE_URL.
const DEFAULT_DATABASE_URL = "postgresql://lixto:lixto@localhost:5433/lixto";

const DEFAULT_POOL_MAX = 10;
const DEFAULT_STATEMENT_TIMEOUT_MS = 60_000;

/** Parses a positive integer from env, falling back to `fallback` for
 * anything non-finite or <= 0 — never throws at import time. */
function envInt(name: string, fallback: number): number {
  const parsed = Number(process.env[name]);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function createPool(): Pool {
  return new Pool({
    connectionString: process.env.LIXTO_DATABASE_URL ?? DEFAULT_DATABASE_URL,
    max: envInt("LIXTO_PG_POOL_MAX", DEFAULT_POOL_MAX),
    statement_timeout: envInt(
      "LIXTO_PG_STATEMENT_TIMEOUT_MS",
      DEFAULT_STATEMENT_TIMEOUT_MS,
    ),
    application_name: "lixto-web",
  });
}

// Reuse a single pool across hot reloads in dev so we don't leak connections.
declare global {
  var __lixtoPool: Pool | undefined;
}

export const pool: Pool = globalThis.__lixtoPool ?? createPool();

if (process.env.NODE_ENV !== "production") {
  globalThis.__lixtoPool = pool;
}
