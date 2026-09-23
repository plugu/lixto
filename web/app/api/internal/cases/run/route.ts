// POST /api/internal/cases/run — one pass of the case agent (PRODUCT, cycle
// 30): GO recommendations become cases, cases with a dossier get their
// habilitação verdict.
//
// Internal: guarded by the `x-lixto-internal-token` shared secret, not by a
// session, and it never reads a companyId from a browser (the optional one in
// the body is an operator's "just this company" switch, used by the CLI).
//
// Relative imports (not "@/lib/..."): vitest resolves no path alias, and this
// route mirrors app/api/internal/email/digest/route.ts, which is tested the
// same way.

import { runCaseBatch } from "../../../../../lib/case-batch";
import { isInternalRequest } from "../../../../../lib/internal-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/** A pass touches every waiting case (dossier read + verdict write); the
 * default 15s would cut it off. */
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
    const result = await runCaseBatch({ companyId });
    return Response.json(result);
  } catch (err) {
    console.error("[api/internal/cases/run] batch failed", err);
    return Response.json({ error: "falha ao rodar os casos" }, { status: 500 });
  }
}
