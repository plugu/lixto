"use server";

// Server action behind the ⌘K palette's "Licitações" group (ticket 149).
// Called directly from the client component on every debounced keystroke, so
// it takes a plain string rather than (prevState, formData).
//
// Procurements are public data — the session is required to keep the action
// off the open internet, but it does not scope the query (see the comment in
// lib/command-search-queries.ts about tenant isolation).

import { requireSession } from "@/lib/auth";
import {
  COMMAND_SEARCH_MIN_CHARS,
  searchProcurementsForPalette,
  type CommandSearchRow,
} from "@/lib/command-search-queries";

export async function paletteSearchAction(
  q: string,
): Promise<CommandSearchRow[]> {
  await requireSession();

  const trimmed = q.trim();
  if (trimmed.length < COMMAND_SEARCH_MIN_CHARS) return [];

  return searchProcurementsForPalette(trimmed);
}
