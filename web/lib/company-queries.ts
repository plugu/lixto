// Queries for the /company profile page. Every function takes `companyId`
// explicitly and callers must always source it from the session (never from a
// form field or URL param) — the tenant golden rule (docs/TENANT.md).
//
// Relative imports (not "@/lib/...") on purpose: vitest runs without a config
// file, so the tsconfig "@/" alias is not resolvable in the .test.ts files.

import { pool } from "./db";
import { onlyDigits } from "./br-validators";
import type { Company, CompanyCnae, CompanySize } from "./types";

export type CompanyInput = {
  legalName: string;
  tradeName: string;
  legalNature: string;
  size: string;
  simplesOptant: boolean;
  stateRegistration: string;
  municipalRegistration: string;
  postalCode: string;
  street: string;
  streetNumber: string;
  addressLine2: string;
  district: string;
  cityName: string;
  state: string;
  phone: string;
  email: string;
};

export type CnaeInput = {
  code: string;
  description: string;
  isPrimary: boolean;
};

export type SqlQuery = {
  text: string;
  values: unknown[];
};

/** Empty string → null (most company fields are optional). */
function nullIfEmpty(value: string): string | null {
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

function normalizeSize(value: string): CompanySize | null {
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : (trimmed as CompanySize);
}

export async function getCompany(companyId: number): Promise<Company | null> {
  const { rows } = await pool.query<Company>(
    `SELECT id, tax_id, legal_name, trade_name, legal_nature, size,
            simples_optant, state_registration, municipal_registration,
            postal_code, street, street_number, address_line2, district,
            city_name, state, phone, email, created_at, updated_at
       FROM companies
      WHERE id = $1`,
    [companyId],
  );
  return rows[0] ?? null;
}

export async function getCompanyCnaes(
  companyId: number,
): Promise<CompanyCnae[]> {
  const { rows } = await pool.query<CompanyCnae>(
    `SELECT id, company_id, cnae_code, description, is_primary
       FROM company_cnaes
      WHERE company_id = $1
      ORDER BY is_primary DESC, cnae_code ASC`,
    [companyId],
  );
  return rows;
}

/** Builds the company UPDATE. `companyId` is always $1. */
export function buildUpdateCompany(
  companyId: number,
  input: CompanyInput,
): SqlQuery {
  const text = `
    UPDATE companies
       SET legal_name = $2,
           trade_name = $3,
           legal_nature = $4,
           size = $5,
           simples_optant = $6,
           state_registration = $7,
           municipal_registration = $8,
           postal_code = $9,
           street = $10,
           street_number = $11,
           address_line2 = $12,
           district = $13,
           city_name = $14,
           state = $15,
           phone = $16,
           email = $17,
           updated_at = now()
     WHERE id = $1
  `;
  const values = [
    companyId,
    input.legalName.trim(),
    nullIfEmpty(input.tradeName),
    nullIfEmpty(input.legalNature),
    normalizeSize(input.size),
    input.simplesOptant,
    nullIfEmpty(input.stateRegistration),
    nullIfEmpty(input.municipalRegistration),
    input.postalCode.trim() === "" ? null : onlyDigits(input.postalCode),
    nullIfEmpty(input.street),
    nullIfEmpty(input.streetNumber),
    nullIfEmpty(input.addressLine2),
    nullIfEmpty(input.district),
    nullIfEmpty(input.cityName),
    input.state.trim() === "" ? null : input.state.trim().toUpperCase(),
    nullIfEmpty(input.phone),
    nullIfEmpty(input.email),
  ];
  return { text, values };
}

export async function updateCompany(
  companyId: number,
  input: CompanyInput,
): Promise<void> {
  const { text, values } = buildUpdateCompany(companyId, input);
  await pool.query(text, values);
}

/** Throws when the CNAE list has zero or more than one primary. */
export function validateCnaes(cnaes: CnaeInput[]): void {
  const primaryCount = cnaes.filter((c) => c.isPrimary).length;
  if (primaryCount !== 1) {
    throw new Error("Selecione exatamente um CNAE principal.");
  }
}

/** Builds the multi-row CNAE insert. `companyId` is always $1. Assumes
 * `cnaes` is non-empty — callers should skip the insert (after the delete)
 * when the list is empty. */
export function buildInsertCnaes(
  companyId: number,
  cnaes: CnaeInput[],
): SqlQuery {
  const values: unknown[] = [companyId];
  const rows = cnaes.map((c) => {
    const codeIdx = values.push(onlyDigits(c.code));
    const descriptionIdx = values.push(c.description.trim());
    const isPrimaryIdx = values.push(c.isPrimary);
    return `($1, $${codeIdx}, $${descriptionIdx}, $${isPrimaryIdx})`;
  });
  const text = `
    INSERT INTO company_cnaes (company_id, cnae_code, description, is_primary)
    VALUES ${rows.join(", ")}
  `;
  return { text, values };
}

/** Replaces the company's CNAE list inside a transaction: delete all, then
 * insert the given rows (validated to have exactly one primary). */
export async function replaceCnaes(
  companyId: number,
  cnaes: CnaeInput[],
): Promise<void> {
  validateCnaes(cnaes);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(`DELETE FROM company_cnaes WHERE company_id = $1`, [
      companyId,
    ]);
    const { text, values } = buildInsertCnaes(companyId, cnaes);
    await client.query(text, values);
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}
