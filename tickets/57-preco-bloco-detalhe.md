---
id: 57
status: done
model: sonnet
depends_on: [56]
max_attempts: 3
files:
  - web/components/itens-table.tsx
  - web/app/licitacao/[numeroControle]/page.tsx
---
## Goal
Show, on the licitação detail page, the median homologated price and the last winners for each item — right in the itens table, where the pricing decision happens.

## Context

**Read `web/AGENTS.md` first.** This is Next 16.3 / React 19.2 and it is not the Next.js in your training data — consult `node_modules/next/dist/docs/` (resolved from `web/`) before writing route or server-component code.

Ticket 56 already shipped `web/lib/preco-queries.ts` with `fetchPrecoBenchmark`, `enqueueResultadosFaltantes`, and the `PrecoItem` / `Vencedor` / `PrecoEstado` types. Consume them; do not modify that file.

Facts measured by ticket 56 that constrain your work:
- `fetchPrecoBenchmark` returns a `Map<number, PrecoItem>` with an entry for **every** item. An item with a missing or untokenizable descrição comes back as `estado: "insuficiente"`, `n: 0`, `vencedores: []` — so a missing map entry is not the case you need to design around, but still render `—` defensively if one is absent.
- `mediana` / `p25` / `p75` are `string | null` (Postgres numeric as text) and are **null unless `estado === "ok"`**. Pass them straight to `formatCurrencyBRL`, which already handles the string form elsewhere in this file.
- `enqueueResultadosFaltantes` costs ~90 ms per item on a cold queue — a 50-item licitação is multiple seconds. It must never be awaited on the render path. That is what `after()` is for; this is measured, not theoretical.
- `resultado` currently holds only a handful of rows, so on your machine essentially every item will render `Coletando…` or `Amostra insuficiente`. That is the correct, expected output today — do not "fix" it with placeholder numbers.

### `web/app/licitacao/[numeroControle]/page.tsx`

- Add `fetchPrecoBenchmark(numeroControlePncp)` to the existing `Promise.all([...])` alongside `fetchItens` / `fetchDocumentos` / `fetchAnalise`.
- Pass the resulting map to `<ItensTable itens={itens} precos={precos} />`.
- Queue the missing history **after the response**, not during render — the enqueue is a write and must not delay first byte. Use `after()` from `next/server` (check its current signature in `node_modules/next/dist/docs/` before using it) wrapping `enqueueResultadosFaltantes(numeroControlePncp)`, and swallow its errors with a `.catch()` so a queue failure never breaks the page.
- Everything else on the page stays exactly as it is: no layout change, no new card, no change to the `analise` sidebar grid.

### `web/components/itens-table.tsx`

Keep the existing component contract and both renderings (desktop table ≥ md, stacked cards < md). Add an optional prop `precos?: Map<number, PrecoItem>` — absent or missing entry renders `—`, so the component still works uncalled.

Desktop: one new column headed **"Homologado"**, placed immediately after "Valor unitário". Cell content by `estado`:
- `"ok"` — a native `<details>` element. `<summary>`: `formatCurrencyBRL(mediana)` then a muted ` · n=12`. Open body: `p25–p75` as a currency range on one line, then up to 3 winners, one per line — razão social, `porte_fornecedor_nome` as a `Badge tone="neutral"` when present, unit value, `formatDateBR(data_resultado)`.
- `"coletando"` — muted text `Coletando…`, no `<details>`.
- `"insuficiente"` — muted text `Amostra insuficiente`, no `<details>`.

Use `<details>`/`<summary>`, **not** state: this file is a server component with no `"use client"`, and it must stay that way.

Mobile card: add one line under the existing unit-value line — `Homologado R$ x,xx · n=12`, or `Coletando…` / `Amostra insuficiente`. No disclosure, no winners on mobile.

Reuse `formatCurrencyBRL` / `formatDateBR` from `@/lib/format` and the `Badge` already imported. Match the cycle-8 "calm canvas, dense data" styling already in this file (`text-ink-muted`, `tabular-nums`, hairline rows) — see `docs/WEB_STYLE.md` if a token is unclear.

## Checks (run in order — cheapest first)
1. `cd web && npx tsc --noEmit`
2. `cd web && npm run lint`
3. `cd web && npm test`
4. `cd web && npm run build`
5. Runtime probe — with the app built, `cd web && npm run start &`, wait for the port, then:
   `curl -s -o /tmp/plic-preco.html -w '%{http_code} %{time_total}\n' 'http://localhost:3000/licitacao/42498600000171-1-002592%2F2026'`
   Must print `200` with `time_total` under `3.0` seconds, and `grep -q 'Homologado' /tmp/plic-preco.html` must succeed. Kill the server afterwards.
   (If the route is behind the auth gate, authenticate the same way the cycle-12 runtime probe did rather than weakening the gate.)

## Done when
- Opening a licitação shows a "Homologado" column: a median with sample count where there is history, and an honest `Amostra insuficiente` / `Coletando…` where there is not.
- Expanding a cell reveals p25–p75 and the last winners with CNPJ razão social, porte and date.
- The page still renders with zero results collected — no crash, no empty column header without cells.

## Not included
- Any change to `web/lib/preco-queries.ts` (ticket 56 owns it) or to `web/lib/detail-queries.ts`.
- A `/concorrente/[cnpj]` route, a `/precos` screen, or a card on `/painel`.
- Client-side interactivity, charts, or sorting by homologated price.
- Touching the Analise panel, Documentos card, or page header.
