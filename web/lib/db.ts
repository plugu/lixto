import { Pool } from "pg";

// Same default as src/plic/settings.py's DEFAULT_DATABASE_URL.
const DEFAULT_DATABASE_URL = "postgresql://plic:plic@localhost:5433/plic";

function createPool(): Pool {
  return new Pool({
    connectionString: process.env.PLIC_DATABASE_URL ?? DEFAULT_DATABASE_URL,
  });
}

// Reuse a single pool across hot reloads in dev so we don't leak connections.
declare global {
  var __plicPool: Pool | undefined;
}

export const pool: Pool = globalThis.__plicPool ?? createPool();

if (process.env.NODE_ENV !== "production") {
  globalThis.__plicPool = pool;
}
