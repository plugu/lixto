---
id: 69
status: doing
model: sonnet
depends_on: [68]
max_attempts: 3
files:
  - web/app/(app)/lixto/page.tsx
  - web/components/chat/chat.tsx
  - web/components/chat/message-list.tsx
  - web/components/chat/composer.tsx
  - web/components/chat/quick-filters.tsx
  - web/components/chat/licitacao-ref-card.tsx
  - web/components/sidebar.tsx
---
## Goal
A conversational-first `/lixto` screen: the user types in natural language, sees the agent's answer with licitação cards (score + motivos), and can refine with quick filter chips.

## Context

Read `PRODUCT.md` (section: conversational-first UX, quick controls are accelerators) and ticket 68 (`POST/GET /api/chat` contract, `LicitacaoRef`, `Motivo` from `web/lib/match-engine.ts`). **Read `web/AGENTS.md`** (Next 16.3 / React 19.2; consult `node_modules/next/dist/docs/`). Visual language: `docs/WEB_STYLE.md` — "calm canvas, dense data"; reuse the kit in `web/components/ui/` (`Button`, `Badge`, `Card`, `Input`, `EmptyState`, `Section`, icons), tokens `text-ink`, `text-ink-muted`, `bg-surface`, `border-line`, `bg-accent-soft`, `text-accent`. Existing `FitBadge`/`StatusBadge` components can be reused for cards. Mobile-first: works below `md` (stacked), sidebar hidden there like the rest of the app.

### `web/app/(app)/lixto/page.tsx` (server)

`requireSession()`; fetch the user's most recent conversa + messages via `listConversas`/`listMensagens` from `web/lib/agent/conversa-queries.ts` (ticket 68) — no fetch to own API from the server. Render `<Chat initialConversaId initialMensagens empresaNome />`. Title in `metadata`: "Lixto".

### `web/components/chat/*` (client, `"use client"` where state lives)

- `chat.tsx` — state: `conversaId`, `mensagens: {role, conteudo, refs?}[]` (only `user`/`assistant` rows are displayed; `tool` rows are hidden), `filtros`, `pending`. `enviar(texto)`: optimistic user bubble → `fetch("/api/chat", { method: "POST", body: JSON.stringify({ conversaId, texto, filtros }) })` → append assistant `{ conteudo: resposta, refs }`; 401 or a non-JSON/redirected response (proxy.ts redirects cookieless requests to /login, so an expired session may arrive as HTML) → `window.location.href = "/login"`; other errors → inline error bubble "Não consegui responder agora. Tente de novo." "Nova conversa" button resets `conversaId` to null and clears the list.
- `message-list.tsx` — user bubbles right-aligned (`bg-accent-soft`), assistant left (`bg-surface border-line`), markdown-lite rendering: paragraphs and `\n` line breaks, numbered lines kept (no markdown lib). Under an assistant message with `refs`, a stacked list of `LicitacaoRefCard`. Auto-scroll to bottom on new message. `aria-live="polite"` on the list.
- `licitacao-ref-card.tsx` — `Link` to `/licitacao/${encodeURIComponent(numero)}`: index badge (`#1`), objeto (2-line clamp), órgão · município/UF · modalidade, `StatusBadge`, valor (`formatCurrencyBRL`), encerramento (`formatDateBR`), and when `score` present a `Badge` `Aderência 82` (note: max achievable score is 90 — never render a /100 scale) (tone `ok` ≥ 70, `warn` 40–69, `neutral` < 40) followed by up to 4 motivo chips: label by `codigo` (`cnae_principal` → "CNAE principal", `termo_enriquecimento` → "termos", `uf_fora` → "fora da UF", `me_epp_exclusivo` → "exclusivo ME/EPP", `exclusao` → "exclusão", `valor_fora` → "fora da faixa", others sensibly), negative `peso` chips in `danger`/`warn` tone, `title` attribute = `detalhe`.
- `composer.tsx` — textarea (Enter sends, Shift+Enter newline), send `Button` (disabled while `pending`), sample prompts shown when the list is empty (`EmptyState` with 4 clickable suggestions: "Liste licitações abertas com lápis como item", "Quais licitações combinam com minha empresa?", "Só no Rio de Janeiro, acima de R$ 100 mil", "Analise a segunda").
- `quick-filters.tsx` — chip row above the composer: UF (multi-select from `UF_LIST`, use `web/components/multi-select.tsx` if its API fits, else a `Popover` of checkboxes), Status (aberta / vai abrir), Valor mín/máx (two small inputs). Emits `filtros` to `chat.tsx`; active chips shown with an `×` to clear. Purely additive — sending with no chips works exactly as before.

### `web/components/sidebar.tsx`

Add `{ href: "/lixto", label: "Lixto", icon: Chart }` as the **first** `NAV_ITEMS` entry (reuse an existing icon from `web/components/ui/icons.tsx`; `isActive` needs no change). `web/components/ui/top-bar.tsx` imports `NAV_ITEMS` from the sidebar and renders the mobile nav from it — no change needed there.

## Checks (run in order — cheapest first)
1. `cd web && npx tsc --noEmit`
2. `cd web && npm run lint`
3. `cd web && npm test`
4. `cd web && npm run build`
5. Runtime probe (local DB up with ≥ 1 `usuario`; mint a cookie exactly as in ticket 68's check 5 — `openssl` token, sha256 into `sessao`): `cd web && (npm run start -- -p 3101 &) && sleep 5 && curl -s -o /tmp/lixto.html -w '%{http_code}\n' -b "plic_session=$token" localhost:3101/lixto` prints `200` and `grep -q 'Nova conversa' /tmp/lixto.html`; then `pkill -f "next-server"`. No LLM key needed for this probe.

## Done when
- Logged in, `/lixto` shows the empty state with suggestions; sending "Quais licitações combinam com minha empresa?" renders an assistant reply with cards showing Aderência + motivo chips linking to the detail page.
- Selecting UF = RJ in the chips and sending a message includes `filtros.ufs = ["RJ"]` in the POST body (check in devtools/network or a unit test of the body builder).

## Not included
- Streaming tokens, markdown library, conversation history sidebar (only "Nova conversa").
- Changing the login redirect or `/dashboard`; landing page.
- Any change to `web/lib/**` or `web/app/api/**` (ticket 68 owns them).
