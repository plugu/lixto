// POST /api/internal/email/digest — enqueue today's daily digest (PRODUCT §6).
//
// Internal: the `x-lixto-internal-token` shared secret, not a session. The
// Dokploy schedule hits it after `recommend-run` through the CLI (ticket
// 113); the optional `{ companyId }` is an operator's "just this company"
// switch.
//
// Relative imports (not "@/lib/..."): vitest resolves no path alias, and this
// route mirrors app/api/internal/email/send/route.ts.

import { runDigestBatch } from "../../../../../lib/email/digest-batch";
import { isInternalRequest } from "../../../../../lib/internal-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/** One company at a time, but there can be many; give the batch room next to
 * the other internal routes. */
export const maxDuration = 300;

type PostBody = {
  companyId?: unknown;
};

export async function POST(request: Request) {
  if (!isInternalRequest(request)) {
    return Response.json({ error: "não autorizado" }, { status: 401 });
  }

  // An empty body is the normal case (the scheduled global run).
  let body: PostBody = {};
  try {
    body = ((await request.json()) as PostBody) ?? {};
  } catch {
    body = {};
  }

  const companyId =
    typeof body.companyId === "number" && Number.isFinite(body.companyId)
      ? body.companyId
      : undefined;

  try {
    const result = await runDigestBatch({ companyId });
    return Response.json(result);
  } catch (err) {
    console.error("[api/internal/email/digest] batch failed", err);
    return Response.json(
      { error: "falha ao enfileirar o resumo diário" },
      { status: 500 },
    );
  }
}
