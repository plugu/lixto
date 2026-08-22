---
id: 23
status: todo
model: sonnet
depends_on: []
max_attempts: 3
files:
  - migrations/007_tenant.sql
  - web/lib/br-validators.ts
  - web/lib/br-validators.test.ts
  - web/lib/tenant-types.ts
---
## Goal
Tenant schema exists in Postgres and the web app has tested CNPJ/CPF/CEP validators + shared TS types every later ticket imports.

## Context
Migrations are plain SQL in `migrations/NNN_name.sql`, applied in filename order by `uv run plic migrate` (tracked in `schema_migrations`; re-run is a no-op). Follow `migrations/006_analise.sql` style: header comment, `CREATE TABLE IF NOT EXISTS`, `TIMESTAMPTZ` with `now()` defaults. Local DB: `docker compose up -d db` → `postgresql://plic:plic@localhost:5433/plic`.

`migrations/007_tenant.sql` — create exactly:

```sql
CREATE TABLE IF NOT EXISTS empresa (
    id BIGSERIAL PRIMARY KEY,
    cnpj CHAR(14) NOT NULL UNIQUE,                -- digits only
    razao_social TEXT NOT NULL,
    nome_fantasia TEXT,
    natureza_juridica TEXT,                        -- e.g. '206-2 - Sociedade Empresária Limitada'
    porte TEXT CHECK (porte IN ('MEI','ME','EPP','MEDIO','GRANDE')),
    optante_simples BOOLEAN NOT NULL DEFAULT false,
    inscricao_estadual TEXT,
    inscricao_municipal TEXT,
    cep CHAR(8), logradouro TEXT, numero TEXT, complemento TEXT,
    bairro TEXT, municipio TEXT, uf CHAR(2),
    telefone TEXT, email TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS empresa_cnae (
    id BIGSERIAL PRIMARY KEY,
    empresa_id BIGINT NOT NULL REFERENCES empresa(id) ON DELETE CASCADE,
    codigo CHAR(7) NOT NULL,                       -- digits only, e.g. 6201501
    descricao TEXT NOT NULL,
    principal BOOLEAN NOT NULL DEFAULT false,
    UNIQUE (empresa_id, codigo)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_empresa_cnae_principal ON empresa_cnae (empresa_id) WHERE principal;
CREATE TABLE IF NOT EXISTS usuario (
    id BIGSERIAL PRIMARY KEY,
    empresa_id BIGINT NOT NULL REFERENCES empresa(id) ON DELETE CASCADE,
    email TEXT NOT NULL UNIQUE,                    -- store lowercased
    senha_hash TEXT,                               -- NULL while invite pending
    nome TEXT NOT NULL,
    cpf CHAR(11),
    telefone TEXT,
    cargo TEXT,
    role TEXT NOT NULL CHECK (role IN ('admin','member')),
    convite_token_hash TEXT,                       -- sha256 hex of invite token
    convite_expira_em TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_usuario_empresa ON usuario (empresa_id);
CREATE TABLE IF NOT EXISTS sessao (
    token_hash TEXT PRIMARY KEY,                   -- sha256 hex of cookie token
    usuario_id BIGINT NOT NULL REFERENCES usuario(id) ON DELETE CASCADE,
    expira_em TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_sessao_usuario ON sessao (usuario_id);
CREATE TABLE IF NOT EXISTS documento_empresa (
    id BIGSERIAL PRIMARY KEY,
    empresa_id BIGINT NOT NULL REFERENCES empresa(id) ON DELETE CASCADE,
    tipo TEXT NOT NULL CHECK (tipo IN ('contrato_social','cartao_cnpj','certidao_federal','certidao_fgts','certidao_trabalhista','certidao_estadual','certidao_municipal','balanco_patrimonial','atestado_capacidade_tecnica','outros')),
    nome_arquivo TEXT NOT NULL,                    -- original filename
    caminho TEXT NOT NULL,                         -- relative path under UPLOADS_DIR
    mime TEXT NOT NULL,
    tamanho_bytes BIGINT NOT NULL,
    validade DATE,
    enviado_por BIGINT REFERENCES usuario(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_documento_empresa ON documento_empresa (empresa_id);
```

`web/lib/br-validators.ts` — pure functions, no deps:
- `onlyDigits(s: string): string`
- `isValidCNPJ(s: string): boolean` — strip non-digits, 14 digits, reject all-same-digit, standard mod-11 check digits (weights `5,4,3,2,9,8,7,6,5,4,3,2` then `6,5,4,3,2,9,8,7,6,5,4,3,2`).
- `isValidCPF(s: string): boolean` — 11 digits, reject all-same, mod-11 weights 10..2 then 11..2.
- `isValidCEP(s: string): boolean` — exactly 8 digits after strip.
- `formatCNPJ(d: string): string` → `00.000.000/0000-00`; `formatCPF` → `000.000.000-00`; `formatCEP` → `00000-000`.
- `isValidEmail(s: string): boolean` — simple `/^[^\s@]+@[^\s@]+\.[^\s@]+$/`.

`web/lib/br-validators.test.ts` (vitest): valid CNPJ `11.222.333/0001-81`, invalid `11.222.333/0001-80`, all-same `11111111111111`; valid CPF `529.982.247-25`, invalid `529.982.247-24`; CEP; formatters round-trip.

`web/lib/tenant-types.ts` — TS types mirroring tables: `Porte`, `PORTES` const array, `Role`, `DocumentoTipo`, `DOCUMENTO_TIPOS` (array of `{value, label}` in pt-BR, e.g. `certidao_fgts` → "Certidão de regularidade do FGTS"), `Empresa`, `EmpresaCnae`, `Usuario` (no `senha_hash`), `DocumentoEmpresa`, `UF_LIST` (27 UFs).

## Checks (run in order — cheapest first)
1. `cd web && npx tsc --noEmit`
2. `cd web && npx vitest run lib/br-validators.test.ts`
3. `docker compose up -d db && sleep 3 && uv run plic migrate && psql postgresql://plic:plic@localhost:5433/plic -c '\d empresa' -c '\d usuario' -c '\d sessao' -c '\d documento_empresa' -c '\d empresa_cnae' | grep -c "Table" | grep -q 5`

## Done when
- Migration applies cleanly twice (second run: "No pending migrations"); validators tests green; types compile.

## Not included
- No pages, no auth, no queries, no seed data, no changes to existing tables.
