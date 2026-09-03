// /email/unsubscribe?email=&token= — the daily-digest footer link
// (templates.ts renderDailyDigest). Public: proxy.ts lists this prefix, so the
// link works from a logged-out inbox with its query string intact.
//
// GET never mutates. Inbox link scanners and "safe links" proxies fetch every
// URL in a message, and a GET that suppressed on sight would silently opt users
// out of all mail (ADR 002 §D4 suppression is address-wide). So GET only
// renders a pt-BR confirmation form, and POST — the same verb Gmail/Yahoo
// one-click uses, hence `email`/`token` accepted from the query string *or* an
// application/x-www-form-urlencoded body — performs the suppression
// (outbox.ts `suppress`, ticket 108). Anything unsigned is a neutral 400 with
// no side effect. "@/" aliases are fine here — app/ files are compiled by Next.

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

function invalid(): Response {
  return page(
    `<p>Não foi possível processar este link. Verifique se o endereço está completo e tente novamente.</p>`,
    400,
  );
}

type Credentials = { email: string | null; token: string | null };

/** One-click senders POST to the URL as-is (credentials in the query) while our
 * own confirmation form posts them in the body; accept both. */
async function readCredentials(request: Request): Promise<Credentials> {
  const { searchParams } = new URL(request.url);
  let email = searchParams.get("email");
  let token = searchParams.get("token");

  if (request.method === "POST" && (!email || !token)) {
    let body: URLSearchParams | null = null;
    try {
      body = new URLSearchParams(await request.text());
    } catch {
      body = null;
    }
    email = email ?? body?.get("email") ?? null;
    token = token ?? body?.get("token") ?? null;
  }

  return { email, token };
}

export async function GET(request: Request): Promise<Response> {
  const { email, token } = await readCredentials(request);

  if (!email || !token || !verifyUnsubscribeToken(email, token)) {
    return invalid();
  }

  // No suppression here — only the form that asks for the POST.
  return page(
    `<p>Confirme o cancelamento: o endereço <strong>${escapeHtml(
      email,
    )}</strong> deixará de receber o resumo diário do Lixto.</p>
    <form method="post" action="/email/unsubscribe">
      <input type="hidden" name="email" value="${escapeHtml(email)}" />
      <input type="hidden" name="token" value="${escapeHtml(token)}" />
      <button type="submit" style="margin-top: 16px; padding: 10px 20px; font-size: 15px; border: 0; border-radius: 6px; background-color: #2563eb; color: #ffffff; cursor: pointer;">Cancelar o resumo diário</button>
    </form>`,
  );
}

export async function POST(request: Request): Promise<Response> {
  const { email, token } = await readCredentials(request);

  if (!email || !token || !verifyUnsubscribeToken(email, token)) {
    return invalid();
  }

  await suppress(email, "unsubscribe");

  return page(
    `<p>Pronto — o endereço <strong>${escapeHtml(email)}</strong> não receberá mais o resumo diário do Lixto.</p>`,
  );
}
