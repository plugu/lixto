import { describe, it, expect } from "vitest";

// Relative imports (not "@/lib/...") on purpose: vitest runs without a config file
import {
  buildUpdateCompany,
  buildInsertCnaes,
  type CompanyInput,
  type CnaeInput,
} from "./company-queries";
import {
  buildListUsers,
  buildUpdateRole,
  buildRemoveUser,
} from "./user-queries";
import {
  buildListDocuments,
  buildGetDocument,
  buildDeleteDocument,
  buildInsertDocument,
  type NewDocument,
} from "./document-queries";

const COMPANY_ID = 42;
const USER_ID = 1;
const DOC_ID = 7;

describe("Tenant isolation - all builders bind company_id", () => {
  it("buildUpdateCompany binds company_id as $1", () => {
    const input: CompanyInput = {
      legalName: "Test Company",
      tradeName: "Test",
      legalNature: "Test",
      size: "ME",
      simplesOptant: false,
      stateRegistration: "123456789",
      municipalRegistration: "987654321",
      postalCode: "01310100",
      street: "Rua Test",
      streetNumber: "123",
      addressLine2: "",
      district: "Centro",
      cityName: "São Paulo",
      state: "SP",
      phone: "1133334444",
      email: "test@example.com",
    };
    const { text, values } = buildUpdateCompany(COMPANY_ID, input);

    // buildUpdateCompany uses WHERE id = $1 (companyId is companies.id)
    expect(text).toContain("WHERE id = $1");
    expect(values[0]).toBe(COMPANY_ID);
  });

  it("buildInsertCnaes binds company_id as $1 in column list", () => {
    const cnaes: CnaeInput[] = [
      { code: "6201501", description: "Consultoria", isPrimary: true },
    ];
    const { text, values } = buildInsertCnaes(COMPANY_ID, cnaes);

    // INSERT uses column list: (company_id, ...)
    expect(text).toContain("company_id");
    expect(values[0]).toBe(COMPANY_ID);
  });

  it("buildListUsers binds company_id", () => {
    const { text, values } = buildListUsers(COMPANY_ID);

    expect(/company_id\s*=\s*\$\d/.test(text)).toBe(true);
    expect(values).toContain(COMPANY_ID);
  });

  it("buildUpdateRole binds company_id", () => {
    const { text, values } = buildUpdateRole(COMPANY_ID, USER_ID, "member");

    expect(/company_id\s*=\s*\$\d/.test(text)).toBe(true);
    expect(values).toContain(COMPANY_ID);
  });

  it("buildRemoveUser binds company_id", () => {
    const { text, values } = buildRemoveUser(COMPANY_ID, USER_ID);

    expect(/company_id\s*=\s*\$\d/.test(text)).toBe(true);
    expect(values).toContain(COMPANY_ID);
  });

  it("buildListDocuments binds company_id", () => {
    const { text, values } = buildListDocuments(COMPANY_ID);

    expect(/company_id\s*=\s*\$\d/.test(text)).toBe(true);
    expect(values).toContain(COMPANY_ID);
  });

  it("buildGetDocument binds both id and company_id", () => {
    const { text, values } = buildGetDocument(COMPANY_ID, DOC_ID);

    expect(/id\s*=\s*\$/.test(text)).toBe(true);
    expect(/company_id\s*=\s*\$\d/.test(text)).toBe(true);
    expect(values).toContain(COMPANY_ID);
    expect(values).toContain(DOC_ID);
  });

  it("buildDeleteDocument binds company_id", () => {
    const { text, values } = buildDeleteDocument(COMPANY_ID, DOC_ID);

    expect(/company_id\s*=\s*\$\d/.test(text)).toBe(true);
    expect(values).toContain(COMPANY_ID);
  });

  it("buildInsertDocument binds company_id as $1 in column list", () => {
    const doc: NewDocument = {
      kind: "articles_of_association",
      fileName: "contrato.pdf",
      storagePath: "42/uuid.pdf",
      mimeType: "application/pdf",
      sizeBytes: 1024,
      validUntil: "2026-12-31",
    };
    const { text, values } = buildInsertDocument(COMPANY_ID, USER_ID, doc);

    // INSERT uses column list: (company_id, ...)
    expect(text).toContain("company_id");
    expect(values[0]).toBe(COMPANY_ID);
  });
});
