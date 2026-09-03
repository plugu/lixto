// Shared HTML layout for transactional/digest email (ticket 110).
//
// Table-based, inline-styles-only markup: many mail clients strip <style>
// blocks and external images, so nothing here relies on either. Kept free of
// DB/network access — `renderLayout`/`renderButton`/`escapeHtml` are pure
// string builders consumed by templates.ts, which the outbox worker (108)
// calls at send time from a persisted JSONB payload.

export const COLOR_INK = "#111827";
export const COLOR_MUTED = "#6b7280";
export const COLOR_ACCENT = "#2563eb";
export const COLOR_BORDER = "#e5e7eb";

const FONT_STACK =
  "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

/** Escapes `&`, `<`, `>`, `"` and `'` for safe interpolation into HTML. */
export function escapeHtml(value: string): string {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export type LayoutOptions = {
  /** `<title>` and, absent an explicit `preheader`, the inbox preview text. */
  title: string;
  bodyHtml: string;
  /** Rendered below a divider inside the card. Omit for transactional mail
   * that must not carry an unsubscribe/footer link. */
  footerHtml?: string;
  /** Hidden preview text shown by inbox clients next to the subject. */
  preheader?: string;
};

/** Full HTML document: table layout, max-width 600px, system font stack,
 * the Lixto wordmark as plain text (no logo image), and a hidden preheader
 * span for inbox preview text. */
export function renderLayout({
  title,
  bodyHtml,
  footerHtml,
  preheader,
}: LayoutOptions): string {
  const safeTitle = escapeHtml(title);
  const preheaderText = preheader ?? title;
  const preheaderHtml = `<span style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;color:${COLOR_BORDER};mso-hide:all;">${escapeHtml(
    preheaderText,
  )}</span>`;

  const footerRow = footerHtml
    ? `<tr>
          <td style="padding:16px 32px 28px 32px;border-top:1px solid ${COLOR_BORDER};font-family:${FONT_STACK};font-size:12px;line-height:1.6;color:${COLOR_MUTED};">
            ${footerHtml}
          </td>
        </tr>`
    : "";

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<meta name="color-scheme" content="light" />
<title>${safeTitle}</title>
</head>
<body style="margin:0;padding:0;background-color:#f3f4f6;">
${preheaderHtml}
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background-color:#f3f4f6;">
  <tr>
    <td align="center" style="padding:24px 16px;">
      <table role="presentation" width="600" cellspacing="0" cellpadding="0" border="0" style="max-width:600px;width:100%;background-color:#ffffff;border:1px solid ${COLOR_BORDER};border-radius:8px;">
        <tr>
          <td style="padding:28px 32px 0 32px;">
            <div style="font-family:${FONT_STACK};font-size:18px;font-weight:700;color:${COLOR_INK};">Lixto</div>
          </td>
        </tr>
        <tr>
          <td style="padding:16px 32px 28px 32px;font-family:${FONT_STACK};font-size:15px;line-height:1.6;color:${COLOR_INK};">
            ${bodyHtml}
          </td>
        </tr>
        ${footerRow}
      </table>
    </td>
  </tr>
</table>
</body>
</html>`;
}

/** "Bulletproof" table-cell button — no `<button>`/box-shadow tricks that
 * Outlook's Word rendering engine drops. */
export function renderButton(href: string, label: string): string {
  const safeHref = escapeHtml(href);
  const safeLabel = escapeHtml(label);
  return `<table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin:20px 0;">
  <tr>
    <td style="border-radius:6px;background-color:${COLOR_ACCENT};" bgcolor="${COLOR_ACCENT}">
      <a href="${safeHref}" target="_blank" style="display:inline-block;padding:12px 24px;font-family:${FONT_STACK};font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:6px;">${safeLabel}</a>
    </td>
  </tr>
</table>`;
}
