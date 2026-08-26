// POST /api/internal/recommend/run — one bounded GO/NO-GO pass (PRODUCT §2).
//
// Internal: guarded by the `x-lixto-internal-token` shared secret, not by a
// session, and it never reads a companyId from a browser (the optional one in
// the body is an operator's "just this company" switch, used by the CLI).
// "@/" aliases are fine here — app/ files are compiled by Next.

import { isInternalRequest } from "@/lib/internal-auth";
import { runRecommendBatch } from "@/lib/recommend";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/** Up to 5 Tier-3 calls per company; the default 15s would cut it off. */
export const maxDuration = 300;

type PostBody = {
  companyId?: unknown;
  limit?: unknown;
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

  let limit: number | undefined;
  if (body.limit !== undefined) {
    if (
      typeof body.limit !== "number" ||
      !Number.isFinite(body.limit) ||
      body.limit < 1
    ) {
      return Response.json({ error: "limit inválido" }, { status: 400 });
    }
    limit = Math.floor(body.limit);
  }

  try {
    const result = await runRecommendBatch({ companyId, limit });
    return Response.json(result);
  } catch (err) {
    console.error("[api/internal/recommend/run] batch failed", err);
    return Response.json(
      { error: "falha ao rodar as recomendações" },
      { status: 500 },
    );
  }
}
