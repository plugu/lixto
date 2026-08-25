# PNCP API reference (verified 2026-08-01 against live OpenAPI specs)

Facts below were extracted from `https://pncp.gov.br/api/consulta/v3/api-docs` and
`https://pncp.gov.br/api/pncp/v3/api-docs`. No auth required on any endpoint.

## Base URLs

- Consultation API: `https://pncp.gov.br/api/consulta`
- Main API (items, files): `https://pncp.gov.br/api/pncp`

## Endpoints used by this project

### `GET /api/consulta/v1/contratacoes/publicacao` — backfill by publication date

Required: `dataInicial`, `dataFinal` (format `yyyyMMdd`), `codigoModalidadeContratacao` (int, one call per modalidade), `pagina` (1-based).
Optional: `tamanhoPagina` (use 50), `uf`, `codigoMunicipioIbge`, `cnpj`, `codigoModoDisputa`, `codigoUnidadeAdministrativa`, `idUsuario`.

Response: `PaginaRetornoRecuperarCompraPublicacaoDTO`:
`{ data: [RecuperarCompraPublicacaoDTO], totalRegistros, totalPaginas, numeroPagina, paginasRestantes, empty }`

Zero-result queries return HTTP 204 with empty body, not a `200` with an empty envelope (measured live 2026-08-01). Treat 204 as zero rows.

### `GET /api/consulta/v1/contratacoes/atualizacao` — incremental by update date

Same params as `/publicacao` (dataInicial/dataFinal filter on `dataAtualizacaoGlobal`). Same response shape.

### `GET /api/consulta/v1/contratacoes/proposta` — open proposal windows (not used for sync; useful for reconciliation)

Required: `dataFinal`, `pagina`. Page size hard-capped at 50 here.

### `GET /api/pncp/v1/orgaos/{cnpj}/compras/{ano}/{sequencial}/itens` — line items

Params: path cnpj/ano/sequencial + optional `pagina`, `tamanhoPagina`.
Response: bare JSON array of `RecuperarCompraItemSigiloDTO` (no page envelope). End of pagination is signaled by HTTP 204 with empty body on pages past the first (measured live 2026-08-01), not by `200 []` — handle both.

### `GET /api/pncp/v1/orgaos/{cnpj}/compras/{ano}/{sequencial}/arquivos` — edital + anexos

Params: same shape as `/itens`. Response: bare array of `RecuperarDadosDocumentoCompraDTO`.

### `GET /api/pncp/v1/orgaos/{cnpj}/compras/{ano}/{sequencial}/itens/{numeroItem}/resultados` — homologated results per item

Params: path cnpj/ano/sequencial/numeroItem. Optional `pagina` parameter is **ignored** (see trap below).
Response: bare JSON array of `RecuperarCompraItemResultadoDTO`.
Verified live 2026-08-24 (HTTP 200 on `42498600000171/2026/2592` item 1).

**PAGINATION TRAP (critical):** Unlike `/itens` and `/arquivos`, this endpoint does **not** implement real pagination.
The `pagina` parameter is silently ignored; pages 2, 3, … 200+ all echo page 1's exact content back with HTTP 200 — never a 404, 204, or `200 []`.
This was confirmed independently twice: once on a same-day result and once on a historical result from April 2026, and again by direct curl at `pagina=5`.
A naive paginator loops forever here. The solution is to always fetch only page 1 (the `_FirstPageOnly` wrapper in `src/plic/sync_resultados.py` demonstrates this).

## Key DTO fields

`RecuperarCompraPublicacaoDTO` (35 fields; store full JSON in `raw`, promote these to columns):
`numeroControlePNCP` (natural key), `anoCompra`, `sequencialCompra`, `numeroCompra`, `processo`,
`orgaoEntidade{cnpj, razaoSocial, poderId, esferaId}`, `unidadeOrgao{codigoUnidade, nomeUnidade, ufSigla, municipioNome, codigoIbge}`,
`modalidadeId`, `modalidadeNome`, `modoDisputaId`, `modoDisputaNome`, `situacaoCompraId`, `situacaoCompraNome`,
`tipoInstrumentoConvocatorioCodigo`, `tipoInstrumentoConvocatorioNome`, `amparoLegal{codigo, nome}`,
`objetoCompra`, `informacaoComplementar`, `srp` (bool), `valorTotalEstimado`, `valorTotalHomologado`,
`dataAberturaProposta`, `dataEncerramentoProposta` (both nullable — dispensa/inexigibilidade often have no window),
`dataPublicacaoPncp`, `dataInclusao`, `dataAtualizacao`, `dataAtualizacaoGlobal` (incremental sync key),
`linkSistemaOrigem`, `linkProcessoEletronico`, `fontesOrcamentarias` (array), `usuarioNome`.

`RecuperarCompraItemSigiloDTO` (36 fields; promote):
`numeroItem`, `descricao`, `materialOuServico`, `materialOuServicoNome`, `quantidade`, `unidadeMedida`,
`valorUnitarioEstimado`, `valorTotal`, `criterioJulgamentoId/Nome`, `situacaoCompraItem/Nome`,
`tipoBeneficio/Nome`, `ncmNbsCodigo`, `catalogoCodigoItem`, `dataInclusao`, `dataAtualizacao`.

`RecuperarDadosDocumentoCompraDTO` (12 fields):
`sequencialDocumento`, `titulo`, `tipoDocumentoId`, `tipoDocumentoNome`, `tipoDocumentoDescricao`,
`url` (download link — this is what we store; tipoDocumentoId 2 = edital), `statusAtivo`, `dataPublicacaoPncp`,
`cnpj`, `anoCompra`, `sequencialCompra`.

`RecuperarCompraItemResultadoDTO` (promoted fields):
`numeroItem`, `sequencialResultado`, `niFornecedor`, `nomeRazaoSocialFornecedor`, `tipoPessoa`,
`porteFornecedorId`, `porteFornecedorNome`, `quantidadeHomologada`, `valorUnitarioHomologado`, `valorTotalHomologado`,
`percentualDesconto`, `ordemClassificacaoSrp`, `situacaoCompraItemResultadoId`, `situacaoCompraItemResultadoNome`,
`indicadorSubcontratacao`, `dataResultado`, `dataCancelamento`, `motivoCancelamento`, `dataInclusao`, `dataAtualizacao`.
Note: `reservaRemanescente` is a nested `{codigo, nome}` object and is not stored.

## Measured sparsity

- `catalogoCodigoItem` (CATMAT/CATSER catalog join key): present on only **0.25%** of items (19,714 of 7,856,405 rows as of 2026-08-24).
- `ncmNbsCodigo` (NCM classification): present on only **3%** of items.

Both are too sparse for reliable catalog joins; price comparison uses description text instead. The next person looking for a catalog cross-reference should not have to rediscover this.

## Modalidade codes (`codigoModalidadeContratacao`)

1 Leilão eletrônico · 2 Diálogo competitivo · 3 Concurso · 4 Concorrência eletrônica ·
5 Concorrência presencial · 6 Pregão eletrônico · 7 Pregão presencial · 8 Dispensa ·
9 Inexigibilidade · 10 Manifestação de interesse · 11 Pré-qualificação · 12 Credenciamento ·
13 Leilão presencial

## Measured behavior (from prior field notes, `~/dev/licitacoes/docs/PNCP_NOTES.md`)

- Rate limiting: 429 observed after ~6 req/s. Self-impose an interval between requests (default 0.5 s = 2 req/s, env `PLIC_MIN_REQUEST_INTERVAL`); on 429 cool down ~30 s (honor `Retry-After` when present, usually absent).
- Availability flaps: intermittent 503/504; 5xx bodies are HTML, not JSON — never parse error bodies as JSON.
- Retry on 429 and 500–504 with exponential backoff (max ~5 attempts); do not retry other 4xx.
- Timeouts: a 500-record page has been observed to take >60 s — use a ~90 s request timeout.
- Upserts must key on `numeroControlePNCP`; use `dataAtualizacaoGlobal` as the freshness/watermark field (publication date misses edits and addenda).
