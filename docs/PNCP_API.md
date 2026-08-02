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

### `GET /api/consulta/v1/contratacoes/atualizacao` — incremental by update date

Same params as `/publicacao` (dataInicial/dataFinal filter on `dataAtualizacaoGlobal`). Same response shape.

### `GET /api/consulta/v1/contratacoes/proposta` — open proposal windows (not used for sync; useful for reconciliation)

Required: `dataFinal`, `pagina`. Page size hard-capped at 50 here.

### `GET /api/pncp/v1/orgaos/{cnpj}/compras/{ano}/{sequencial}/itens` — line items

Params: path cnpj/ano/sequencial + optional `pagina`, `tamanhoPagina`.
Response: bare JSON array of `RecuperarCompraItemSigiloDTO` (no page envelope). End of pagination is signaled by HTTP 204 with empty body on pages past the first (measured live 2026-08-01), not by `200 []` — handle both.

### `GET /api/pncp/v1/orgaos/{cnpj}/compras/{ano}/{sequencial}/arquivos` — edital + anexos

Params: same shape as `/itens`. Response: bare array of `RecuperarDadosDocumentoCompraDTO`.

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

## Modalidade codes (`codigoModalidadeContratacao`)

1 Leilão eletrônico · 2 Diálogo competitivo · 3 Concurso · 4 Concorrência eletrônica ·
5 Concorrência presencial · 6 Pregão eletrônico · 7 Pregão presencial · 8 Dispensa ·
9 Inexigibilidade · 10 Manifestação de interesse · 11 Pré-qualificação · 12 Credenciamento ·
13 Leilão presencial

## Measured behavior (from prior field notes, `~/dev/licitacoes/docs/PNCP_NOTES.md`)

- Rate limiting: 429 observed after ~6 req/s. Self-impose ≥1 s between requests; on 429 cool down ~30 s (honor `Retry-After` when present, usually absent).
- Availability flaps: intermittent 503/504; 5xx bodies are HTML, not JSON — never parse error bodies as JSON.
- Retry on 429 and 500–504 with exponential backoff (max ~5 attempts); do not retry other 4xx.
- Timeouts: a 500-record page has been observed to take >60 s — use a ~90 s request timeout.
- Upserts must key on `numeroControlePNCP`; use `dataAtualizacaoGlobal` as the freshness/watermark field (publication date misses edits and addenda).
