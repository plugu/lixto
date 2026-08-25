---
id: 65
status: doing
model: sonnet
depends_on: []
max_attempts: 3
files:
  - migrations/011_perfil_match.sql
  - web/lib/perfil-queries.ts
  - web/lib/perfil-queries.test.ts
  - web/lib/normalize.ts
  - web/lib/normalize.test.ts
  - web/app/(app)/empresa/perfil/page.tsx
  - web/app/(app)/empresa/perfil/actions.ts
  - web/components/perfil-match-form.tsx
  - web/app/(app)/empresa/page.tsx
  - web/app/(app)/empresa/usuarios/page.tsx
  - web/app/(app)/empresa/documentos/page.tsx
---
## Goal
Each empresa gets a DB-backed matching profile (products, keywords, exclusions, UFs, value range) editable at `/empresa/perfil`, replacing the single `company_profile.md` as the "other side" of the match.

## Context

Read `PRODUCT.md` and `docs/TENANT.md` (golden rule: `empresa_id` comes only from the session). **Read `web/AGENTS.md`** — Next 16.3 / React 19.2; check `node_modules/next/dist/docs/` before writing route/server-component code. Follow `web/lib/empresa-queries.ts` + `web/app/(app)/empresa/actions.ts` + `web/components/empresa-form.tsx` exactly (server action with `useActionState`, `requireAdmin` for writes, `requireSession` for reads, `revalidatePath`). Tests: vitest with a mocked pool like `web/lib/empresa-queries.test.ts`; import `./db` relatively in lib files.

### `migrations/011_perfil_match.sql`

```sql
-- Per-empresa matching profile (cycle 16). Replaces company_profile.md as the
-- company side of the match. Arrays hold normalized terms (see web/lib/normalize.ts):
-- lowercase, accents stripped, single-spaced — identical to enriquecimento.*.
CREATE TABLE IF NOT EXISTS empresa_perfil (
    empresa_id BIGINT PRIMARY KEY REFERENCES empresa(id) ON DELETE CASCADE,
    produtos TEXT[] NOT NULL DEFAULT '{}',        -- what the company sells/executes (raw, as typed)
    palavras_chave TEXT[] NOT NULL DEFAULT '{}',  -- raw, as typed
    exclusoes TEXT[] NOT NULL DEFAULT '{}',       -- raw, as typed
    termos TEXT[] NOT NULL DEFAULT '{}',          -- normalized(produtos ∪ palavras_chave), what the match engine reads
    exclusoes_termos TEXT[] NOT NULL DEFAULT '{}',-- normalized(exclusoes)
    ufs CHAR(2)[] NOT NULL DEFAULT '{}',          -- empty = todas
    valor_min NUMERIC,
    valor_max NUMERIC,
    observacoes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_empresa_perfil_termos ON empresa_perfil USING gin (termos);
```

### `web/lib/normalize.ts`

`export function normalizeTerm(s: string): string` — `s.normalize("NFKD").replace(/\p{Diacritic}/gu, "").toLowerCase().replace(/\s+/g, " ").trim().slice(0, 40)`; `export function normalizeTerms(xs: string[]): string[]` — map, drop empty, dedupe preserving order, max 50. Must produce the same output as Python `normalize_term` in ticket 63 for ASCII/Latin input (tests: `"Lápis Preto  nº 2 "` → `"lapis preto no 2"`; `"Ção"` → `"cao"`).

### `web/lib/perfil-queries.ts`

```ts
export type PerfilMatch = {
  empresa_id: number; produtos: string[]; palavras_chave: string[]; exclusoes: string[];
  termos: string[]; exclusoes_termos: string[]; ufs: string[];
  valor_min: string | null; valor_max: string | null; observacoes: string | null;
};
export type PerfilInput = { produtos: string[]; palavrasChave: string[]; exclusoes: string[]; ufs: string[]; valorMin: string; valorMax: string; observacoes: string };
export async function getPerfil(empresaId: number): Promise<PerfilMatch | null>;
export function buildUpsertPerfil(empresaId: number, input: PerfilInput): SqlQuery; // empresaId is $1; computes termos/exclusoes_termos via normalizeTerms
export async function upsertPerfil(empresaId: number, input: PerfilInput): Promise<void>;
export function parseTermList(raw: string): string[]; // split on newline/comma/semicolon, trim, drop empty, dedupe, max 50
```
`valorMin/valorMax`: empty → null; accept `"50000"`, `"50.000,00"`, `"R$ 50.000,00"` (strip everything except digits and the last comma → dot). Reject `valorMin > valorMax` in the action with the error `"Valor mínimo maior que o máximo."`. UFs validated against `UF_LIST` from `web/lib/tenant-types.ts`.

### Page + form

- `web/app/(app)/empresa/perfil/page.tsx`: `requireSession`, `getPerfil(session.usuario.empresaId)` (null → empty form), header `<Section eyebrow="Empresa" title="Perfil de match">` with the same pill nav as `empresa/page.tsx` (`EMPRESA_NAV` now has four entries: Perfil, **Match**, Usuários, Documentos — add the `{ href: "/empresa/perfil", label: "Match" }` entry to the `EMPRESA_NAV` constant in all three existing pages so the tab shows everywhere; nothing else changes in those files).
- `web/components/perfil-match-form.tsx` (`"use client"`): fields — `produtos` (textarea, "um por linha"), `palavrasChave` (textarea), `exclusoes` (textarea), `ufs` (checkbox grid from `UF_LIST`, "nenhuma marcada = todas"), `valorMin`/`valorMax` (Input), `observacoes` (textarea). Use `Field`/`Input`/`Button`/`Section` from `web/components/ui/`, same read-only behaviour as `EmpresaForm` (members see disabled fields, no save button). Short helper copy under the title: "Lixto usa este perfil para calcular a aderência de cada licitação à sua empresa."
- `web/app/(app)/empresa/perfil/actions.ts`: `updatePerfilAction(prev, formData)` — `requireAdmin`, parse via `parseTermList`, validate, `upsertPerfil`, `revalidatePath("/empresa/perfil")`, returns `{ ok: true }` or `{ erro }`.

### Tests

- `normalize.test.ts`: cases above.
- `perfil-queries.test.ts`: `parseTermList` splitting/dedupe; `buildUpsertPerfil` binds `$1 = empresaId`, computes `termos` from produtos ∪ palavras_chave normalized, parses `"R$ 50.000,00"` → `50000.00`, empty → null, empty ufs → `[]`; `getPerfil` returns null when no row (mocked pool).

## Checks (run in order — cheapest first)
1. `cd web && npx tsc --noEmit`
2. `cd web && npm run lint`
3. `cd web && npm test`
4. `cd web && npm run build`

## Done when
- An admin opens `/empresa/perfil`, saves products/keywords/UFs/values, reloads and sees them; a member sees the same form disabled.
- `empresa_perfil.termos` holds normalized terms (checked in a test through `buildUpsertPerfil`).

## Not included
- Any matching/scoring logic (ticket 66) or reading the profile from Python.
- Deleting `company_profile.md` or changing `src/plic/agents/*` (legacy pipeline stays until a later cycle).
- Migrating existing `company_profile.md` content automatically.
