// Signup transaction: creates a company, its CNAEs and the first admin user
// atomically. Query builders are exported separately so the SQL shape is
// unit-testable without a DB.
//
// Relative imports on purpose: vitest runs without a config file, so the
// tsconfig "@/" alias is not resolvable in signup-queries.test.ts.
import { onlyDigits } from "./br-validators";
import { normalizeCnaeCode } from "./company-queries";
import { pool } from "./db";
import type { CompanySize } from "./types";

export type SqlQuery = {
  text: string;
  values: unknown[];
};

export type SignupCnae = {
  code: string;
  description: string;
  isPrimary: boolean;
};

export type SignupCompanyInput = {
  taxId: string;
  legalName: string;
  tradeName: string | null;
  legalNature: string | null;
  size: CompanySize | null;
  simplesOptant: boolean;
  stateRegistration: string | null;
  municipalRegistration: string | null;
  postalCode: string | null;
  street: string | null;
  streetNumber: string | null;
  addressLine2: string | null;
  district: string | null;
  cityName: string | null;
  state: string | null;
  phone: string | null;
  email: string | null;
};

export type SignupUserInput = {
  name: string;
  email: string;
  passwordHash: string;
  cpf: string | null;
  phone: string | null;
  jobTitle: string | null;
};

export type SignupInput = {
  company: SignupCompanyInput;
  cnaes: SignupCnae[];
  user: SignupUserInput;
};

export type SignupResult = {
  companyId: number;
  userId: number;
};

/** Builds the company INSERT. All string identifiers (tax_id, postal_code)
 * are normalized to digits-only before binding. */
export function buildInsertCompany(input: SignupCompanyInput): SqlQuery {
  return {
    text: `INSERT INTO companies (
        tax_id, legal_name, trade_name, legal_nature, size,
        simples_optant, state_registration, municipal_registration,
        postal_code, street, street_number, address_line2, district,
        city_name, state, phone, email
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
      RETURNING id`,
    values: [
      onlyDigits(input.taxId),
      input.legalName,
      input.tradeName,
      input.legalNature,
      input.size,
      input.simplesOptant,
      input.stateRegistration,
      input.municipalRegistration,
      input.postalCode ? onlyDigits(input.postalCode) : null,
      input.street,
      input.streetNumber,
      input.addressLine2,
      input.district,
      input.cityName,
      input.state,
      input.phone,
      input.email ? input.email.trim().toLowerCase() : null,
    ],
  };
}

/** Builds a single multi-row CNAE INSERT for the given company. Values are
 * flattened in row order (cnae_code, description, is_primary) x N. */
export function buildInsertCnaes(
  companyId: number,
  cnaes: SignupCnae[],
): SqlQuery {
  const values: unknown[] = [companyId];
  const rows = cnaes.map((cnae, i) => {
    const base = 1 + i * 3;
    values.push(
      normalizeCnaeCode(cnae.code),
      cnae.description,
      cnae.isPrimary,
    );
    return `($1, $${base + 1}, $${base + 2}, $${base + 3})`;
  });

  return {
    text: `INSERT INTO company_cnaes (company_id, cnae_code, description, is_primary)
      VALUES ${rows.join(", ")}`,
    values,
  };
}

/** Builds the admin user INSERT for the company created above. Email is
 * lowercased to match the unique index / login lookup convention. */
export function buildInsertUser(
  companyId: number,
  input: SignupUserInput,
): SqlQuery {
  return {
    text: `INSERT INTO users (
        company_id, email, password_hash, name, cpf, phone, job_title, role
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'admin')
      RETURNING id`,
    values: [
      companyId,
      input.email.trim().toLowerCase(),
      input.passwordHash,
      input.name,
      input.cpf ? onlyDigits(input.cpf) : null,
      input.phone,
      input.jobTitle,
    ],
  };
}

/** Creates the company + CNAEs + first admin user in a single transaction.
 * Rolls back on any error (e.g. unique violation on companies.tax_id or
 * users.email — surfaced to the caller as a pg error with code 23505). */
export async function createCompanyWithAdmin(
  input: SignupInput,
): Promise<SignupResult> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const companyQuery = buildInsertCompany(input.company);
    const companyResult = await client.query<{ id: string }>(
      companyQuery.text,
      companyQuery.values,
    );
    const companyId = Number(companyResult.rows[0].id);

    if (input.cnaes.length > 0) {
      const cnaesQuery = buildInsertCnaes(companyId, input.cnaes);
      await client.query(cnaesQuery.text, cnaesQuery.values);
    }

    const userQuery = buildInsertUser(companyId, input.user);
    const userResult = await client.query<{ id: string }>(
      userQuery.text,
      userQuery.values,
    );
    const userId = Number(userResult.rows[0].id);

    await client.query("COMMIT");
    return { companyId, userId };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}
