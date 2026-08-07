// SQL for the detail page (ticket 09): one licitação plus its itens and
// documentos, all keyed by numero_controle_pncp.
//
// Every value from the outside world (the route param) is bound as a
// parameterized placeholder — never string-interpolated into SQL text.

import { pool } from "./db";

export type LicitacaoDetail = {
  numero_controle_pncp: string;
  ano_compra: number | null;
  sequencial_compra: number | null;
  processo: string | null;
  orgao_cnpj: string | null;
  orgao_razao_social: string | null;
  unidade_nome: string | null;
  uf: string | null;
  municipio_nome: string | null;
  modalidade_nome: string | null;
  modo_disputa_nome: string | null;
  situacao_compra_nome: string | null;
  amparo_legal_nome: string | null;
  objeto_compra: string | null;
  informacao_complementar: string | null;
  srp: boolean | null;
  valor_total_estimado: string | null;
  valor_total_homologado: string | null;
  data_publicacao_pncp: Date | null;
  data_abertura_proposta: Date | null;
  data_encerramento_proposta: Date | null;
  link_sistema_origem: string | null;
};

export type ItemRow = {
  numero_item: number;
  descricao: string | null;
  quantidade: string | null;
  unidade_medida: string | null;
  valor_unitario_estimado: string | null;
  valor_total: string | null;
  situacao_compra_item_nome: string | null;
  tipo_beneficio_nome: string | null;
};

export type DocumentoRow = {
  sequencial_documento: number;
  titulo: string | null;
  tipo_documento_id: number | null;
  tipo_documento_nome: string | null;
  url: string | null;
};

/** Fetches a single licitação's dados completos, or null if it doesn't exist. */
export async function fetchLicitacaoDetail(
  numeroControlePncp: string,
): Promise<LicitacaoDetail | null> {
  const result = await pool.query<LicitacaoDetail>(
    `SELECT
       numero_controle_pncp, ano_compra, sequencial_compra, processo,
       orgao_cnpj, orgao_razao_social, unidade_nome, uf, municipio_nome,
       modalidade_nome, modo_disputa_nome, situacao_compra_nome, amparo_legal_nome,
       objeto_compra, informacao_complementar, srp,
       valor_total_estimado, valor_total_homologado,
       data_publicacao_pncp, data_abertura_proposta, data_encerramento_proposta,
       link_sistema_origem
     FROM licitacao
     WHERE numero_controle_pncp = $1`,
    [numeroControlePncp],
  );
  return result.rows[0] ?? null;
}

/** Fetches all itens for a licitação, ordered by numero_item. */
export async function fetchItens(
  numeroControlePncp: string,
): Promise<ItemRow[]> {
  const result = await pool.query<ItemRow>(
    `SELECT
       numero_item, descricao, quantidade, unidade_medida,
       valor_unitario_estimado, valor_total,
       situacao_compra_item_nome, tipo_beneficio_nome
     FROM item
     WHERE numero_controle_pncp = $1
     ORDER BY numero_item ASC`,
    [numeroControlePncp],
  );
  return result.rows;
}

/** Fetches active documentos for a licitação, ordered by sequencial.
 * Grouping into Edital (tipo_documento_id = 2) vs Anexos is a presentation
 * concern handled by the DocumentosList component. */
export async function fetchDocumentos(
  numeroControlePncp: string,
): Promise<DocumentoRow[]> {
  const result = await pool.query<DocumentoRow>(
    `SELECT sequencial_documento, titulo, tipo_documento_id, tipo_documento_nome, url
     FROM documento
     WHERE numero_controle_pncp = $1 AND status_ativo = true
     ORDER BY sequencial_documento ASC`,
    [numeroControlePncp],
  );
  return result.rows;
}
