---
mode: mvp
routing_profile: cloud
parallel_default: sequential
---

# plataforma-licitante — dashboard de licitações (cycle 2)

## What / why

The ingestion agent (cycle 1, done — see `docs/cycles/01-ingestao/`) keeps a local Postgres mirror of every PNCP licitação since 2026-01-01: ~556k licitações with itens and edital/anexo URLs, refreshed twice daily. Today the only way to explore it is raw SQL. This cycle builds the first product face: a web dashboard — MVP of a future SaaS — to search and inspect licitações. Entire UI in Brazilian Portuguese.

Visual reference: Amie-style (`~/Documents/hero (1).webp`) — clean, flat, light, left sidebar, generous whitespace, subtle borders, no heavy chrome.

## Primary user story

As the operator, I open the dashboard, search by palavra-chave and filter by portal (sistema de origem), modalidade, and status (aberta / vai abrir / fechada), so that I can find relevant licitações and open each one's detail page — dados completos, itens, edital and anexos (links) — instead of writing SQL.

## Scope

- **List view:** searchable, filterable, paginated table/list of licitações. Columns: objeto, órgão, município/UF, modalidade, status, valor estimado, encerramento date.
- **Filters:** palavra-chave (full-text over objeto + descrições de itens), portal = sistema de origem (derived from `link_sistema_origem` domain), modalidade, status. Status derives from proposal-window dates (existing views' logic: aberta / vai abrir / fechada).
- **Detail page:** all licitação fields worth showing, list of itens (descrição, quantidade, valores, situação), documentos grouped as edital vs anexos with download links to PNCP, link to the origin system.
- **Language:** pt-BR everywhere (labels, dates dd/mm/aaaa, R$ formatting).
- **Runs locally** against the existing Postgres (`docker compose` DB); no login.

## Out of scope

- Auth, signup, billing, multi-tenant — later SaaS cycle.
- Alerts/notifications, saved searches, favorites.
- Downloading/serving edital PDFs (links only, as in cycle 1).
- MCP server (separate cycle).
- Any change to the ingestion pipeline or schema beyond read-side needs (indexes/views allowed).
- Mobile layout polish (desktop-first; don't actively break mobile).

## Success demo

Done when I can open the dashboard, type a palavra-chave, filter status = aberta plus a modalidade and a portal, see the matching licitações instantly, click one, and read its full details with itens and clickable edital/anexo links — all in Portuguese.
