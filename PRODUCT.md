---
mode: mvp
routing_profile: cloud
parallel_default: sequential
---

# plataforma-licitante — filtros v2 (cycle 3)

## What / why

The `/licitacoes` filter bar is functional but primitive: five single-select native dropdowns, no multi-select, no UF filter, no value filter, and the portal dropdown drowns users in 257 raw system names. This cycle redesigns filtering for efficiency (senior-UX pass): popover multi-selects with removable chips, plus a platform-wide focus on the 7 portals that matter.

## Primary user story

As the operator, I combine multiple modalidades, setores, portais, status, UFs and a faixa de valor in a clean filter bar — seeing per-option counts and my active selections as chips — so that I can zero in on biddable licitações in seconds.

## Scope

- **Pattern:** compact filter bar; each filter opens a popover with a checkbox list; active selections render as removable chips below; "Limpar tudo". Palavra-chave input + Buscar stay.
- **Multi-select:** modalidade, setor, portal, status, UF (new filter). Categoria stays single-select. All state remains in URL params (repeatable params, shareable).
- **New filters:** UF (multi) and faixa de valor estimado (min/max inputs).
- **Per-option counts** inside popovers (e.g. "Pregão Eletrônico (9.698)"), computed against the other active filters.
- **Top-7 portal allowlist, platform-wide:** everything (list, dashboard tiles, charts, counts, filter options) considers ONLY licitações from: Compras.gov.br; ECustomize Consultoria em Software S.A; IPM Sistemas; Betha Sistemas; Governançabrasil Tecnologia e Gestão em Serviços; BLL Compras; Megasoft Informática. Other records stay in the DB untouched (and keep syncing) but are invisible in the UI. Allowlist lives in one shared constant.
- **Visual:** per `docs/WEB_STYLE.md` — popovers as cards (`shadow-card`), chips as rounded-full tokens, accent for active states.

## Out of scope

- Backend/ingestion changes (sync keeps ingesting all portals).
- Saved filters/presets, URL shortening.
- Dashboard redesign beyond applying the top-7 allowlist to its queries.
- Faceted sidebar, mobile-specific layout work.
- Search-as-you-type/debounced live results.

## Success demo

Done when I can select two modalidades + three setores + two UFs + status Aberta + valor 50k–500k, see chips for each, per-option counts in the popovers, results matching all of it — and every number on the platform reflects only the top-7 portals.
