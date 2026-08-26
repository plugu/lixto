# PNCP API Reference

The Portal Nacional de Contratações Públicas (PNCP) exposes public procurement data via REST API. Lixto syncs six main domains: procurements, items, documents, results, annual plans (PCA), and contracts.

**General notes**:
- Base URL: `https://pncp.gov.br/api`
- No auth required
- All dates in responses: ISO 8601 (`YYYY-MM-DDTHH:MM:SSZ`) or simple date (`YYYY-MM-DD`)
- Date parameters: `yyyyMMdd` (string, no separators)
- Responses: JSON with envelope structure below; HTTP 204 = empty result
- Rate limit: ~2 req/s. Lixto respects `LIXTO_MIN_REQUEST_INTERVAL` (default 0.5s)
- Pagination: `tamanhoPagina=50` (max), `pagina` (1-indexed), `paginasRestantes` (count of remaining pages)

## 1. Incremental Procurements

**Endpoint**: `GET /consulta/v1/contratacoes/atualizacao`

Fetch procurements changed since a date (watermarked by `dataAtualizacaoGlobal`).

**Parameters**:
- `dataInicio` (yyyyMMdd) — window start
- `dataFim` (yyyyMMdd) — window end
- `pagina` (integer) — page number (1-indexed)
- `tamanhoPagina` (integer) — items per page (default/max 50)

**Response**:
```json
{
  "data": [ /* RecuperarCompraPublicacaoDTO */ ],
  "totalRegistros": 1234,
  "totalPaginas": 25,
  "numeroPagina": 1,
  "paginasRestantes": 24
}
```

HTTP 204 = no results for this window (idempotent).

**DTO: RecuperarCompraPublicacaoDTO** (→ `procurements` table)

| Field | Type | Notes | Column |
|---|---|---|---|
| `numeroControlePNCP` | string | PNCP control number (public ID) | `source_id` |
| `orgaoEntidade.cnpj` | string | 14 digits | `agency_tax_id` |
| `orgaoEntidade.razaoSocial` | string | Agency name | `agencies.name` |
| `orgaoEntidade.poderId` | string | Power code | `agencies.power_code` |
| `orgaoEntidade.esferaId` | string | Sphere code | `agencies.sphere_code` |
| `unidadeOrgao.codigoUnidade` | string | Unit code | `unit_code` |
| `unidadeOrgao.ufSigla` | string | State (e.g., 'SP') | `state` |
| `unidadeOrgao.municipioNome` | string | City name | `city_name` |
| `unidadeOrgao.codigoIbge` | string | IBGE code | (not stored) |
| `anoCompra` | integer | Year | `year` |
| `sequencialCompra` | integer | Sequence | `sequence` |
| `numeroCompra` | string | Display number | `number` |
| `processo` | string | Process number | `process_number` |
| `modalidadeId` | integer | Modality (1–13) | `modality_id` |
| `modalidadeNome` | string | Modality name | `modality_name` |
| `modoDisputaId` | integer | Dispute mode | `dispute_mode_id` |
| `modoDisputaNome` | string | Dispute mode name | `dispute_mode_name` |
| `situacaoCompraId` | integer | Status (1=open, 2=closed) | `status_id` |
| `situacaoCompraNome` | string | Status name | `status_name` |
| `tipoInstrumentoConvocatorioCodigo` | integer | Instrument type | `instrument_type_id` |
| `tipoInstrumentoConvocatorioNome` | string | Instrument type name | `instrument_type_name` |
| `amparoLegal.codigo` | string | Legal basis code | `legal_basis_code` |
| `amparoLegal.nome` | string | Legal basis name | `legal_basis_name` |
| `objetoCompra` | string | Description | `description` |
| `informacaoComplementar` | string | Additional info | `additional_info` |
| `srp` | boolean | Is price registry? | `is_price_registry` |
| `valorTotalEstimado` | number | Estimated value | `estimated_value` |
| `valorTotalHomologado` | number | Awarded value | `awarded_value` |
| `dataAberturaProposta` | string (ISO 8601) | Proposal opens | `proposal_opens_at` |
| `dataEncerramentoProposta` | string (ISO 8601) | Proposal closes | `proposal_closes_at` |
| `dataPublicacaoPncp` | string (ISO 8601) | Published | `published_at` |
| `dataInclusao` | string (ISO 8601) | Created in source | `source_created_at` |
| `dataAtualizacao` | string (ISO 8601) | Updated in source | `source_updated_at` |
| `dataAtualizacaoGlobal` | string (ISO 8601) | **Incremental watermark** | `source_global_updated_at` |
| `usuarioNome` | string | Publishing system | `origin_system` |
| `linkSistemaOrigem` | string | Proposal submission URL | `origin_url` |
| `linkProcessoEletronico` | string | E-process link | `process_url` |
| `fontesOrcamentarias` | array | Budget sources | `budget_sources` (JSONB) |

**Note**: Items and documents are fetched separately (see endpoints 2 & 3).

## 2. Procurement Items

**Endpoint**: `GET /api/pncp/v1/orgaos/{cnpj}/compras/{ano}/{sequencial}/itens`

Fetch line items for a procurement.

**DTO: RecuperarCompraItemSigiloDTO** (→ `procurement_items` table)

| Field | Type | Column |
|---|---|---|
| `numeroItem` | integer | `item_number` |
| `descricao` | string | `description` |
| `materialOuServico` | string (M\|S) | `kind` |
| `quantidade` | number | `quantity` |
| `unidadeMedida` | string | `unit` |
| `valorUnitarioEstimado` | number | `estimated_unit_price` |
| `valorTotal` | number | `estimated_total` |
| `criterioJulgamentoId` | integer | `judging_criterion_id` |
| `criterioJulgamentoNome` | string | `judging_criterion_name` |
| `situacaoCompraItemId` | integer | `status_id` |
| `situacaoCompraItemNome` | string | `status_name` |
| `tipoBeneficioId` | integer | `benefit_type_id` |
| `tipoBeneficioNome` | string | `benefit_type_name` |
| `codigoNcmNbs` | string | `ncm_nbs_code` |
| `catalogoCodigoItem` | string | `catalog_code` |
| `dataInclusao` | string (ISO 8601) | `source_created_at` |
| `dataAtualizacao` | string (ISO 8601) | `source_updated_at` |

## 3. Procurement Documents

**Endpoint**: `GET /api/pncp/v1/orgaos/{cnpj}/compras/{ano}/{sequencial}/arquivos`

Fetch editais and attachments.

**DTO: RecuperarDadosDocumentoCompraDTO** (→ `procurement_documents` table)

| Field | Type | Column |
|---|---|---|
| `sequencialDocumento` | integer | `sequence` |
| `titulo` | string | `title` |
| `tipoDocumentoId` | integer | `type_id` (2 = edital) |
| `tipoDocumentoNome` | string | `type_name` |
| `tipoDocumentoDescricao` | string | `type_description` |
| `url` | string | `url` (PDF download link) |
| `statusAtivo` | boolean | `is_active` |
| `dataPublicacaoPncp` | string (ISO 8601) | `published_at` |

**Text extraction**: PDFs at `url` are downloaded and parsed by `lixto enrich run` → `procurement_document_texts`.

## 4. Homologated Results

**Endpoint**: `GET /api/pncp/v1/orgaos/{cnpj}/compras/{ano}/{sequencial}/itens/{numeroItem}/resultados`

Fetch winners and awarded prices per item.

**DTO: RecuperarCompraItemResultadoDTO** (→ `procurement_results` table)

| Field | Type | Column |
|---|---|---|
| `sequencialResultado` | integer | `sequence` |
| `niFornecedor` | string | `supplier_tax_id` |
| `nomeRazaoSocialFornecedor` | string | `supplier_name` |
| `tipoPessoa` | string (PJ\|PF\|PE) | `supplier_kind` |
| `porteFornecedorId` | integer | `supplier_size_id` |
| `porteFornecedorNome` | string | `supplier_size_name` |
| `quantidadeHomologada` | number | `awarded_quantity` |
| `valorUnitarioHomologado` | number | `awarded_unit_price` |
| `valorTotalHomologado` | number | `awarded_total` |
| `percentualDesconto` | number | `discount_pct` |
| `ordemClassificacaoSrp` | integer | `price_registry_rank` (1=winner for SRP, NULL for non-SRP) |
| `situacaoCompraItemResultadoId` | integer | `status_id` |
| `situacaoCompraItemResultadoNome` | string | `status_name` |
| `indicadorSubcontratacao` | boolean | `has_subcontracting` |
| `dataResultado` | string (YYYY-MM-DD) | `result_date` |
| `dataCancelamento` | string (ISO 8601) | `cancelled_at` |
| `motivoCancelamento` | string | `cancel_reason` |
| `dataInclusao` | string (ISO 8601) | `source_created_at` |
| `dataAtualizacao` | string (ISO 8601) | `source_updated_at` |

**Demand queue**: Results are fetched on-demand. When a user views a procurement detail, `procurement_items.results_requested_at` is set. `lixto results sync` drains this queue.

## 5. Annual Procurement Plans (PCA)

**Endpoint**: `GET /consulta/v1/pca/atualizacao`

Fetch Planos de Contratação Anual (forward signal of planned procurements).

**Parameters**:
- `dataInicio` (yyyyMMdd)
- `dataFim` (yyyyMMdd)
- `pagina`
- `tamanhoPagina` (default/max 50)

**Response**: Same envelope as procurements.

**Watermark**: Store max `dataAtualizacaoGlobalPCA` in `sync_state` key `incremental:plans`.

**Volume note**: ~200k rows / 3-day window. HTTP 200 with empty body on retries is idempotent.

**DTO: PlanoContratacaoComItensDoUsuarioDTO** (→ `procurement_plans` table)

| Field | Type | Column |
|---|---|---|
| `idPcaPncp` | string | `source_id` |
| `orgaoEntidadeCnpj` | string | `agency_tax_id` |
| `orgaoEntidadeRazaoSocial` | string | `agencies.name` |
| `codigoUnidade` | string | `unit_code` |
| `nomeUnidade` | string | `unit_name` |
| `anoPca` | integer | `year` |
| `dataPublicacaoPNCP` | string (ISO 8601) | `published_at` |
| `dataAtualizacaoGlobalPCA` | string (ISO 8601) | **Watermark** → `source_global_updated_at` |
| `itens` | array | → `procurement_plan_items` (see below) |

**DTO: PlanoContratacaoItemDTO** (→ `procurement_plan_items` table)

| Field | Type | Column |
|---|---|---|
| `numeroItem` | integer | `item_number` |
| `categoriaItemPcaNome` | string | `category_name` |
| `classificacaoCatalogoId` | integer | `catalog_classification_id` |
| `nomeClassificacaoCatalogo` | string | `catalog_classification_name` |
| `classificacaoSuperiorCodigo` | string | `superior_classification_code` |
| `classificacaoSuperiorNome` | string | `superior_classification_name` |
| `pdmCodigo` | string | `pdm_code` |
| `pdmDescricao` | string | `pdm_description` |
| `codigoItem` | string | `item_code` |
| `descricaoItem` | string | `description` |
| `unidadeFornecimento` | string | `supply_unit` |
| `quantidadeEstimada` | number | `estimated_quantity` |
| `valorUnitario` | number | `unit_value` |
| `valorTotal` | number | `total_value` |
| `valorOrcamentoExercicio` | number | `budget_year_value` |
| `unidadeRequisitante` | string | `requesting_unit` |
| `dataDesejada` | string (YYYY-MM-DD) | `desired_date` |
| `grupoContratacaoCodigo` | string | `contracting_group_code` |
| `grupoContratacaoNome` | string | `contracting_group_name` |
| `dataInclusao` | string (ISO 8601) | `source_created_at` |
| `dataAtualizacao` | string (ISO 8601) | `source_updated_at` |

## 6. Contracts

**Endpoint**: `GET /consulta/v1/contratos/atualizacao`

Fetch contracts (post-procurement agreements).

**Parameters**: Same as procurements (dataInicio/dataFim, pagina, tamanhoPagina).

**Watermark**: Store max `dataAtualizacaoGlobal` in `sync_state` key `incremental:contracts`.

**DTO: RecuperarContratoDTO** (→ `contracts` table)

| Field | Type | Column |
|---|---|---|
| `numeroControlePNCP` | string | `source_id` |
| `numeroControlePncpCompra` | string | `procurement_source_id` (originating tender, if any) |
| `numeroControlePncpAta` | string | `price_registry_source_id` (if from SRP) |
| `orgaoEntidade.cnpj` | string | `agency_tax_id` |
| `orgaoEntidade.razaoSocial` | string | `agencies.name` |
| `orgaoEntidade.poderId` | string | `agencies.power_code` |
| `orgaoEntidade.esferaId` | string | `agencies.sphere_code` |
| `unidadeOrgao.codigoUnidade` | string | `unit_code` |
| `anoContrato` | integer | `year` |
| `sequencialContrato` | integer | `sequence` |
| `numeroContratoEmpenho` | string | `contract_number` |
| `processo` | string | `process_number` |
| `tipoContrato.id` | integer | `type_id` |
| `tipoContrato.nome` | string | `type_name` |
| `categoriaProcesso.id` | integer | `category_id` |
| `categoriaProcesso.nome` | string | `category_name` |
| `niFornecedor` | string | `supplier_tax_id` |
| `nomeRazaoSocialFornecedor` | string | `supplier_name` |
| `tipoPessoa` | string | `supplier_kind` |
| `codigoPaisFornecedor` | string | `supplier_country_code` |
| `niFornecedorSubContratado` | string | `subcontractor_tax_id` |
| `nomeFornecedorSubContratado` | string | `subcontractor_name` |
| `objetoContrato` | string | `description` |
| `informacaoComplementar` | string | `additional_info` |
| `receita` | boolean | `is_revenue` |
| `numeroParcelas` | integer | `installments` |
| `valorParcela` | number | `installment_value` |
| `valorInicial` | number | `initial_value` |
| `valorGlobal` | number | `global_value` |
| `valorAcumulado` | number | `accumulated_value` |
| `dataAssinatura` | string (YYYY-MM-DD) | `signed_at` |
| `dataVigenciaInicio` | string (YYYY-MM-DD) | `starts_at` |
| `dataVigenciaFim` | string (YYYY-MM-DD) | `ends_at` |
| `dataPublicacaoPncp` | string (ISO 8601) | `published_at` |
| `dataAtualizacao` | string (ISO 8601) | `source_updated_at` |
| `dataAtualizacaoGlobal` | string (ISO 8601) | **Watermark** → `source_global_updated_at` |
| `frutoAdesao` | boolean | `from_price_registry` |
| `emendaParlamentar` | boolean | `parliamentary_amendment` |
| `usuarioNome` | string | `origin_system` |

## 7. Contract Amendments

**Endpoint**: `GET /api/pncp/v1/orgaos/{cnpj}/contratos/{ano}/{sequencial}/termos`

Fetch contract modifications (additions, readjustments, extensions).

**Parameters**:
- Path: cnpj (14 digits), ano (year), sequencial (contract sequence)
- Query: `pagina` (1-indexed), `tamanhoPagina` (default 50)
- HTTP 204 ends paging

**Response**: Bare JSON array (no envelope).

**DTO: RecuperarTermoContratoDTO** (→ `contract_amendments` table)

| Field | Type | Column |
|---|---|---|
| `sequencialTermoContrato` | integer | `sequence` |
| `numeroTermoContrato` | string | `number` |
| `tipoTermoContratoNome` | string | `type_name` |
| `objetoTermoContrato` | string | `description` |
| `fundamentoLegal` | string | `legal_basis` |
| `informativoObservacao` | string | `notes` |
| `qualificacao*` | various | `qualifiers` (JSONB: {added_or_removed, term, supplier, readjustment, informative}) |
| `valorAcrescido` | number | `value_added` |
| `numeroParcelas` | integer | `installments` |
| `valorParcela` | number | `installment_value` |
| `valorGlobal` | number | `global_value` |
| `prazoAditadoDias` | integer | `extended_days` |
| `niFornecedor` | string | `supplier_tax_id` |
| `nomeRazaoSocialFornecedor` | string | `supplier_name` |
| `dataAssinatura` | string (YYYY-MM-DD) | `signed_at` |
| `dataVigenciaInicio` | string (YYYY-MM-DD) | `starts_at` |
| `dataVigenciaFim` | string (YYYY-MM-DD) | `ends_at` |
| `dataPublicacaoPncp` | string (ISO 8601) | `published_at` |
| `dataInclusao` | string (ISO 8601) | `source_created_at` |
| `dataAtualizacao` | string (ISO 8601) | `source_updated_at` |

**Syncing strategy**: Amendments are fetched on-demand. When a user views a contract, check `contracts.amendments_synced_at`. If NULL, the scheduled job `lixto contracts sync --max-amendments N` fetches and caches them.

## Error Handling

- **HTTP 200 with empty `data`**: Valid empty result; continue paging if more pages exist.
- **HTTP 204**: End of paging or no results. Increment watermark and move to next chunk.
- **HTTP 4xx (non-429)**: Do not retry. Log and continue.
- **HTTP 429**: Retry with exponential backoff (honor `Retry-After` header if present). Self-impose `LIXTO_MIN_REQUEST_INTERVAL` to avoid.
- **HTTP 5xx**: Retry with exponential backoff (max ~5 attempts). Long timeout (90s) — some 500-row pages take >60s.

## Measured Peculiarities

- **Results pagination trap**: `/itens/{item}/resultados` ignores the `pagina` parameter (verified 2026-08-24). Always fetch page 1 only.
- **Sparse fields**: `catalogoCodigoItem` (catalog code) present on <1% of items; `ncmNbsCodigo` on ~3%. Not usable for reliable joins.
- **Rate limit**: ~2 req/s observed; 429 after bursts. Lixto defaults to `LIXTO_MIN_REQUEST_INTERVAL=0.5s` (2 req/s).

## Modalidade Codes

| Code | Name |
|---|---|
| 1 | Leilão eletrônico |
| 2 | Diálogo competitivo |
| 3 | Concurso |
| 4 | Concorrência eletrônica |
| 5 | Concorrência presencial |
| 6 | Pregão eletrônico |
| 7 | Pregão presencial |
| 8 | Dispensa |
| 9 | Inexigibilidade |
| 10 | Manifestação de interesse |
| 11 | Pré-qualificação |
| 12 | Credenciamento |
| 13 | Leilão presencial |

Lixto syncs all 13 modalities incrementally.
