# Analysis — Lixto: is ~US$130/mo LLM spend worth it?

**Date:** 2026-08-27
**Score:** 4/10 as a business · 7/10 as a personal tool
**Classification:** **Validate** — as a dogfooded personal tool first; do not fund it as a product yet.

Context given by the founder: side project; primary user is the founder, who works with licitações professionally; no paying customer, no channel, no pricing defined.

---

## 1. Is the problem real?

**Yes, verified.** Reading one edital costs "entre 4 e 12 horas de trabalho técnico especializado" ([tecnoag](https://tecnoag.com.br/inteligencia-artificial-para-licitacoes-guia-pratico-2026/)). Effecti sizes the market at "mais de 50 mil licitações por mês" ([Effecti](https://effecti.com.br/tamanho-mercado-licitacoes-brasil/)); Lixto's own legacy DB measured ~130k/month across 257 PNCP-integrated portals (Aug 2026). Suppliers already pay: SIGA Pregão R$397/mo ([sigapregao.com.br](https://www.sigapregao.com.br/)), Licitário "a partir de R$ 28 por semana" ([licitario.com.br](https://licitario.com.br/precos)), ConLicitação claims "mais de 20 mil empresas" ([conlicitacao.com.br](https://conlicitacao.com.br/)). Painkiller for active bidders; vitamin for occasional ones.

## 2. Market

- Compras.gov.br 2025: R$ 465 bi, ~282k processes, 3,346 órgãos; PNCP total ~R$ 1 tri homologado ([Effecti / MGI](https://effecti.com.br/decreto-12807-de-2025/)).
- SAM proxy: ConLicitação 20k companies × ~R$ 200–400/mo ≈ R$ 50–100 M/yr for one incumbent. Whole "supplier tooling" segment plausibly R$ 200–400 M/yr. Growing: Lei 14.133 forces PNCP publication ([acritica](https://www.acritica.com/geral/nova-lei-de-licitac-es-amplia-exigencia-de-publicac-o-de-editais-no-pncp-1.406014)), which is exactly what makes a single-source ingestion like Lixto's possible now.
- Timing is real (PNCP + cheap LLMs), but incumbents saw it too — all ship "IA para análise de edital" already.

## 3. Competition

| player | price | traction | AI |
|---|---|---|---|
| ConLicitação | not public | "20 mil empresas", enterprise logos | ConLicita IA, Dr. Licita (petições), edital Q&A |
| Effecti | free tier + quote-only plans | market-content leader | Aimê AI edital analysis, robô de lances, alerts |
| SIGA Pregão | R$ 397/mo; R$ 2,800/yr | "+2700 licitantes", 4.9★ | edital analysis 12–200 interações/dia, robô de lances |
| Licitário | from R$ 28/week | unknown | — |
| Forseti "LIA" | launching 2026 | — | copiloto de edital ([eLicitação](https://elicitacao.com.br/2025/11/21/inteligencia-artificial-em-licitacoes/)) |
| Do nothing | R$ 0 | majority | manual PNCP search + WhatsApp groups |

No post-mortems found for this niche (search returned generic startup failures) — "no data found — speculation": likely because incumbents are profitable and small entrants stay small rather than die publicly.

## 4. Differentiation and defensibility

Lixto's real edge vs. what's on the market: profile-specific **matching** (CNAE inference + semantic) across **all** PNCP portals, proactive digest, GO/NO-GO — incumbents mostly do keyword alerts + on-demand edital chat. That's a 3–6 month feature gap, not a moat. Incumbents own distribution (20k customers) and the lances robot (which Lixto explicitly won't do). Lixto is an LLM-on-PNCP wrapper; ConLicitação/Effecti can absorb it as a feature. Only durable asset would be the learning loop (§14) — not built, needs users.

## 5. Business model

- WTP anchored: R$ 120–400/mo per company. At R$ 200/mo, **one** paying customer covers the entire LLM bill (US$130 ≈ R$ 700 covered by 3.5 customers).
- Solo-founder channel: none stated. Realistic only via the founder's own network in licitações (consultores, other suppliers) — that is a channel, but unproven.
- As a **personal tool**: cost US$ 130/mo (~R$ 700) vs SIGA at R$ 397 or Licitário at ~R$ 120. Lixto costs 2–6× a subscription but covers all portals with profile matching those don't do. Break-even = saves > ~4 h/month of the founder's edital reading, or contributes to one extra bid per year.

## 6. Main risks (probability × impact)

1. **No user besides the founder** → learning loop never gets data, product stays a personal script. (High × High)
2. **Cost drift**: fence + cap exist on paper; scanned-PDF share and Gemini quality unknown until 100 rows run. (Med × Med — mitigated by the daily cap)
3. **Incumbent parity**: Effecti/ConLicitação ship profile matching → differentiation gone. (High × Med)
4. **Side-project cadence**: ingestion + LLM pipeline needs monitoring; silent failures = empty digests = tool abandoned. (Med × High)
5. **Provider/ToS drift** (PNCP rate limits, Gemini pricing/free-tier changes). (Low × Med)

Single point of failure: the founder stops using it.

## 7. Red team

Twenty thousand companies already pay ConLicitação; Effecti gives a free tier with AI edital analysis; SIGA sells a bidding robot that directly makes money for the user. A side project with zero customers, no channel, no robot, and a US$130/mo bill enters against three funded incumbents whose only missing feature is a matching score they can copy in a quarter. The founder is the only user, and side projects with one user decay the moment maintenance exceeds novelty. The spend buys data nobody else consumes.

## 8. Verdict

**Business: 4/10.** Real pain, real WTP, but crowded, no distribution, thin moat.
**Personal tool: 7/10.** Founder is a domain practitioner with a daily need; cost is a fraction of a consultant hour; the pipeline already exists (sunk).

**Classification: Validate (dogfood).** Conditions:
- Start with the cheaper fence: **Compras.gov.br only** (~US$60/mo, 1/3 of open volume), not top-3. Expand only if digests miss opportunities you know about.
- Hard cap 1,500/day stays; review real $/1k after the first 100 rows before backfill.
- 30-day kill criterion: if you haven't acted on ≥ 3 digest opportunities in a month, pause schedules (cost → ~US$0, data stays).

**Cheapest experiment (< 2 weeks, < US$100):** run the cycle-21 pipeline on Compras.gov.br + Pregão-E only, backfill 45 days, use the digest for your own work for 3 weeks. Log every opportunity you acted on and every one you found elsewhere that Lixto missed. That single number (found-by-Lixto ÷ total-acted) decides everything.

**Three questions to answer with real data before more product code:**
1. How many of the bids you actually pursue in a month would Lixto have surfaced first?
2. How many hours/month does the GO/NO-GO + requirements extraction actually save you?
3. Would 3 people in your licitações network pay R$ 200/mo for the digest — ask them, don't assume.

If validated, next step is the MVP-design pass (`prompt-mvp.md`) using this file — separate session.

---

## Appendix — Searches executed

- WebSearch: "plataforma alerta de licitações preço mensal ConLicitação Effecti Siga Pregão 2026"
- WebSearch: "inteligência artificial licitações startup análise de edital GO NO-GO fornecedor 2025 2026"
- WebSearch: "PNCP volume contratações 2025 bilhões número de licitações publicadas Lei 14.133 fornecedores ME EPP"
- WebSearch: "\"licitações\" startup encerrou atividades OR fechou plataforma fornecedores post-mortem"
- WebSearch: "Effecti preço plano mensal R$ licitações \"por mês\" 2025"
- WebSearch: "Licitanet Licitar Digital Bolsa Nacional de Compras BNC número de fornecedores cadastrados"
- WebFetch: https://effecti.com.br/plataforma/ · https://conlicitacao.com.br/ · https://www.sigapregao.com.br/

Sources: [Effecti plataforma](https://effecti.com.br/plataforma/) · [Effecti market size](https://effecti.com.br/tamanho-mercado-licitacoes-brasil/) · [Effecti decreto 12.807](https://effecti.com.br/decreto-12807-de-2025/) · [ConLicitação](https://conlicitacao.com.br/) · [SIGA Pregão](https://www.sigapregao.com.br/) · [Licitário preços](https://licitario.com.br/precos) · [tecnoag guia IA](https://tecnoag.com.br/inteligencia-artificial-para-licitacoes-guia-pratico-2026/) · [eLicitação](https://elicitacao.com.br/2025/11/21/inteligencia-artificial-em-licitacoes/) · [A Crítica PNCP](https://www.acritica.com/geral/nova-lei-de-licitac-es-amplia-exigencia-de-publicac-o-de-editais-no-pncp-1.406014) · internal: legacy DB volume stats (Aug 2026), cost model in this session.
