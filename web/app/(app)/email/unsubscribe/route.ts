// GET /email/unsubscribe?email=&token= — the daily-digest footer link
// (templates.ts renderDailyDigest). A valid token suppresses the address
// (outbox.ts `suppress`, ticket 108); anything else is a neutral 400 with no
// side effect. "@/" aliases are fine here — app/ files are compiled by Next.

import { escapeHtml } from "@/lib/email/layout";
import { suppress } from "@/lib/email/outbox";
import { verifyUnsubscribeToken } from "@/lib/email/unsubscribe";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function page(body: string, status = 200): Response {
  return new Response(
    `<!doctype html>
<html lang="pt-BR">
  <head>
    <meta charset="utf-8" />
    <title>Lixto</title>
  </head>
  <body style="font-family: system-ui, sans-serif; max-width: 480px; margin: 64px auto; color: #111827;">
    ${body}
  </body>
</html>`,
    { status, headers: { "content-type": "text/html; charset=utf-8" } },
  );
}

export async function GET(request: Request): Promise<Response> {
  const { searchParams } = new URL(request.url);
  const email = searchParams.get("email");
  const token = searchParams.get("token");

  if (!email || !token || !verifyUnsubscribeToken(email, token)) {
    return page(
      `<p>Não foi possível processar este link. Verifique se o endereço está completo e tente novamente.</p>`,
      400,
    );
  }

  await suppress(email, "unsubscribe");

  return page(
    `<p>Pronto — o endereço <strong>${escapeHtml(email)}</strong> não receberá mais o resumo diário do Lixto.</p>`,
  );
}
