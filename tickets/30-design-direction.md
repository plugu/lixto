---
id: 30
status: todo
model: orchestrator
depends_on: []
max_attempts: 3
files:
  - docs/design/cycle8-direction.md
---
## Goal
An approved visual direction before any page is touched: token sheet + three static mockups (home hero, `/licitacoes` table, `/licitacao/[id]` detail) published as a design canvas the user can inspect and annotate.

## Context
**Executed by the orchestrator** (needs the `design` skill / Artifact tool, not available to implementers). References: Perplexity (warm canvas, pill controls, centered hero, tone-separated surfaces) + Attio (icon+label sidebar with ⌘K, toolbar Filtrar·Ordenar·Colunas with count badges, status dot+text, dense rows, popovers). Current tokens in `web/app/globals.css` (navy ink `hsl(216 55% 14%)`, accent `hsl(224 70% 46%)`, Hanken body / Bricolage display, shadows `subtle`/`card`).

Deliverables:
1. `docs/design/cycle8-direction.md`: final token table (palette: canvas, surface, surface-raised, ink, ink-muted, line, accent, accent-soft, status ok/warn/off, fit high/mid/low), type scale (display 28/22/18, body 14/13, mono for numbers), radius (pill 999 / 10 / 6), spacing rhythm (4-pt), shadow policy (none for structure; only popovers/hero), icon style (1.5px stroke, 16/20px), sidebar width (240 / 56 collapsed), density (row 40px default / 32 compact). Plus component inventory for `components/ui/` with prop signatures (see ticket 31).
2. Design canvas with 3 artboards at 1440×900: `home`, `licitacoes`, `detalhe`. Real copy (pt-BR), real-looking data.

## Checks (run in order — cheapest first)
1. `test -s docs/design/cycle8-direction.md`
2. Canvas artifact URL recorded at the bottom of `docs/design/cycle8-direction.md` (`grep -q "claude.ai" docs/design/cycle8-direction.md`)
3. User says "approved" (or requests changes → iterate, max 3 rounds) — recorded as `approved: <date>` line in the doc (`grep -q "^approved:" docs/design/cycle8-direction.md`)

## Done when
- Direction doc + canvas exist and carry the `approved:` line.

## Not included
- No code, no CSS changes, no component files.
