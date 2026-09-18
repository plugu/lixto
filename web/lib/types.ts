// TS types mirroring the tenant tables of the lixto schema
// (migrations/001_core.sql — ADR 001 §D4: companies, company_cnaes, users,
// company_documents, sessions). Row types use the SQL column names verbatim;
// input types use camelCase because they come from form fields.

export type Role = "admin" | "member";

/** `companies.approval_status` CHECK values (migration 007, ADR 003 §D1).
 * Approval is a property of the tenant: every seat inherits it. */
export type ApprovalStatus = "pending" | "approved" | "rejected";

export const APPROVAL_STATUSES = [
  "pending",
  "approved",
  "rejected",
] as const;

export type CompanySize = "MEI" | "ME" | "EPP" | "MEDIUM" | "LARGE";

export const COMPANY_SIZES: CompanySize[] = [
  "MEI",
  "ME",
  "EPP",
  "MEDIUM",
  "LARGE",
];

/** `company_documents.kind` CHECK values (ADR 001 §D4). */
export type DocumentKind =
  | "articles_of_association"
  | "cnpj_card"
  | "federal_tax_clearance"
  | "fgts_clearance"
  | "labor_clearance"
  | "state_tax_clearance"
  | "municipal_tax_clearance"
  | "balance_sheet"
  | "technical_capacity_certificate"
  | "other";

// Labels stay Portuguese: identifiers are English, UI copy is not.
export const DOCUMENT_KINDS: { value: DocumentKind; label: string }[] = [
  { value: "articles_of_association", label: "Contrato social" },
  { value: "cnpj_card", label: "Cartão CNPJ" },
  { value: "federal_tax_clearance", label: "Certidão de regularidade federal" },
  { value: "fgts_clearance", label: "Certidão de regularidade do FGTS" },
  {
    value: "labor_clearance",
    label: "Certidão negativa de débitos trabalhistas",
  },
  { value: "state_tax_clearance", label: "Certidão de regularidade estadual" },
  {
    value: "municipal_tax_clearance",
    label: "Certidão de regularidade municipal",
  },
  { value: "balance_sheet", label: "Balanço patrimonial" },
  {
    value: "technical_capacity_certificate",
    label: "Atestado de capacidade técnica",
  },
  { value: "other", label: "Outros" },
];

export type Company = {
  id: number;
  tax_id: string;
  legal_name: string;
  trade_name: string | null;
  legal_nature: string | null;
  size: CompanySize | null;
  simples_optant: boolean;
  state_registration: string | null;
  municipal_registration: string | null;
  postal_code: string | null;
  street: string | null;
  street_number: string | null;
  address_line2: string | null;
  district: string | null;
  city_name: string | null;
  state: string | null;
  phone: string | null;
  email: string | null;
  created_at: Date;
  updated_at: Date;
};

export type CompanyCnae = {
  id: number;
  company_id: number;
  cnae_code: string;
  description: string;
  is_primary: boolean;
};

// Excludes password_hash — never surface the password hash outside auth code.
export type User = {
  id: number;
  company_id: number;
  email: string;
  name: string;
  cpf: string | null;
  phone: string | null;
  job_title: string | null;
  role: Role;
  invite_token_hash: string | null;
  invite_expires_at: Date | null;
  created_at: Date;
  updated_at: Date;
};

export type CompanyDocument = {
  id: number;
  company_id: number;
  kind: DocumentKind;
  file_name: string;
  storage_path: string;
  mime_type: string;
  size_bytes: number;
  valid_until: Date | null;
  uploaded_by: number | null;
  created_at: Date;
};

/** Tabs of the "Empresa" area, shared by every page under /company so the
 * four screens can't drift apart. Labels stay Portuguese. */
export const COMPANY_NAV: { href: string; label: string }[] = [
  { href: "/company", label: "Perfil" },
  { href: "/company/profile", label: "Match" },
  { href: "/company/users", label: "Usuários" },
  { href: "/company/documents", label: "Documentos" },
];

export const UF_LIST: string[] = [
  "AC",
  "AL",
  "AP",
  "AM",
  "BA",
  "CE",
  "DF",
  "ES",
  "GO",
  "MA",
  "MT",
  "MS",
  "MG",
  "PA",
  "PB",
  "PR",
  "PE",
  "PI",
  "RJ",
  "RN",
  "RS",
  "RO",
  "RR",
  "SC",
  "SP",
  "SE",
  "TO",
];
