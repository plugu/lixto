// Four Portuguese email templates (ticket 110): pure functions from typed
// payload -> { subject, html, text }. No DB, no network — the outbox stores
// `payload JSONB` (108) and the worker (111) calls `renderTemplate` at send
// time, so everything here must be safe to run outside a request.
//
// Relative imports on purpose (see digest-queries.ts): vitest runs without a
// config file, so the tsconfig "@/" alias is not resolvable from lib tests.

import { escapeHtml, renderButton, renderLayout } from "./layout";
import { formatCNPJ } from "../br-validators";
import { formatDateBR } from "../format";

export type DigestAttentionItem = {
  sourceId: string;
  description: string;
  agency: string | null;
  state: string | null;
  score: number;
  closesAt: string | null;
  url: string;
};

export type TemplatePayloads = {
  welcome: { userName: string; companyName: string; appUrl: string };
  invite: {
    inviterName: string;
    companyName: string;
    acceptUrl: string;
    expiresAt: string;
  };
  password_reset: {
    userName: string;
    resetUrl: string;
    expiresMinutes: number;
  };
  daily_digest: {
    companyName: string;
    appUrl: string;
    unsubscribeUrl: string;
    newCount: number;
    matchedCount: number;
    attentionCount: number;
    attention: DigestAttentionItem[];
  };
  signup_received: { userName: string; companyName: string };
  signup_pending_admin: {
    companyName: string;
    taxId: string;
    adminName: string;
    adminEmail: string;
    adminUrl: string;
  };
  signup_approved: { userName: string; companyName: string; loginUrl: string };
  signup_rejected: {
    userName: string;
    companyName: string;
    reason: string | null;
  };
  case_ready: {
    companyName: string;
    procurementTitle: string;
    agency: string | null;
    stateUf: string | null;
    /** ISO instant, or null when the dossier could not resolve a date. */
    sessionAt: string | null;
    met: number;
    expiring: number;
    missing: number;
    manual: number;
    caseUrl: string;
  };
};

export type RenderedEmail = { subject: string; html: string; text: string };

/** Cards shown on the digest email itself — mirrors the in-app preview cap
 * (`ATTENTION_PREVIEW_LIMIT` in digest-queries.ts). Enforced here too so the
 * template is safe even if the caller passes a longer array. */
const DIGEST_CARD_LIMIT = 5;

/** Max characters for a digest card's description before truncation. */
const DESCRIPTION_TRUNCATE = 120;

function truncate(value: string, max: number): string {
  if (value.length <= max) return value;
  return `${value.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
}

function paragraph(text: string): string {
  return `<p style="margin:0 0 16px 0;">${text}</p>`;
}

function renderWelcome(p: TemplatePayloads["welcome"]): RenderedEmail {
  const subject = `Bem-vindo ao Lixto, ${p.userName}`;
  const bodyHtml = [
    paragraph(
      `Olá, ${escapeHtml(p.userName)}. A conta da <strong>${escapeHtml(
        p.companyName,
      )}</strong> no Lixto foi criada com sucesso.`,
    ),
    paragraph(
      "A partir de agora acompanhamos novas licitações compatíveis com o perfil da sua empresa e avisamos por aqui quando surgir algo relevante.",
    ),
    renderButton(p.appUrl, "Acessar Lixto"),
  ].join("\n");

  const html = renderLayout({ title: subject, bodyHtml, preheader: subject });

  const text = [
    `Olá, ${p.userName}.`,
    `A conta da ${p.companyName} no Lixto foi criada com sucesso.`,
    "A partir de agora acompanhamos novas licitações compatíveis com o perfil da sua empresa e avisamos por aqui quando surgir algo relevante.",
    `Acessar Lixto: ${p.appUrl}`,
  ].join("\n\n");

  return { subject, html, text };
}

function renderInvite(p: TemplatePayloads["invite"]): RenderedEmail {
  const subject = `${p.inviterName} convidou você para o Lixto`;
  const expires = formatDateBR(p.expiresAt, true);
  const bodyHtml = [
    paragraph(
      `${escapeHtml(p.inviterName)} convidou você para colaborar na conta da <strong>${escapeHtml(
        p.companyName,
      )}</strong> no Lixto.`,
    ),
    paragraph(`Este convite expira em ${escapeHtml(expires)}.`),
    renderButton(p.acceptUrl, "Aceitar convite"),
  ].join("\n");

  const html = renderLayout({ title: subject, bodyHtml, preheader: subject });

  const text = [
    `${p.inviterName} convidou você para colaborar na conta da ${p.companyName} no Lixto.`,
    `Este convite expira em ${expires}.`,
    `Aceitar convite: ${p.acceptUrl}`,
  ].join("\n\n");

  return { subject, html, text };
}

function renderPasswordReset(
  p: TemplatePayloads["password_reset"],
): RenderedEmail {
  const subject = "Redefinição de senha — Lixto";
  const bodyHtml = [
    paragraph(
      `Olá, ${escapeHtml(p.userName)}. Recebemos um pedido de redefinição de senha para sua conta no Lixto.`,
    ),
    paragraph(
      `Este link é válido por ${p.expiresMinutes} minutos e só pode ser usado uma vez. Se você não solicitou, ignore este e-mail.`,
    ),
    renderButton(p.resetUrl, "Redefinir senha"),
  ].join("\n");

  const html = renderLayout({ title: subject, bodyHtml, preheader: subject });

  const text = [
    `Olá, ${p.userName}.`,
    "Recebemos um pedido de redefinição de senha para sua conta no Lixto.",
    `Este link é válido por ${p.expiresMinutes} minutos e só pode ser usado uma vez. Se você não solicitou, ignore este e-mail.`,
    `Redefinir senha: ${p.resetUrl}`,
  ].join("\n\n");

  return { subject, html, text };
}

function renderSignupReceived(
  p: TemplatePayloads["signup_received"],
): RenderedEmail {
  const subject = `Recebemos o cadastro da ${p.companyName}`;
  const bodyHtml = [
    paragraph(
      `Olá, ${escapeHtml(p.userName)}. Obrigado por cadastrar a <strong>${escapeHtml(
        p.companyName,
      )}</strong> no Lixto.`,
    ),
    paragraph("Estamos avaliando os dados da sua empresa."),
    paragraph(
      "Você receberá outro e-mail assim que o acesso for liberado.",
    ),
  ].join("\n");

  const html = renderLayout({ title: subject, bodyHtml, preheader: subject });

  const text = [
    `Olá, ${p.userName}.`,
    `Obrigado por cadastrar a ${p.companyName} no Lixto.`,
    "Estamos avaliando os dados da sua empresa.",
    "Você receberá outro e-mail assim que o acesso for liberado.",
  ].join("\n\n");

  return { subject, html, text };
}

function renderSignupPendingAdmin(
  p: TemplatePayloads["signup_pending_admin"],
): RenderedEmail {
  const subject = `Nova empresa aguardando aprovação: ${p.companyName}`;
  const taxId = formatCNPJ(p.taxId);
  const bodyHtml = [
    paragraph(
      `A empresa <strong>${escapeHtml(p.companyName)}</strong> (CNPJ ${escapeHtml(
        taxId,
      )}) se cadastrou no Lixto e aguarda aprovação.`,
    ),
    paragraph(
      `Administrador: ${escapeHtml(p.adminName)} (${escapeHtml(p.adminEmail)}).`,
    ),
    renderButton(p.adminUrl, "Revisar cadastro"),
  ].join("\n");

  const html = renderLayout({ title: subject, bodyHtml, preheader: subject });

  const text = [
    `A empresa ${p.companyName} (CNPJ ${taxId}) se cadastrou no Lixto e aguarda aprovação.`,
    `Administrador: ${p.adminName} (${p.adminEmail}).`,
    `Revisar cadastro: ${p.adminUrl}`,
  ].join("\n\n");

  return { subject, html, text };
}

function renderSignupApproved(
  p: TemplatePayloads["signup_approved"],
): RenderedEmail {
  const subject = `Acesso liberado: ${p.companyName} no Lixto`;
  const bodyHtml = [
    paragraph(
      `Olá, ${escapeHtml(p.userName)}. O cadastro da <strong>${escapeHtml(
        p.companyName,
      )}</strong> foi aprovado e o acesso ao Lixto foi liberado.`,
    ),
    renderButton(p.loginUrl, "Entrar no Lixto"),
  ].join("\n");

  const html = renderLayout({ title: subject, bodyHtml, preheader: subject });

  const text = [
    `Olá, ${p.userName}.`,
    `O cadastro da ${p.companyName} foi aprovado e o acesso ao Lixto foi liberado.`,
    `Entrar no Lixto: ${p.loginUrl}`,
  ].join("\n\n");

  return { subject, html, text };
}

function renderSignupRejected(
  p: TemplatePayloads["signup_rejected"],
): RenderedEmail {
  const subject = `Cadastro da ${p.companyName} não aprovado`;
  const hasReason = Boolean(p.reason && p.reason.length > 0);
  const bodyHtml = [
    paragraph(
      `Olá, ${escapeHtml(p.userName)}. O cadastro da <strong>${escapeHtml(
        p.companyName,
      )}</strong> não foi aprovado neste momento.`,
    ),
    ...(hasReason ? [paragraph(`Motivo: ${escapeHtml(p.reason as string)}`)] : []),
    paragraph("Se tiver dúvidas, basta responder a este e-mail."),
  ].join("\n");

  const html = renderLayout({ title: subject, bodyHtml, preheader: subject });

  const text = [
    `Olá, ${p.userName}.`,
    `O cadastro da ${p.companyName} não foi aprovado neste momento.`,
    ...(hasReason ? [`Motivo: ${p.reason}`] : []),
    "Se tiver dúvidas, basta responder a este e-mail.",
  ].join("\n\n");

  return { subject, html, text };
}

/** Joins the non-null parts with " · " — an unknown agency or UF is skipped
 * rather than shown as "—", since either can legitimately be missing from the
 * procurement record. */
function joinPresent(parts: (string | null)[]): string {
  return parts.filter((part): part is string => Boolean(part)).join(" · ");
}

function renderCaseReady(p: TemplatePayloads["case_ready"]): RenderedEmail {
  const subject = `Caso pronto para decidir: ${truncate(p.procurementTitle, 70)}`;
  const agencyLine = joinPresent([p.agency, p.stateUf]);
  const sessionLine = p.sessionAt
    ? `Sessão pública: ${formatDateBR(p.sessionAt)}`
    : "Data da sessão: a confirmar";
  const countsLine = `Habilitação: ${p.met} atendida(s), ${p.expiring} vence(m) antes da sessão, ${p.missing} falta(m), ${p.manual} para verificar.`;

  const bodyHtml = [
    paragraph(`Olá, ${escapeHtml(p.companyName)}.`),
    paragraph(
      "O agente montou o caso desta licitação e ele está pronto para a sua decisão.",
    ),
    ...(agencyLine ? [paragraph(escapeHtml(agencyLine))] : []),
    paragraph(escapeHtml(sessionLine)),
    paragraph(escapeHtml(countsLine)),
    renderButton(p.caseUrl, "Ver caso e decidir"),
  ].join("\n");

  const html = renderLayout({ title: subject, bodyHtml, preheader: subject });

  const text = [
    `Olá, ${p.companyName}.`,
    "O agente montou o caso desta licitação e ele está pronto para a sua decisão.",
    ...(agencyLine ? [agencyLine] : []),
    sessionLine,
    countsLine,
    `Ver caso e decidir: ${p.caseUrl}`,
  ].join("\n\n");

  return { subject, html, text };
}

function digestSubject(p: TemplatePayloads["daily_digest"]): string {
  if (p.attentionCount > 0) {
    return `${p.attentionCount} oportunidade(s) merecem sua atenção hoje`;
  }
  return `Resumo Lixto: ${p.matchedCount} licitações compatíveis hoje`;
}

function attentionCardHtml(item: DigestAttentionItem): string {
  const description = escapeHtml(truncate(item.description, DESCRIPTION_TRUNCATE));
  const agency = escapeHtml(item.agency ?? "—");
  const state = escapeHtml(item.state ?? "—");
  const closesAt = escapeHtml(formatDateBR(item.closesAt));
  return `<tr>
            <td style="padding:12px 0;border-top:1px solid #e5e7eb;">
              <a href="${escapeHtml(item.url)}" target="_blank" style="font-size:14px;font-weight:600;color:#2563eb;text-decoration:none;">${description}</a>
              <div style="margin-top:4px;font-size:13px;color:#6b7280;">${agency} · ${state} · Aderência ${item.score} · Encerra em ${closesAt}</div>
            </td>
          </tr>`;
}

function attentionCardText(item: DigestAttentionItem): string {
  const description = truncate(item.description, DESCRIPTION_TRUNCATE);
  const agency = item.agency ?? "—";
  const state = item.state ?? "—";
  const closesAt = formatDateBR(item.closesAt);
  return [
    `- ${description}`,
    `  ${agency} · ${state} · Aderência ${item.score} · Encerra em ${closesAt}`,
    `  ${item.url}`,
  ].join("\n");
}

function renderDailyDigest(
  p: TemplatePayloads["daily_digest"],
): RenderedEmail {
  const subject = digestSubject(p);
  const cards = p.attention.slice(0, DIGEST_CARD_LIMIT);

  const summaryHtml = paragraph(
    `${p.newCount} nova(s) oportunidade(s) analisada(s), ${p.matchedCount} compatível(is) com a <strong>${escapeHtml(
      p.companyName,
    )}</strong>, ${p.attentionCount} merecendo atenção hoje.`,
  );

  const cardsHtml =
    cards.length > 0
      ? `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">${cards
          .map(attentionCardHtml)
          .join("\n")}</table>`
      : paragraph("Nenhuma oportunidade exigiu atenção hoje.");

  const seeAllHtml = paragraph(
    `<a href="${escapeHtml(p.appUrl)}" style="color:#2563eb;text-decoration:none;">Ver todas as oportunidades</a>`,
  );

  const bodyHtml = [summaryHtml, cardsHtml, seeAllHtml].join("\n");

  const footerHtml = `<p style="margin:0;"><a href="${escapeHtml(
    p.unsubscribeUrl,
  )}" style="color:#6b7280;text-decoration:underline;">Não quero mais receber este resumo</a></p>`;

  const html = renderLayout({
    title: subject,
    bodyHtml,
    footerHtml,
    preheader: subject,
  });

  const text = [
    `${p.newCount} nova(s) oportunidade(s) analisada(s), ${p.matchedCount} compatível(is) com a ${p.companyName}, ${p.attentionCount} merecendo atenção hoje.`,
    cards.length > 0
      ? cards.map(attentionCardText).join("\n\n")
      : "Nenhuma oportunidade exigiu atenção hoje.",
    `Ver todas as oportunidades: ${p.appUrl}`,
    `Não quero mais receber este resumo: ${p.unsubscribeUrl}`,
  ].join("\n\n");

  return { subject, html, text };
}

/** Renders a template + payload to `{ subject, html, text }`. Throws on an
 * unknown template name (a JSONB payload with a stale/typo'd `template`
 * value, since the outbox stores the name as a plain string). */
export function renderTemplate<T extends keyof TemplatePayloads>(
  template: T,
  payload: TemplatePayloads[T],
): RenderedEmail {
  switch (template) {
    case "welcome":
      return renderWelcome(payload as TemplatePayloads["welcome"]);
    case "invite":
      return renderInvite(payload as TemplatePayloads["invite"]);
    case "password_reset":
      return renderPasswordReset(
        payload as TemplatePayloads["password_reset"],
      );
    case "daily_digest":
      return renderDailyDigest(payload as TemplatePayloads["daily_digest"]);
    case "signup_received":
      return renderSignupReceived(
        payload as TemplatePayloads["signup_received"],
      );
    case "signup_pending_admin":
      return renderSignupPendingAdmin(
        payload as TemplatePayloads["signup_pending_admin"],
      );
    case "signup_approved":
      return renderSignupApproved(
        payload as TemplatePayloads["signup_approved"],
      );
    case "signup_rejected":
      return renderSignupRejected(
        payload as TemplatePayloads["signup_rejected"],
      );
    case "case_ready":
      return renderCaseReady(payload as TemplatePayloads["case_ready"]);
    default:
      throw new Error(`Unknown email template: ${String(template)}`);
  }
}
