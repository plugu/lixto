// POST /api/internal/radar/run — one Radar detection pass (PRODUCT.md, cycle 24).
//
// Internal: guarded by the `x-lixto-internal-token` shared secret, not by a
// session, and it never reads a companyId from a browser (the optional one in
// the body is an operator's "just this company" switch, used by the CLI).
// "@/" aliases are fine here — app/ files are compiled by Next.

import { isInternalRequest } from "@/lib/internal-auth";
import { runRadarBatch } from "@/lib/radar-batch";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/** Scanning the whole PCA horizon can take minutes; the default 15s would cut
 * it off. */
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

  // Parsed and passed through now so the contract does not change when ticket
  // 126 makes detection also score that company's matches.
  const companyId =
    typeof body.companyId === "number" && Number.isFinite(body.companyId)
      ? body.companyId
      : undefined;

  try {
    const result = await runRadarBatch({ companyId });
    return Response.json(result);
  } catch (err) {
    console.error("[api/internal/radar/run] batch failed", err);
    return Response.json({ error: "falha ao rodar o radar" }, { status: 500 });
  }
}
