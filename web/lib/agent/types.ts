// Shared types for the chat agent's tool layer (ticket 67).
//
// The contract between three tickets: tools.ts produces `ToolResult`, the
// model loop (68) serializes `data` into the conversation, and the chat UI
// (69) renders `refs` as cards. Keep `data` small — it is billed per token.

import type { Motivo } from "../match-engine";
import type { StatusLicitacao } from "../status";

/** Everything a tool may know about who is asking. `empresaId` is sourced
 * from the session (`requireSession()`) by the caller and never from tool
 * arguments — the tenant rule in docs/TENANT.md. */
export type ToolContext = {
  empresaId: number;
  porte: string | null;
  empresaNome: string;
};

/** The compact card shape: what the UI renders and what the model cites when
 * it refers to "a segunda". Always derived from a query module's row, never
 * from model output. */
export type LicitacaoRef = {
  numero_controle_pncp: string;
  objeto: string | null;
  orgao: string | null;
  uf: string | null;
  municipio: string | null;
  modalidade: string | null;
  valor_estimado: string | null;
  /** ISO-8601 (`data_encerramento_proposta`), or null when not informed. */
  encerramento: string | null;
  status: StatusLicitacao;
  score?: number;
  motivos?: Motivo[];
};

export type ToolResult =
  | { ok: true; data: unknown; refs: LicitacaoRef[] }
  | { ok: false; erro: string };

/** OpenAI-style function-calling declaration. `parameters` is a JSON Schema
 * object; descriptions are in PT-BR so the model maps Brazilian phrasing. */
export type ToolDefinition = {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
};
