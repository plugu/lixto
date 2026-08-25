---
mode: prototype
routing_profile: cloud
parallel_default: sequential
---

# Lixto — revisão de copy do site (cycle 15)

## What / why
The shipped Lixto landing leaks implementation detail: it names PNCP as the data source and says the agent syncs "duas vezes por dia". That undersells the agent and dates the copy. This cycle is a copy-only revision of the public site (`web/app/page.tsx` metadata + `web/components/marketing/*`):

1. **Remove every mention of PNCP and of sync frequency** from the site copy (hero, agente, como-funciona, FAQ, footer, metadata/OG). Replace with the positioning: **o agente monitora os portais de licitação constantemente**.
2. **Proposal-submission roadmap, teaser + FAQ**: add a "em breve" teaser in the agente section (badge/phrase: envio automático de propostas está chegando) and an honest FAQ entry stating the agent does not yet submit proposals for the user — today it hunts, analyzes and scores; submission is coming soon.

Tone stays: sell the worker, not the tool. No overpromise of autonomous bidding today.

## Primary user story
As a visitor evaluating Lixto, I read that an agent constantly monitors procurement portals for me, and I understand clearly it doesn't yet submit proposals (but soon will) — so my expectations are set correctly when I sign up.

## Out of scope
- New sections, layout or visual changes (copy edits only)
- Dashboard/app copy (`/dashboard` untouched; PNCP naming inside the app stays)
- Backend, sync behavior, docs/README
- Any claim the agent already submits proposals

## Success demo
Done when the landing page shows zero PNCP/frequency mentions, says the agent monitors portals constantly, shows the "em breve: envio de propostas" teaser plus FAQ entry, and `npm run build` passes.
