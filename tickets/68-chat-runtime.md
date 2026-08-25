---
id: 68
status: todo
model: opus
depends_on: [67]
max_attempts: 3
files:
  - migrations/012_conversa.sql
  - web/package.json
  - web/package-lock.json
  - web/lib/agent/llm.ts
  - web/lib/agent/run.ts
  - web/lib/agent/run.test.ts
  - web/lib/agent/conversa-queries.ts
  - web/lib/agent/conversa-queries.test.ts
  - web/app/api/chat/route.ts
---
## Goal
A persisted, tenant-scoped conversation runtime: user message → model with tools → tool execution (ticket 67) → answer, exposed as `POST /api/chat`.

## Context

Read `PRODUCT.md`, ticket 67 (`TOOL_DEFINITIONS`, `executeTool`, `ToolContext`, `LicitacaoRef`), `docs/TENANT.md`, and **`web/AGENTS.md`** (Next 16.3 — check `node_modules/next/dist/docs/01-app` for route handlers before writing `route.ts`). Session from `web/lib/auth.ts` (`getSession`); never trust an empresa id from the request.

### Dependency

`cd web && npm install openai@^5` (commit `package-lock.json`). Use the Chat Completions API with `tools` (function calling) — portable across OpenAI-compatible providers (OpenRouter etc.) via `baseURL`.

### `migrations/012_conversa.sql`

```sql
CREATE TABLE IF NOT EXISTS conversa (
    id BIGSERIAL PRIMARY KEY,
    empresa_id BIGINT NOT NULL REFERENCES empresa(id) ON DELETE CASCADE,
    usuario_id BIGINT NOT NULL REFERENCES usuario(id) ON DELETE CASCADE,
    titulo TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_conversa_usuario ON conversa (usuario_id, updated_at DESC);
CREATE TABLE IF NOT EXISTS mensagem (
    id BIGSERIAL PRIMARY KEY,
    conversa_id BIGINT NOT NULL REFERENCES conversa(id) ON DELETE CASCADE,
    role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'tool')),
    conteudo TEXT,
    tool_calls JSONB,      -- assistant: [{id, name, arguments}]
    tool_call_id TEXT,     -- tool rows
    refs JSONB,            -- assistant: LicitacaoRef[] shown as cards
    modelo TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_mensagem_conversa ON mensagem (conversa_id, id);
```

### `web/lib/agent/llm.ts`

`export function getChatClient(): OpenAI` — `new OpenAI({ apiKey: process.env.PLIC_LLM_API_KEY ?? process.env.OPENAI_API_KEY, baseURL: process.env.PLIC_LLM_BASE_URL || undefined })`; `export const CHAT_MODEL = process.env.PLIC_CHAT_MODEL ?? "gpt-5-mini"`. Same env names as the Python side (ticket 64).

### `web/lib/agent/conversa-queries.ts`

`createConversa(empresaId, usuarioId, titulo)`, `getConversa(id, usuarioId)` (returns null unless the row belongs to that usuario — **bind both**), `listConversas(usuarioId, limit = 20)`, `appendMensagem(conversaId, {role, conteudo, tool_calls?, tool_call_id?, refs?, modelo?})`, `listMensagens(conversaId, limit = 40)` (oldest first), `touchConversa(id)`. Tests with mocked pool: `getConversa` binds `usuarioId`; `appendMensagem` serializes JSON columns.

### `web/lib/agent/run.ts`

```ts
export type RunInput = { conversaId: number | null; texto: string; filtros?: { ufs?: string[]; statuses?: string[]; valorMin?: number; valorMax?: number; modalidadeIds?: number[] } };
export type RunOutput = { conversaId: number; resposta: string; refs: LicitacaoRef[]; toolCalls: { name: string; args: unknown }[] };
export async function runChat(input: RunInput, session: Session, deps?: { client?: OpenAI; model?: string; execute?: typeof executeTool }): Promise<RunOutput>;
```
Behaviour:
1. `conversaId` null → `createConversa` with `titulo = texto.slice(0, 80)`; otherwise `getConversa(id, session.usuario.id)` must exist (else throw `ConversaNotFound`).
2. Persist the user message. Build `messages`: system prompt + last 20 persisted messages mapped to OpenAI shape (`assistant` rows with `tool_calls`, `tool` rows with `tool_call_id`) + the new user message. `filtros`, when present, are appended to the user content as a trailing line `[filtros ativos: uf=RJ,SP; status=aberta; valor=100000–500000]` so quick controls are just accelerators (PRODUCT.md).
3. System prompt `SYSTEM_PROMPT(ctx)` (module export, PT-BR): "Você é o Lixto, agente de licitações públicas da empresa {nome} (porte {porte}). Responda em português, de forma direta. Use as ferramentas para buscar e analisar licitações — nunca invente números de controle, valores ou prazos: só cite o que veio das ferramentas. Ao listar licitações, numere-as (1., 2., …) na mesma ordem retornada, para o usuário poder dizer 'a segunda'. Quando o usuário perguntar se a empresa pode participar / quais combinam, use search_my_matches ou calculate_match e explique os motivos pelo código (cnae, termos, uf, valor, me/epp, exclusão). Se o perfil de match não estiver configurado, diga como configurar em /empresa/perfil."
4. Loop (max `MAX_ROUNDS = 6`): `client.chat.completions.create({ model, messages, tools, tool_choice: "auto" })`. If the reply has `tool_calls`: persist the assistant row (with `tool_calls`), execute each via `execute(name, JSON.parse(arguments), ctx)`, persist each `tool` row (`conteudo = JSON.stringify(result.ok ? result.data : { erro })`, truncated to 20 000 chars), collect `refs` from `ok` results (dedupe by `numero_controle_pncp`, keep first occurrence order), push to `messages`, continue. Else persist the final assistant text with `refs`, `touchConversa`, return.
5. Round cap reached → final text "Não consegui concluir a consulta; tente reformular." persisted and returned. Any SDK error → rethrow (route maps to 502).

`ctx: ToolContext = { empresaId: session.empresa.id, porte: <empresa.porte via one query; add to conversa-queries as getEmpresaPorte(empresaId)>, empresaNome: session.empresa.nomeFantasia ?? session.empresa.razaoSocial }`.

### `web/app/api/chat/route.ts`

- `POST` body `{ conversaId?: number; texto: string; filtros?: ... }` → `getSession()` (401 JSON when null) → validate `texto` non-empty ≤ 2000 chars (400) → `runChat` → `200 { conversaId, resposta, refs }`. `ConversaNotFound` → 404; other errors → 502 `{ erro: "falha ao falar com o modelo" }` with `console.error`.
- `GET ?conversaId=` → `{ conversa, mensagens }` for the session's usuario (404 otherwise); `GET` without id → `{ conversas: listConversas(usuarioId) }`.
- `export const runtime = "nodejs"`; no caching.

### Tests (`run.test.ts`)

Mock `conversa-queries` and pass a fake `client` whose `chat.completions.create` is a `vi.fn()` scripted per call, plus a fake `execute`. Assert: first reply with `tool_calls` triggers `execute` with `ctx.empresaId = session.empresa.id`, tool rows persisted with the right `tool_call_id`, second reply's text is returned with refs deduped; `filtros` line appended to the user content; round cap message; `conversaId` of another user → throws.

## Checks (run in order — cheapest first)
1. `cd web && npx tsc --noEmit`
2. `cd web && npm run lint`
3. `cd web && npm test`
4. `cd web && npm run build`
5. Runtime probe when `PLIC_LLM_API_KEY`/`OPENAI_API_KEY` is set, the local DB is up and has at least one `usuario` row. Mint a session directly (same scheme as `createSession` in `web/lib/auth.ts`: raw base64url token in the cookie, sha256 hex in `sessao`):
   ```sh
   token=$(openssl rand -base64 32 | tr '+/' '-_' | tr -d '=')
   hash=$(printf %s "$token" | shasum -a 256 | cut -d' ' -f1)
   docker compose exec -T db psql -U plic -c "INSERT INTO sessao (token_hash, usuario_id, expira_em) VALUES ('$hash', (SELECT id FROM usuario WHERE senha_hash IS NOT NULL ORDER BY id LIMIT 1), now() + interval '1 day')"
   cd web && (npm run start -- -p 3101 &) && sleep 5
   curl -s -b "plic_session=$token" -H 'content-type: application/json' -d '{"texto":"liste 3 licitações abertas com lápis"}' localhost:3101/api/chat
   pkill -f "next-server"
   ```
   Must return 200 with a non-empty `resposta` and a `refs` array. Skip and say so in the receipt if no key/DB/usuario.

## Done when
- Two sequential `POST /api/chat` calls with the returned `conversaId` share history (second answer can refer to "a segunda" from the first list).
- Every persisted row is scoped to the session's `usuario`/`empresa`; unauthenticated requests get 401.

## Not included
- React UI (ticket 69); streaming/SSE (mvp shortcut: single JSON reply — documented).
- Rate limiting, cost accounting, conversation deletion.
- Any tool beyond ticket 67's five.
