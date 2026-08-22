// TS types mirroring the tenant schema (migrations/007_tenant.sql, ticket 23).
// Shared by every later cycle-7 ticket (auth, queries, pages) — keep field
// names and shapes in lockstep with the SQL.

export type Porte = "MEI" | "ME" | "EPP" | "MEDIO" | "GRANDE";

export const PORTES: Porte[] = ["MEI", "ME", "EPP", "MEDIO", "GRANDE"];

export type Role = "admin" | "member";

export type DocumentoTipo =
  | "contrato_social"
  | "cartao_cnpj"
  | "certidao_federal"
  | "certidao_fgts"
  | "certidao_trabalhista"
  | "certidao_estadual"
  | "certidao_municipal"
  | "balanco_patrimonial"
  | "atestado_capacidade_tecnica"
  | "outros";

export const DOCUMENTO_TIPOS: { value: DocumentoTipo; label: string }[] = [
  { value: "contrato_social", label: "Contrato social" },
  { value: "cartao_cnpj", label: "Cartão CNPJ" },
  { value: "certidao_federal", label: "Certidão de regularidade federal" },
  { value: "certidao_fgts", label: "Certidão de regularidade do FGTS" },
  {
    value: "certidao_trabalhista",
    label: "Certidão negativa de débitos trabalhistas",
  },
  { value: "certidao_estadual", label: "Certidão de regularidade estadual" },
  {
    value: "certidao_municipal",
    label: "Certidão de regularidade municipal",
  },
  { value: "balanco_patrimonial", label: "Balanço patrimonial" },
  {
    value: "atestado_capacidade_tecnica",
    label: "Atestado de capacidade técnica",
  },
  { value: "outros", label: "Outros" },
];

export type Empresa = {
  id: number;
  cnpj: string;
  razao_social: string;
  nome_fantasia: string | null;
  natureza_juridica: string | null;
  porte: Porte | null;
  optante_simples: boolean;
  inscricao_estadual: string | null;
  inscricao_municipal: string | null;
  cep: string | null;
  logradouro: string | null;
  numero: string | null;
  complemento: string | null;
  bairro: string | null;
  municipio: string | null;
  uf: string | null;
  telefone: string | null;
  email: string | null;
  created_at: Date;
  updated_at: Date;
};

export type EmpresaCnae = {
  id: number;
  empresa_id: number;
  codigo: string;
  descricao: string;
  principal: boolean;
};

// Excludes senha_hash — never surface the password hash outside auth code.
export type Usuario = {
  id: number;
  empresa_id: number;
  email: string;
  nome: string;
  cpf: string | null;
  telefone: string | null;
  cargo: string | null;
  role: Role;
  convite_token_hash: string | null;
  convite_expira_em: Date | null;
  created_at: Date;
  updated_at: Date;
};

export type DocumentoEmpresa = {
  id: number;
  empresa_id: number;
  tipo: DocumentoTipo;
  nome_arquivo: string;
  caminho: string;
  mime: string;
  tamanho_bytes: number;
  validade: Date | null;
  enviado_por: number | null;
  created_at: Date;
};

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
