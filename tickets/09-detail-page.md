---
id: 09
status: doing
model: sonnet
depends_on: [08]
max_attempts: 3
files:
  - web/app/licitacao/[numeroControle]/page.tsx
  - web/components/itens-table.tsx
  - web/components/documentos-list.tsx
  - web/lib/detail-queries.ts
  - README.md
---
## Goal
Detail page `/licitacao/[numeroControle]` with full dados, itens table, and edital/anexo links; README gains a dashboard section.

## Context
Style: `docs/WEB_STYLE.md` (detail page spec). Column names: `migrations/001_schema.sql`. Route param is `numero_controle_pncp` (contains `/` — URL-encode in list links, decode here; e.g. `11285282000137-1-000033/2026`).

Sections: header (objeto full, status badge, órgão + unidade, município/UF); metadata grid (modalidade, modo de disputa, situação PNCP, amparo legal, processo, valores estimado/homologado, datas publicação/abertura/encerramento, SRP, link "Abrir no sistema de origem" → `link_sistema_origem`, link "Ver no PNCP" → `https://pncp.gov.br/app/editais/{cnpj}/{ano}/{sequencial}`); informação complementar (prose); Itens table (nº, descrição, quantidade, unidade, valor unitário, valor total, situação, benefício ME/EPP); Documentos: "Edital" group (`tipo_documento_id = 2`) then "Anexos" (rest), each `titulo` + tipo + link (`url`, target _blank), only `status_ativo`. 404-friendly "Licitação não encontrada" state.

README: "Dashboard" section — `cd web && npm install && npm run dev`, requires DB up + `plic db init`.

## Checks (run in order — cheapest first)
1. `cd web && npx tsc --noEmit`
2. `cd web && npx vitest run`
3. `cd web && npm run build`
4. `cd web && (npm run start -- -p 3100 &) && sleep 5 && NC=$(docker compose -f ../docker-compose.yml exec -T db psql -U plic -d plic -tc "select numero_controle_pncp from licitacao where itens_sincronizados_em is not null limit 1" | xargs) && curl -s "localhost:3100/licitacao/$(python3 -c "import urllib.parse,sys;print(urllib.parse.quote(sys.argv[1],safe=''))" "$NC")" | grep -qi "Itens" && pkill -f "next start"`

## Done when
- Real licitação renders all sections; edital/anexo links clickable; itens populated; unknown id shows 404 state.

## Not included
- No PDF proxy/preview, no breadcrumbs beyond "← Voltar", no editing, no per-item search.
