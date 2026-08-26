// Shared types for the chat agent's tool layer.
//
// The contract between three layers: tools.ts produces `ToolResult`, the model
// loop (run.ts) serializes `data` into the conversation, and the chat UI
// renders `refs` as cards. Keep `data` small — it is billed per token.

import type { Reason } from "../match-engine";
import type { ProcurementStatus } from "../status";

/** Everything a tool may know about who is asking. `companyId` is sourced
 * from the session (`requireSession()`) by the caller and never from tool
 * arguments — the tenant rule in docs/TENANT.md. */
export type ToolContext = {
  companyId: number;
  /** `companies.size` (MEI/ME/EPP/MEDIUM/LARGE). */
  size: string | null;
  companyName: string;
};

/** The compact card shape: what the UI renders and what the model cites when
 * it refers to "a segunda". Always derived from a query module's row, never
 * from model output. Keyed by `procurements.source_id`. */
export type ProcurementRef = {
  source_id: string;
  description: string | null;
  agency: string | null;
  state: string | null;
  city: string | null;
  modality: string | null;
  estimated_value: string | null;
  /** ISO-8601 (`proposal_closes_at`), or null when not informed. */
  closes_at: string | null;
  status: ProcurementStatus;
  score?: number;
  reasons?: Reason[];
  /** How this row surfaced when the search embedded free text: matched the
   * keyword/FTS branch, the semantic (vector) branch, or both. Absent when
   * the row didn't come from a hybrid search. */
  match_kind?: "keyword" | "semantic" | "both";
};

export type ToolResult =
  | { ok: true; data: unknown; refs: ProcurementRef[] }
  | { ok: false; error: string };

/** OpenAI-style function-calling declaration. `parameters` is a JSON Schema
 * object; descriptions are in PT-BR so the model maps Brazilian phrasing. */
export type ToolDefinition = {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
};
