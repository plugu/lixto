# Analysis — Lixto "case-owning agent" (proactive robot that works an opportunity end-to-end)

- **Date**: 2026-09-21
- **Idea as stated by owner**: proactive AI agents monitor new procurements/dispensas by profile, filters and CNAEs; find and classify good opportunities; gather the necessary documents; interact with the human; human only decides to place the bid, with analysis and risks done.
- **Score, idea as stated**: 4/10 — *Bury as a differentiator* (already Lixto's VISION §12–13 and the 2026 market's default pitch; "place a bid" has no legitimate write path).
- **Score, sharpened bet**: 6.5/10 — *Validate*: an agent that **owns each opportunity as a case from first signal to homologated result**, with a deterministic eligibility verdict against the company's own documents, a price band from homologated results, agent-initiated interaction, and outcome capture. Run the concierge experiment in §8 before writing code.

## Phase 0 — assumptions (autonomous session, no Q&A possible)
- Market: Brazil, PNCP-sourced tenders; modalities 6 (pregão eletrônico) and 8 (dispensa eletrônica) per the prod cost fence.
- Payer: the SME supplier (ME/EPP) already on Lixto. Beta is free today, gated signup.
- Channel: existing product, email outbox, and WhatsApp (owner already runs an Evolution API instance).
- Team: one owner plus AI coding agents; LLM spend fenced by construction (daily caps).
- Budget: no new infrastructure; reuse the built-but-disabled pieces.

## 1. Is the problem real?
- Who: small bidders that live off public sales, typically 1–3 people doing everything: reading, docs, pricing, portal registration, live dispute.
- Pain today, in order: (a) reading editais — now largely solved by AI readers (Effecti Aimê, Siga, Licitei, Lixto's own dossier); (b) disqualification by documents (validity, missing atestado, wrong declaration); (c) pricing blind; (d) the portal grind (registering proposals, live lances); (e) losing track of deadlines across many processes.
- They already pay: Siga Pregão Basic R$ 397/month, tiers at R$ 2,800/year and R$ 3,997/year; Effecti sells tiered plans by volume (price not public in results). Painkiller for active bidders: revenue depends on it.

## 2. Market
- Size: no fresh TAM figure found — speculation only. The user base is the set of active public suppliers in Brazil (hundreds of thousands of CNPJs registered in SICAF and state portals; not verified in this session).
- Timing (verified from search): Lei 14.133/2021 fully in force; PNCP is the mandatory publication hub and PCAs (annual procurement plans) are published there; 2026 articles describe PNCP centralization as the enabler of automation at scale; LLM cost drop made edital reading a commodity.

## 3. Competition (from searches, 2026-09)
| Player | What they ship | Gaps vs. the sharpened bet |
|---|---|---|
| Effecti (Minha Effecti) | Multi-portal monitoring (PNCP, Compras.gov.br, diários, state/municipal); "Aimê" AI: ask questions to the edital, requirements, deadlines, risk classification, automatic checklists; document vault with certificate validity; assisted declarations; separate "robô de lances" | Aimê page: does not check the bidder's own documents against the edital, does not price items, does not submit proposals, does not read PCA |
| Siga Pregão | 19+ portals; AI edital analysis (12/day Basic, 200/day higher tiers); funnel + task checklists per process; competitor history; AI supplier finder; bid robot with margin protection; legal templates (impugnação, esclarecimento, recurso); auctioneer chat monitoring; "Pagômetro" (agency payment capacity) | No PCA, no eligibility verdict against own docs, no outcome-calibrated pricing per case; interaction is user-driven |
| Licitei | AI analysis "in 30s" + robot; **crosses edital requirements with the company's cloud document folder, mounts the habilitação, says what is ready and what is missing, suggests declarations** | Reactive (edital published), no PCA, no outcome loop |
| LicitBot | Generates 31 documents; "agentes inteligentes"; automatic audit of certificate validity | Document generator, not a case owner |
| Facilita Licitações, LiciteAI, LicitaIA, LicitAchei | AI analysis + habilitação checklist + declarations + deadline organizer; docs vault with expiry alerts; PCA appears only as blog content | Same reactive window |
| Do nothing | Owner reads, WhatsApp group, spreadsheet, alerts from a cheap portal | The real competitor for the smallest bidders |
- Failed attempts in this exact space: no data found.
- Conclusion: "AI reads the edital, lists risks and required docs, generates declarations" is commoditized. "Robot bids" is the incumbents' moat. Cross-checking your own docs is already claimed by at least one player (Licitei).

## 4. Differentiation and defensibility
Unclaimed ground (no product page found doing it):
1. **Working the opportunity before the edital exists**: PCA items in the horizon and expiring contracts (Lixto: Radar V1 built, 725 predicted opportunities in dev, disabled in prod; 20,174 contracts in dev).
2. **Eligibility verdict computed, not summarized**: `tender_analysis_requirements` (category, mandatory, severity, citations) × `company_documents` (kind, valid_until) × company size/CNAE/state → "habilitado / falta X / vence antes da sessão". Code, not LLM.
3. **Price band from homologated results** per item family and region (`procurement_results` via the demand queue `results_requested_at`; endpoint verified, demand-driven by design).
4. **Agent-initiated interaction**: the agent opens the conversation (in-app case thread + WhatsApp) only when it cannot resolve something: missing document, price confirmation, GO decision.
5. **Closed loop**: won/lost/disqualified/winner price per case feeds the next verdict (`opportunity_feedback` exists, 0 rows; results sync exists, 0 rows).
- Moat: data model spanning before-edital and after-result, plus per-company case history (switching cost) and the measurable lead-time claim ("found N days before publication"). Not structural: Effecti could add PCA in two quarters. The moat compounds only if the loop runs.
- LLM-wrapper risk: high for the reading layer (already commoditized), low for the deterministic engines and the case lifecycle.

## 5. Business model
- Willingness to pay anchors: R$ 397/month (Siga Basic) up to R$ 3,997/year tiers. A case agent replacing part of a bidding assistant's work (R$ 3–4k/month salary) can justify R$ 500–1,000/month for active bidders — hypothesis, no data.
- CAC/LTV: unknown; beta is free and gated. Incumbents own SEO ("licitação" content). Speculation: channel = beta users' referrals and WhatsApp-native experience. Flag as a top-5 risk.

## 6. Main risks (probability × impact)
1. **Coverage gap**: Lixto fences 3 origin systems and modalities 6/8; the dispute happens on ~19 portals where Effecti/Siga sit with robots. The agent stops at "packet ready", the human still logs into the portal.
2. **Wrong eligibility verdict = disqualification**: one bad verdict kills trust. Mitigation: verdict always shows evidence (dossier citations exist) and confidence; human approves.
3. **Thin data**: catalog codes on <1% of items (docs/PNCP_API.md:328) so price matching relies on description FTS/embeddings; results 0 rows locally (never requested); PCA sync off in prod; 0 company documents uploaded in dev; atestados and balance sheets are files without extracted facts.
4. **LLM cost per company**: must stay deterministic except packet drafting on GO cases (bounded like `recommend` at 5/company/day).
5. **Channel and promises**: Evolution API is an unofficial WhatsApp client (ban risk); landing page already says "em breve o Lixto poderá enviar a proposta por você" while Compras.gov.br APIs are read-only (search: open-data APIs, no proposal write). Soften to "pacote pronto para envio".
- Single point of failure: trust in the verdict + price band. If operators re-read everything anyway, the agent saved nothing.

## 7. Red team — why it fails
Small bidders in dispensa/pregão for goods are price-and-speed players. Their remaining human work is not reading (solved) but registering proposals and fighting lances on portals Lixto does not touch. A "case agent" that ends with "upload this yourself" looks incomplete next to a robot that bids. PCA data is thin outside the federal sphere, so the lead-time story is a federal-only story. Results are demand-driven and slow at PNCP rate limits, so price bands stay sparse for months. Company documents will not be uploaded (0 today), so the eligibility engine has nothing to check. Licitei already markets the docs cross-check; Effecti has the vault and the dossier and can ship the same verdict in a quarter, with 19 portals behind it.

## 8. Verdict
- **Idea as stated**: 4/10, bury as the differentiator. Keep it as the product narrative; it is already VISION §12–13.
- **Sharpened bet (case-owning agent)**: 6.5/10, **Validate**.
- **Three questions to answer with data before code**:
  1. Coverage: what share of the beta companies' real bids in the last 90 days were on the fenced portals and modalities?
  2. Behaviour: of the GO recommendations sent in the last 30 days, how many turned into a submitted proposal, and what stopped the rest (docs, price, time, portal)?
  3. Failure mode: how many of their last 20 losses were disqualifications, and for which document or requirement?
- **Cheapest experiment (<2 weeks, ~R$ 0–500)**: concierge run with 3 beta companies. For every GO recommendation during one week, the owner hand-builds the packet from existing data (verdict from dossier requirements vs their uploaded docs, price band from PNCP results requested via the demand queue, doc bundle, draft declarations) and sends it on WhatsApp with one question: "Enviar? sim / não / outro preço". Measure: reply rate, time to decision, proposals actually submitted, whether anyone re-read the edital, and any win. Success bar: ≥2 of 3 companies act on ≥50% of packets without re-reading.
- If Validate holds: run the MVP-design step in a separate session using this file as input.

## Appendix — searches executed (2026-09-21)
- "Effecti inteligência artificial análise de edital 2026 funcionalidades" → https://effecti.com.br/inteligencia-artificial-nas-licitacoes/ ; https://www.effecti.com.br/blog/inteligencia-artificial-para-licitantes/ (fetched: Aimê scope and explicit non-features)
- "Siga Pregão IA análise de edital robô de disputa funcionalidades 2026" → https://www.sigapregao.com.br/ (fetched: modules, AI limits, pricing) ; https://www.sigapregao.com.br/planos/
- "software licitações IA agente proposta automática habilitação documentos 2026 Brasil" → https://facilitaweb.app.br/site ; https://licitbot.com/ ; https://liciteai.com.br/ ; https://www.licitaia.app/ ; https://tecnoag.com.br/inteligencia-artificial-para-licitacoes-guia-pratico-2026/ ; https://licitagov.org/artigos/automacao-processos-licitatorios/
- "plano de contratações anual PCA PNCP monitoramento fornecedores software licitações oportunidades futuras" → https://effecti.com.br/plano-de-contratacoes-anual-pca/ (content only) ; https://pncp.gov.br/app/pca ; https://licitachei.iagenes.com.br/blog/2026-07-13-como-consultar-pca-plano-de-contratacoes-anual-pncp
- "Effecti planos preços mensal licitantes 2026 Siga Pregão preço plano" → https://effecti.com.br/plataforma/ ; https://www.sigapregao.com.br/planos/
- "software licitação verifica automaticamente documentos de habilitação da empresa contra exigências do edital" → https://www.licitei.com.br/ia (cross-check claim) ; https://licitbot.com/ ; https://facilitaweb.app.br/site
- "Compras.gov.br API fornecedor cadastrar proposta integração" → https://compras.dados.gov.br/docs/ ; https://dadosabertos.compras.gov.br/swagger-ui/index.html (read-only open data; no proposal write endpoint found)
- Internal evidence: docs/VISION.md §12–14 and appendix; docs/ARCHITECTURE.md "Tender Analysis (Cycle 25)", "Not Built Yet"; migrations/001_core.sql (`company_documents`, `agent_actions`, `opportunity_feedback`, `procurement_results`, `procurement_items.results_requested_at`); src/lixto/sync/results.py; docs/PNCP_API.md:328; web/app/page.tsx FAQ copy; local dev DB counts (3,030 procurements, 2,865 plan items, 725 future opportunities, 20,174 contracts, 0 results, 0 company documents, 0 feedback).
