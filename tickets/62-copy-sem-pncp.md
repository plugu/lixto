---
id: 62
status: done
model: sonnet
depends_on: []
max_attempts: 2
files:
  - web/app/page.tsx
  - web/components/marketing/hero.tsx
  - web/components/marketing/hero-visual.tsx
  - web/components/marketing/agente.tsx
  - web/components/marketing/como-funciona.tsx
  - web/components/marketing/problema.tsx
  - web/components/marketing/faq.tsx
  - web/components/marketing/preco.tsx
  - web/components/marketing/site-footer.tsx
---
## Goal
Revise the Lixto landing copy: remove every mention of PNCP and of sync frequency, position the agent as constantly monitoring "os portais de licitação", and add the proposal-submission roadmap (teaser + FAQ: ainda não envia, em breve enviará).

## Context
Read `PRODUCT.md` (repo root). Copy-only edits in the files listed — no layout, structure, or visual changes beyond one small teaser badge. PT-BR, keep the existing voice ("sell the worker, not the tool"). Every occurrence to change (verify with `grep -rniE 'pncp|por dia|duas vezes|2×' web/components/marketing web/app/page.tsx` after editing — must return nothing):

- `web/app/page.tsx:14` description "varre o PNCP duas vezes por dia" → agent monitors os portais de licitação constantemente; `:21` remove "PNCP" keyword.
- `hero.tsx:26` "vasculha o PNCP inteiro duas vezes por dia" → constant monitoring phrasing.
- `hero-visual.tsx:25` aria-label and `:83` label "TUDO QUE O PNCP PUBLICA" → "TUDO QUE OS PORTAIS PUBLICAM" (or equivalent).
- `agente.tsx:65` chamada "O PNCP inteiro, duas vezes por dia" and `:68` tag "Sync 2× ao dia" → continuous-monitoring phrasing ("Monitoramento contínuo", "Portais de licitação", keep "Sem palavra-chave").
- `agente.tsx` ~160–163 (proposal paragraph): rephrase to "o Lixto **ainda** não envia a proposta no seu lugar" and add a small "Em breve" teaser badge/phrase in this section: envio automático de propostas está chegando. Reuse existing marketing tokens/styles; no new components.
- `como-funciona.tsx:15–16` "Todo dia... sincroniza o PNCP" / "Todo dia, sozinho" → constant monitoring ("O tempo todo, sozinho" or similar).
- `problema.tsx:8` "publicam no PNCP o dia inteiro" → "publicam nos portais de compras públicas o dia inteiro".
- `faq.tsx:6` data-source answer: rewrite without naming PNCP or frequency — o agente monitora constantemente os portais oficiais de compras públicas do governo.
- `faq.tsx:13–14` proposal question: answer becomes "Ainda não" — analisa, prioriza e recomenda; o envio continua com você no portal oficial, **e em breve o Lixto poderá enviar a proposta por você**.
- `preco.tsx:4` "Sincronização do PNCP duas vezes por dia" → "Monitoramento contínuo dos portais de licitação"; `:63` "quantas licitações o PNCP publicar" → "quantas licitações os portais publicarem".
- `site-footer.tsx:41` and `:86` remove PNCP naming → "dados públicos dos portais oficiais de compras públicas" (or drop line 86's attribution sentence entirely).

## Checks (run in order — cheapest first)
1. `cd web && npm run lint`
2. `cd web && npm run build`
3. `! grep -rniE 'pncp|duas vezes|2× ao dia|por dia' web/components/marketing web/app/page.tsx`
4. `grep -rqiE 'constante|o tempo todo|continu' web/components/marketing && grep -rqi 'em breve' web/components/marketing/agente.tsx web/components/marketing/faq.tsx`

## Done when
- Zero PNCP or sync-frequency mentions anywhere on the landing (copy, aria-labels, metadata, OG).
- Landing says the agent monitors os portais de licitação constantemente.
- Agente section carries the "em breve: envio de propostas" teaser; FAQ states clearly it doesn't submit yet but soon will.

## Not included
- New sections, layout/visual redesign, new components or tokens.
- Dashboard/app copy, backend, docs/README, CLI (`src/`), internal PNCP naming.
- Any claim the agent already submits proposals today.
