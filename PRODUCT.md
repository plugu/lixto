---
mode: mvp
routing_profile: cloud
parallel_default: sequential
---

# Preço-alvo: quanto esse item já foi homologado (cycle 13)

## What / why

Licitante perde por preço, não por não achar edital. O PNCP publica, por item,
`valorUnitarioHomologado` + CNPJ do vencedor em
`/v1/orgaos/{cnpj}/compras/{ano}/{seq}/itens/{n}/resultados` — verificado ao vivo
em 2026-08-24 (HTTP 200, payload completo). O dashboard hoje não usa nada disso.

Concorrente direto (Licinexus) vende "Previsor — estimativa de preço vencedor"
como modelo proprietário; o insumo é dado público que já sabemos paginar. Moat
aqui é o histórico acumulado, não o prompt.

Restrição descoberta na apuração: `catalogo_codigo_item` (CATMAT/CATSER) existe
em só 19.714 dos 7,85M itens (0,25%), e NCM em 3%. Agrupar item comparável tem
que sair da descrição. E varrer os 4,06M itens de licitações homologadas a
2 req/s levaria ~23 dias — o crawl precisa ser sob demanda, não em massa.

## Primary user story

Como licitante avaliando uma licitação aberta, eu vejo em cada item quanto itens
equivalentes foram homologados antes — mediana, faixa p25–p75, quantas amostras
— e quem venceu, pra decidir meu preço sem chutar.

## Scope

- Tabela `resultado` (migration nova): chave
  `(numero_controle_pncp, numero_item, sequencial_resultado)`, colunas promovidas
  do `RecuperarCompraItemResultadoDTO` — `ni_fornecedor`,
  `nome_razao_social_fornecedor`, `porte_fornecedor_id/nome`,
  `quantidade_homologada`, `valor_unitario_homologado`, `valor_total_homologado`,
  `percentual_desconto`, `ordem_classificacao_srp`, `situacao_*`,
  `data_resultado`, `data_inclusao/atualizacao`. **Sem coluna `raw`** — disco é
  barato mas o `raw` de `item` já custa 15 GB; aqui não se repete o erro.
- `plic sync resultados` — pagina `/resultados` por item, reusa o `PncpClient`
  (rate limit, 429/5xx backoff), trata 204/404 como zero linhas, é resumable via
  stamp de sincronização, e drena uma fila de itens pendentes.
- Busca de comparáveis por descrição em Postgres (FTS pt-BR + trigram, sobre o
  `unaccent` que já existe), restrita a itens de licitações homologadas.
- Lazy fill: abrir a licitação enfileira o fetch de resultados dos itens
  históricos comparáveis que ainda não têm resultado — bounded por item, não
  crawl aberto. A licitação aberta em si não tem resultado; o número vem do
  histórico.
- Bloco de preço em `/licitacao/[numeroControle]`, por item: mediana do valor
  unitário homologado, faixa p25–p75, N amostras, e os últimos vencedores (CNPJ,
  razão social, porte ME/EPP, valor unitário, data).
- Honestidade sobre incerteza: com N < 5 não mostra número — mostra "amostra
  insuficiente". Enquanto a fila não drenou, mostra "coletando".

## Out of scope

- Rota `/concorrente/[cnpj]` e perfil de concorrente — cycle 14, com o banco já
  quente.
- Embeddings / pgvector para similaridade semântica. FTS+trigram primeiro; se a
  qualidade do match não servir, aí vira decisão de outro ciclo.
- Backfill em massa dos 4,06M itens.
- Previsão por ML, robô de lance, card agregado no `/painel`, multi-portal.
- Mexer no fit-triage ou no deep-analysis pra consumir preço.

## Success demo

Done when abro uma licitação aberta e cada item mostra mediana homologada, faixa
p25–p75, N amostras e últimos vencedores — ou diz honestamente que a amostra é
insuficiente.
