// POST /api/internal/email/bounces — ingest the MTA's DSN maildir (ticket 120).
//
// Internal: the `x-lixto-internal-token` shared secret, not a session, exactly
// like the send/digest routes. A Dokploy schedule pokes it through the CLI
// (`lixto email bounces`), a few minutes after each worker pass.
//
// The maildir is `LIXTO_BOUNCE_MAILDIR` (default /var/db/mail/bounces) and it
// is NOT a body parameter: the path is infrastructure, and letting a caller
// name a directory would turn an internal trigger into a file-system probe.
// The web container must mount the same volume the MTA writes it to; when it
// does not, the run reports zeros instead of failing.
//
// Relative imports (not "@/lib/..."): vitest resolves no path alias, and this
// route is covered by lib/email/bounces.test.ts.

import { ingestBounces } from "../../../../../lib/email/bounces";
import { isInternalRequest } from "../../../../../lib/internal-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/** A backlog of DSNs is read and settled one row at a time; give it the same
 * room as the other internal email routes. */
export const maxDuration = 300;

export async function POST(request: Request) {
  if (!isInternalRequest(request)) {
    return Response.json({ error: "não autorizado" }, { status: 401 });
  }

  try {
    // A missing maildir and an unreadable DSN are both normal outcomes with
    // counters of their own; only the database failing reaches this catch.
    const result = await ingestBounces();
    return Response.json(result);
  } catch (err) {
    console.error("[api/internal/email/bounces] ingestion failed", err);
    return Response.json(
      { error: "falha ao processar os retornos de e-mail" },
      { status: 500 },
    );
  }
}
