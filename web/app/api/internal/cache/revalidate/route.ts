// POST /api/internal/cache/revalidate — drops one or more cache tags
// (PRODUCT cycle 31). The invalidation source of truth is the sync: `lixto
// sync incremental` calls this at the end of every run (also on partial
// failure); `lixto cache revalidate` is the manual trigger. The TTL fallback
// (`LIXTO_WEB_CACHE_TTL_SECONDS`) covers a sync that dies before the call.
//
// Internal: guarded by the `x-lixto-internal-token` shared secret, not by a
// session.
//
// Relative imports (not "@/lib/..."): vitest resolves no path alias, and
// this route mirrors app/api/internal/cases/run/route.ts, which is tested
// the same way.

import { CACHE_TAGS, invalidateTags } from "../../../../../lib/cache";
import { isInternalRequest } from "../../../../../lib/internal-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const KNOWN_TAGS = new Set<string>(Object.values(CACHE_TAGS));

type PostBody = {
  tags?: unknown;
};

export async function POST(request: Request) {
  if (!isInternalRequest(request)) {
    return Response.json({ error: "não autorizado" }, { status: 401 });
  }

  // An empty body is the normal case (the sync's default "drop sync").
  let body: PostBody = {};
  try {
    body = ((await request.json()) as PostBody) ?? {};
  } catch {
    body = {};
  }

  const tags = Array.isArray(body.tags) ? (body.tags as unknown[]) : ["sync"];

  for (const tag of tags) {
    if (typeof tag !== "string" || !KNOWN_TAGS.has(tag)) {
      return Response.json({ error: "tag inválida" }, { status: 400 });
    }
  }

  const dropped = invalidateTags(tags as string[]);
  return Response.json({ revalidated: tags, dropped });
}
