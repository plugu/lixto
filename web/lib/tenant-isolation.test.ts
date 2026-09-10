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
import {
  buildPruneRadarMatchesQuery,
  buildRadarCandidateQuery,
  buildUpsertRadarMatchesQuery,
  type RadarProfile,
} from "./radar-match-queries";
import { buildClearRadarAction, buildSetRadarAction } from "./radar-detail-queries";
import {
  buildDeleteRecentFeedback,
  buildRestoreOpportunityState,
} from "./opportunity-queries";

// Not registered here: `buildCommandSearchQuery` (lib/command-search-queries.ts,
// the ⌘K palette). Procurements are public, globally-ingested data, so that
// builder takes no `company_id` and has no tenant boundary to assert — its
// shape is covered by lib/command-search-queries.test.ts instead.

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

  it("buildRadarCandidateQuery binds company_id as $1", () => {
    const profile: RadarProfile = {
      terms: ["lapis"],
      exclusion_terms: [],
      states: [],
      min_value: null,
      max_value: null,
      size: "ME",
      embedding: null,
    };
    const { text, values } = buildRadarCandidateQuery(COMPANY_ID, profile);

    expect(text).toContain("$1::bigint AS company_id");
    expect(values[0]).toBe(COMPANY_ID);
  });

  it("buildUpsertRadarMatchesQuery binds company_id as $1", () => {
    const { text, values } = buildUpsertRadarMatchesQuery(COMPANY_ID, [
      { id: 7, score: 80, reasons: [{ code: "term_text", weight: 40, detail: "x" }] },
    ]);

    expect(text).toContain("INSERT INTO future_opportunity_matches");
    expect(text).toContain("($1,");
    expect(values[0]).toBe(COMPANY_ID);
  });

  it("buildPruneRadarMatchesQuery binds company_id as $1", () => {
    const { text, values } = buildPruneRadarMatchesQuery(COMPANY_ID, [7, 8]);

    expect(text).toContain("m.company_id = $1");
    expect(values[0]).toBe(COMPANY_ID);
    expect(values[1]).toEqual([7, 8]);
  });

  it("buildSetRadarAction verifies ownership and binds company_id as $1", () => {
    const { text, values } = buildSetRadarAction(COMPANY_ID, 171, USER_ID, "saved");

    expect(text).toContain("m.company_id = $1");
    expect(text).toContain("WHERE fo.id = $2");
    expect(values[0]).toBe(COMPANY_ID);
  });

  it("buildClearRadarAction binds company_id as $1", () => {
    const { text, values } = buildClearRadarAction(COMPANY_ID, 171);

    expect(/company_id\s*=\s*\$\d/.test(text)).toBe(true);
    expect(values[0]).toBe(COMPANY_ID);
  });

  it("buildRestoreOpportunityState binds company_id and guards on dismissed", () => {
    const { text, values } = buildRestoreOpportunityState(COMPANY_ID, 9, "matched");

    expect(text).toContain("WHERE id = $2 AND company_id = $1 AND state = 'dismissed'");
    expect(values).toEqual([COMPANY_ID, 9, "matched"]);
  });

  it("buildDeleteRecentFeedback binds company_id via the opportunities join", () => {
    const { text, values } = buildDeleteRecentFeedback(COMPANY_ID, 9, USER_ID, "rejected");

    expect(text).toContain("USING opportunities o");
    expect(/o\.company_id\s*=\s*\$1/.test(text)).toBe(true);
    expect(values).toEqual([COMPANY_ID, 9, USER_ID, "rejected"]);
  });
});
