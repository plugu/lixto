import { Pool } from "pg";

// Same default as src/lixto/settings.py's DEFAULT_DATABASE_URL.
const DEFAULT_DATABASE_URL = "postgresql://lixto:lixto@localhost:5433/lixto";

function createPool(): Pool {
  return new Pool({
    connectionString: process.env.LIXTO_DATABASE_URL ?? DEFAULT_DATABASE_URL,
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
