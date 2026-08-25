# STATE — rewrite after every ticket completes; never append. ≤30 lines total.

## Now
- Cycle 15 (revisão de copy Lixto) done: ticket 62, prototype, 1 tentativa. Checks: lint, build, grep PNCP/frequência limpo, teaser "em breve" presente.

## Next
- Verificar deploy do `web` pós-push e conferir a landing em produção.
- Candidatos ciclo 16: throughput da fila de resultados (1 visita enfileira ~1700 itens vs 2000/noite drenados); `/concorrente/[cnpj]`; qualidade do match FTS+trigram.

## Decisions
- Site não nomeia mais PNCP nem frequência de sync: posicionamento é "monitora os portais de licitação constantemente". Nomenclatura PNCP segue viva dentro do app e nos docs — a mudança é só de copy pública.
- Envio de propostas: FAQ diz "ainda não" + teaser "Em breve: envio de propostas" na seção agente. Nunca afirmar que já envia.
- `como-funciona` passo 3: "Minutos por dia" → "Poucos minutos". Caiu por causa do grep `por dia` do check, que mirava "duas vezes por dia". Era tempo do usuário, não frequência de sync — perda semântica pequena, aberta a revisão.
- Carried: sem cron em máquina de dev (crons = Dokploy no `cli`); crawl de resultados demand-driven; `/resultados` sem paginação (`_FirstPageOnly`).

## Blockers
- none.
