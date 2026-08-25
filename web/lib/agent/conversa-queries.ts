// Persistence for chat conversations (migration 012, ticket 68).
//
// Relative imports (not "@/lib/...") on purpose: vitest runs without a config
// file, so the tsconfig "@/" alias is not resolvable from lib tests.
//
// Tenant rule (docs/TENANT.md): `usuarioId` and `empresaId` always come from
// the session. `getConversa` binds `usuario_id` in the WHERE clause instead of
// checking it in JS, so a guessed `conversaId` reads as "not found".

import { pool } from "../db";
import type { LicitacaoRef } from "./types";

export type Conversa = {
  id: number;
  empresa_id: number;
  usuario_id: number;
  titulo: string | null;
  created_at: string;
  updated_at: string;
};

export type MensagemRole = "user" | "assistant" | "tool";

/** The assistant-side record of one function call, as stored in `tool_calls`. */
export type MensagemToolCall = {
  id: string;
  name: string;
  arguments: string;
};

export type Mensagem = {
  id: number;
  conversa_id: number;
  role: MensagemRole;
  conteudo: string | null;
  tool_calls: MensagemToolCall[] | null;
  tool_call_id: string | null;
  refs: LicitacaoRef[] | null;
  modelo: string | null;
  created_at: string;
};

export type MensagemInput = {
  role: MensagemRole;
  conteudo: string | null;
  tool_calls?: MensagemToolCall[] | null;
  tool_call_id?: string | null;
  refs?: LicitacaoRef[] | null;
  modelo?: string | null;
};

type ConversaRow = Omit<Conversa, "id" | "empresa_id" | "usuario_id"> & {
  id: string;
  empresa_id: string;
  usuario_id: string;
};

type MensagemRow = Omit<Mensagem, "id" | "conversa_id"> & {
  id: string;
  conversa_id: string;
};

// BIGSERIAL comes back from node-pg as a string; the app talks in numbers.
function toConversa(row: ConversaRow): Conversa {
  return {
    ...row,
    id: Number(row.id),
    empresa_id: Number(row.empresa_id),
    usuario_id: Number(row.usuario_id),
  };
}

function toMensagem(row: MensagemRow): Mensagem {
  return { ...row, id: Number(row.id), conversa_id: Number(row.conversa_id) };
}

const CONVERSA_COLS = `id, empresa_id, usuario_id, titulo, created_at, updated_at`;
const MENSAGEM_COLS = `id, conversa_id, role, conteudo, tool_calls, tool_call_id, refs, modelo, created_at`;

export async function createConversa(
  empresaId: number,
  usuarioId: number,
  titulo: string | null,
): Promise<Conversa> {
  const { rows } = await pool.query<ConversaRow>(
    `INSERT INTO conversa (empresa_id, usuario_id, titulo)
          VALUES ($1, $2, $3)
       RETURNING ${CONVERSA_COLS}`,
    [empresaId, usuarioId, titulo],
  );
  return toConversa(rows[0]);
}

/** Null unless the conversation belongs to `usuarioId` — both ids are bound. */
export async function getConversa(
  id: number,
  usuarioId: number,
): Promise<Conversa | null> {
  const { rows } = await pool.query<ConversaRow>(
    `SELECT ${CONVERSA_COLS} FROM conversa WHERE id = $1 AND usuario_id = $2`,
    [id, usuarioId],
  );
  return rows[0] ? toConversa(rows[0]) : null;
}

export async function listConversas(
  usuarioId: number,
  limit = 20,
): Promise<Conversa[]> {
  const { rows } = await pool.query<ConversaRow>(
    `SELECT ${CONVERSA_COLS}
       FROM conversa
      WHERE usuario_id = $1
      ORDER BY updated_at DESC
      LIMIT $2`,
    [usuarioId, limit],
  );
  return rows.map(toConversa);
}

export async function appendMensagem(
  conversaId: number,
  msg: MensagemInput,
): Promise<Mensagem> {
  const { rows } = await pool.query<MensagemRow>(
    `INSERT INTO mensagem (conversa_id, role, conteudo, tool_calls, tool_call_id, refs, modelo)
          VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING ${MENSAGEM_COLS}`,
    [
      conversaId,
      msg.role,
      msg.conteudo,
      // JSONB columns: node-pg would send a JS array as a Postgres array
      // literal, so serialize explicitly.
      msg.tool_calls ? JSON.stringify(msg.tool_calls) : null,
      msg.tool_call_id ?? null,
      msg.refs ? JSON.stringify(msg.refs) : null,
      msg.modelo ?? null,
    ],
  );
  return toMensagem(rows[0]);
}

/** Oldest first — the order the model expects to replay history in. */
export async function listMensagens(
  conversaId: number,
  limit = 40,
): Promise<Mensagem[]> {
  const { rows } = await pool.query<MensagemRow>(
    `SELECT ${MENSAGEM_COLS} FROM (
       SELECT ${MENSAGEM_COLS} FROM mensagem
        WHERE conversa_id = $1
        ORDER BY id DESC
        LIMIT $2
     ) recentes
     ORDER BY id ASC`,
    [conversaId, limit],
  );
  return rows.map(toMensagem);
}

export async function touchConversa(id: number): Promise<void> {
  await pool.query(`UPDATE conversa SET updated_at = now() WHERE id = $1`, [id]);
}

/** `porte` for the tool context (ME/EPP eligibility). Not on the session
 * because `Session` is shared with pages that don't need it. */
export async function getEmpresaPorte(
  empresaId: number,
): Promise<string | null> {
  const { rows } = await pool.query<{ porte: string | null }>(
    `SELECT porte FROM empresa WHERE id = $1`,
    [empresaId],
  );
  return rows[0]?.porte ?? null;
}
