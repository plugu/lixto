// COMPAT SHIM (ticket 80) — the real tenant types now live in ./types.ts.
// Legacy modules this ticket does not own (lib/cnpj-lookup.ts, lib/agent/*,
// components/perfil-match-form.tsx, components/chat/quick-filters.tsx,
// app/(app)/empresa/perfil/*) still import from "@/lib/tenant-types".
// Ticket 82 replaces those callers and deletes this file.

export { UF_LIST } from "./types";

/** Legacy porte union (`MEDIO`/`GRANDE` instead of the schema's
 * `MEDIUM`/`LARGE`) — kept only for `lib/cnpj-lookup.ts`, whose BrasilAPI
 * mapping this ticket may not touch. Mapped to `CompanySize` at the signup
 * boundary (app/(app)/signup/actions.ts). */
export type Porte = "MEI" | "ME" | "EPP" | "MEDIO" | "GRANDE";
