// Tenant-scoped queries for the empresa's habilitação documents (ticket 28).
// Every query is bound on empresa_id — always from the session
// (`requireSession()/requireAdmin()`), never taken from the request — so one
// empresa can never read or delete another's documents.
//
// Every value from the outside world is bound as a parameterized
// placeholder — never string-interpolated into SQL text.

import { pool } from "./db";
import { DOCUMENTO_TIPOS, type DocumentoTipo } from "./tenant-types";

export type SqlQuery = { text: string; values: unknown[] };

export type DocumentoRow = {
  id: number;
  empresa_id: number;
  tipo: DocumentoTipo;
  nome_arquivo: string;
  caminho: string;
  mime: string;
  tamanho_bytes: number;
  validade: Date | null;
  enviado_por: number | null;
  created_at: Date;
  /** validade IS NOT NULL AND validade < CURRENT_DATE, computed in SQL. */
  vencido: boolean;
};

export type NovoDocumento = {
  tipo: DocumentoTipo;
  nomeArquivo: string;
  caminho: string;
  mime: string;
  tamanho: number;
  /** 'YYYY-MM-DD' or null (optional validade). */
  validade: string | null;
};

// pg returns BIGSERIAL/BIGINT columns as strings (they don't fit a safe JS
// number range in general) — this is the raw shape before Number()ing them.
type DocumentoDbRow = {
  id: string;
  empresa_id: string;
  tipo: DocumentoTipo;
  nome_arquivo: string;
  caminho: string;
  mime: string;
  tamanho_bytes: string;
  validade: Date | null;
  enviado_por: string | null;
  created_at: Date;
  vencido: boolean;
};

function toDocumentoRow(row: DocumentoDbRow): DocumentoRow {
  return {
    id: Number(row.id),
    empresa_id: Number(row.empresa_id),
    tipo: row.tipo,
    nome_arquivo: row.nome_arquivo,
    caminho: row.caminho,
    mime: row.mime,
    tamanho_bytes: Number(row.tamanho_bytes),
    validade: row.validade,
    enviado_por: row.enviado_por === null ? null : Number(row.enviado_por),
    created_at: row.created_at,
    vencido: row.vencido,
  };
}

/** Throws a pt-BR error when `tipo` is not one of DOCUMENTO_TIPOS. */
export function assertTipo(tipo: string): asserts tipo is DocumentoTipo {
  if (!DOCUMENTO_TIPOS.some((t) => t.value === tipo)) {
    throw new Error("Tipo de documento inválido.");
  }
}

const VENCIDO_EXPR = "(validade IS NOT NULL AND validade < CURRENT_DATE)";

const SELECT_COLUMNS = `id, empresa_id, tipo, nome_arquivo, caminho, mime, tamanho_bytes,
       validade, enviado_por, created_at, ${VENCIDO_EXPR} AS vencido`;

export function buildListDocumentos(empresaId: number): SqlQuery {
  return {
    text: `
      SELECT ${SELECT_COLUMNS}
      FROM documento_empresa
      WHERE empresa_id = $1
      ORDER BY tipo ASC, created_at DESC
    `,
    values: [empresaId],
  };
}

export function buildGetDocumento(empresaId: number, id: number): SqlQuery {
  return {
    text: `
      SELECT ${SELECT_COLUMNS}
      FROM documento_empresa
      WHERE empresa_id = $1 AND id = $2
    `,
    values: [empresaId, id],
  };
}

export function buildDeleteDocumento(empresaId: number, id: number): SqlQuery {
  return {
    text: `DELETE FROM documento_empresa WHERE empresa_id = $1 AND id = $2 RETURNING caminho`,
    values: [empresaId, id],
  };
}

export function buildInsertDocumento(
  empresaId: number,
  usuarioId: number,
  doc: NovoDocumento,
): SqlQuery {
  assertTipo(doc.tipo);
  return {
    text: `
      INSERT INTO documento_empresa
        (empresa_id, tipo, nome_arquivo, caminho, mime, tamanho_bytes, validade, enviado_por)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING ${SELECT_COLUMNS}
    `,
    values: [
      empresaId,
      doc.tipo,
      doc.nomeArquivo,
      doc.caminho,
      doc.mime,
      doc.tamanho,
      doc.validade,
      usuarioId,
    ],
  };
}

export async function listDocumentos(empresaId: number): Promise<DocumentoRow[]> {
  const query = buildListDocumentos(empresaId);
  const result = await pool.query<DocumentoDbRow>(query.text, query.values);
  return result.rows.map(toDocumentoRow);
}

export async function getDocumento(
  empresaId: number,
  id: number,
): Promise<DocumentoRow | null> {
  const query = buildGetDocumento(empresaId, id);
  const result = await pool.query<DocumentoDbRow>(query.text, query.values);
  return result.rows[0] ? toDocumentoRow(result.rows[0]) : null;
}

/** Deletes the row and returns its `caminho` (for the caller to also delete
 * the file from disk), or null if no row matched (wrong id/empresa). */
export async function deleteDocumento(
  empresaId: number,
  id: number,
): Promise<string | null> {
  const query = buildDeleteDocumento(empresaId, id);
  const result = await pool.query<{ caminho: string }>(query.text, query.values);
  return result.rows[0]?.caminho ?? null;
}

export async function insertDocumento(
  empresaId: number,
  usuarioId: number,
  doc: NovoDocumento,
): Promise<DocumentoRow> {
  const query = buildInsertDocumento(empresaId, usuarioId, doc);
  const result = await pool.query<DocumentoDbRow>(query.text, query.values);
  return toDocumentoRow(result.rows[0]);
}
