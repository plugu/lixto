// POST /api/internal/match/run — one batch match pass (PRODUCT §1).
//
// Internal: guarded by the `x-lixto-internal-token` shared secret, not by a
// session, and it never reads a companyId from a browser (the optional one in
// the body is an operator's "just this company" switch, used by the CLI).
// "@/" aliases are fine here — app/ files are compiled by Next.

import { isInternalRequest } from "@/lib/internal-auth";
import { runMatchBatch } from "@/lib/match-batch";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/** Scoring every company can take minutes; the default 15s would cut it off. */
export const maxDuration = 300;

type PostBody = {
  companyId?: unknown;
  since?: unknown;
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

  let since: Date | undefined;
  if (typeof body.since === "string") {
    const parsed = new Date(body.since);
    if (Number.isNaN(parsed.getTime())) {
      return Response.json({ error: "since inválido" }, { status: 400 });
    }
    since = parsed;
  }

  try {
    const result = await runMatchBatch({ companyId, since });
    return Response.json(result);
  } catch (err) {
    console.error("[api/internal/match/run] batch failed", err);
    return Response.json({ error: "falha ao rodar o match" }, { status: 500 });
  }
}
