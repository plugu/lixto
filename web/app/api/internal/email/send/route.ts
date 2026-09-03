// POST /api/internal/email/send — one pass of the outbox worker (PRODUCT §6).
//
// Internal: the `x-lixto-internal-token` shared secret, not a session. The
// Dokploy schedule hits it every 5 minutes through the CLI (ticket 113); the
// optional `{ limit }` is an operator's "just drain a few" switch.
//
// Relative imports (not "@/lib/..."): vitest resolves no path alias, and this
// route is covered by lib/email/sender.test.ts.

import { runEmailWorker } from "../../../../../lib/email/sender";
import { isInternalRequest } from "../../../../../lib/internal-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/** Postfix is rate-limited to ~4 msg/min, so a full batch of 20 outlives the
 * default 15s budget. */
export const maxDuration = 300;

type PostBody = {
  limit?: unknown;
};

export async function POST(request: Request) {
  if (!isInternalRequest(request)) {
    return Response.json({ error: "não autorizado" }, { status: 401 });
  }

  // An empty body is the normal case (the scheduled drain).
  let body: PostBody = {};
  try {
    body = ((await request.json()) as PostBody) ?? {};
  } catch {
    body = {};
  }

  let limit: number | undefined;
  if (body.limit !== undefined) {
    if (typeof body.limit !== "number" || !Number.isFinite(body.limit)) {
      return Response.json({ error: "limit inválido" }, { status: 400 });
    }
    limit = body.limit;
  }

  try {
    // A dead MTA is not an error here: the worker returns counts and the rows
    // go back to 'queued' with backoff. Only the outbox failing reaches this.
    const result = await runEmailWorker({ limit });
    return Response.json(result);
  } catch (err) {
    console.error("[api/internal/email/send] worker failed", err);
    return Response.json(
      { error: "falha ao processar a fila de e-mail" },
      { status: 500 },
    );
  }
}
