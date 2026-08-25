// COMPAT SHIM (ticket 80) — the real queries now live in ./company-queries.ts
// against the lixto `companies`/`company_cnaes` tables. Legacy modules this
// ticket does not own (lib/agent/tools.ts, app/(app)/licitacoes/page.tsx)
// still import `getCnaes` and expect the Portuguese row shape.
// Ticket 82 replaces those callers and deletes this file.

import { getCompanyCnaes } from "./company-queries";

export type LegacyCnaeRow = {
  codigo: string;
  descricao: string;
  principal: boolean;
};

export async function getCnaes(companyId: number): Promise<LegacyCnaeRow[]> {
  const cnaes = await getCompanyCnaes(companyId);
  return cnaes.map((c) => ({
    codigo: c.cnae_code,
    descricao: c.description,
    principal: c.is_primary,
  }));
}
