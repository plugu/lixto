// Tenant-scoped queries for the company's habilitação documents (table
// `company_documents`). Every query is bound on company_id — always from the
// session (`requireSession()/requireAdmin()`), never taken from the request —
// so one company can never read or delete another's documents.
//
// Every value from the outside world is bound as a parameterized
// placeholder — never string-interpolated into SQL text.

import { pool } from "./db";
import { DOCUMENT_KINDS, type DocumentKind } from "./types";

export type SqlQuery = { text: string; values: unknown[] };

export type DocumentRow = {
  id: number;
  company_id: number;
  kind: DocumentKind;
  file_name: string;
  storage_path: string;
  mime_type: string;
  size_bytes: number;
  valid_until: Date | null;
  uploaded_by: number | null;
  created_at: Date;
  /** valid_until IS NOT NULL AND valid_until < CURRENT_DATE, computed in SQL. */
  expired: boolean;
};

export type NewDocument = {
  kind: DocumentKind;
  fileName: string;
  storagePath: string;
  mimeType: string;
  sizeBytes: number;
  /** 'YYYY-MM-DD' or null (validade is optional). */
  validUntil: string | null;
};

// pg returns BIGSERIAL/BIGINT columns as strings (they don't fit a safe JS
// number range in general) — this is the raw shape before Number()ing them.
type DocumentDbRow = {
  id: string;
  company_id: string;
  kind: DocumentKind;
  file_name: string;
  storage_path: string;
  mime_type: string;
  size_bytes: string;
  valid_until: Date | null;
  uploaded_by: string | null;
  created_at: Date;
  expired: boolean;
};

function toDocumentRow(row: DocumentDbRow): DocumentRow {
  return {
    id: Number(row.id),
    company_id: Number(row.company_id),
    kind: row.kind,
    file_name: row.file_name,
    storage_path: row.storage_path,
    mime_type: row.mime_type,
    size_bytes: Number(row.size_bytes),
    valid_until: row.valid_until,
    uploaded_by: row.uploaded_by === null ? null : Number(row.uploaded_by),
    created_at: row.created_at,
    expired: row.expired,
  };
}

/** Throws a pt-BR error when `kind` is not one of DOCUMENT_KINDS. */
export function assertKind(kind: string): asserts kind is DocumentKind {
  if (!DOCUMENT_KINDS.some((k) => k.value === kind)) {
    throw new Error("Tipo de documento inválido.");
  }
}

const EXPIRED_EXPR =
  "(valid_until IS NOT NULL AND valid_until < CURRENT_DATE)";

const SELECT_COLUMNS = `id, company_id, kind, file_name, storage_path, mime_type, size_bytes,
       valid_until, uploaded_by, created_at, ${EXPIRED_EXPR} AS expired`;

export function buildListDocuments(companyId: number): SqlQuery {
  return {
    text: `
      SELECT ${SELECT_COLUMNS}
      FROM company_documents
      WHERE company_id = $1
      ORDER BY kind ASC, created_at DESC
    `,
    values: [companyId],
  };
}

export function buildGetDocument(companyId: number, id: number): SqlQuery {
  return {
    text: `
      SELECT ${SELECT_COLUMNS}
      FROM company_documents
      WHERE company_id = $1 AND id = $2
    `,
    values: [companyId, id],
  };
}

export function buildDeleteDocument(companyId: number, id: number): SqlQuery {
  return {
    text: `DELETE FROM company_documents WHERE company_id = $1 AND id = $2 RETURNING storage_path`,
    values: [companyId, id],
  };
}

export function buildInsertDocument(
  companyId: number,
  userId: number,
  doc: NewDocument,
): SqlQuery {
  assertKind(doc.kind);
  return {
    text: `
      INSERT INTO company_documents
        (company_id, kind, file_name, storage_path, mime_type, size_bytes, valid_until, uploaded_by)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING ${SELECT_COLUMNS}
    `,
    values: [
      companyId,
      doc.kind,
      doc.fileName,
      doc.storagePath,
      doc.mimeType,
      doc.sizeBytes,
      doc.validUntil,
      userId,
    ],
  };
}

export async function listDocuments(
  companyId: number,
): Promise<DocumentRow[]> {
  const query = buildListDocuments(companyId);
  const result = await pool.query<DocumentDbRow>(query.text, query.values);
  return result.rows.map(toDocumentRow);
}

export async function getDocument(
  companyId: number,
  id: number,
): Promise<DocumentRow | null> {
  const query = buildGetDocument(companyId, id);
  const result = await pool.query<DocumentDbRow>(query.text, query.values);
  return result.rows[0] ? toDocumentRow(result.rows[0]) : null;
}

/** Deletes the row and returns its `storage_path` (for the caller to also
 * delete the file from disk), or null if no row matched (wrong id/company). */
export async function deleteDocument(
  companyId: number,
  id: number,
): Promise<string | null> {
  const query = buildDeleteDocument(companyId, id);
  const result = await pool.query<{ storage_path: string }>(
    query.text,
    query.values,
  );
  return result.rows[0]?.storage_path ?? null;
}

export async function insertDocument(
  companyId: number,
  userId: number,
  doc: NewDocument,
): Promise<DocumentRow> {
  const query = buildInsertDocument(companyId, userId, doc);
  const result = await pool.query<DocumentDbRow>(query.text, query.values);
  return toDocumentRow(result.rows[0]);
}
