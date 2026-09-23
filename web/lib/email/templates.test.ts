import { describe, expect, it } from "vitest";
import { formatDateBR } from "../format";
import { renderTemplate, type TemplatePayloads } from "./templates";

describe("renderTemplate", () => {
  it("renders the welcome subject and CTA", () => {
    const payload: TemplatePayloads["welcome"] = {
      userName: "Maria",
      companyName: "Acme Ltda",
      appUrl: "https://app.lixto.com.br",
    };
    const email = renderTemplate("welcome", payload);
    expect(email.subject).toBe("Bem-vindo ao Lixto, Maria");
    expect(email.html).toContain("Acme Ltda");
    expect(email.html).toContain(`href="${payload.appUrl}"`);
    expect(email.text.length).toBeGreaterThan(0);
  });

  it("renders the invite subject and CTA", () => {
    const payload: TemplatePayloads["invite"] = {
      inviterName: "João",
      companyName: "Beta S/A",
      acceptUrl: "https://app.lixto.com.br/invite/abc123",
      expiresAt: "2026-09-10T12:00:00.000Z",
    };
    const email = renderTemplate("invite", payload);
    expect(email.subject).toBe("João convidou você para o Lixto");
    expect(email.html).toContain("Beta S/A");
    expect(email.html).toContain(`href="${payload.acceptUrl}"`);
    expect(email.text.length).toBeGreaterThan(0);
  });

  it("renders the password_reset subject and CTA", () => {
    const payload: TemplatePayloads["password_reset"] = {
      userName: "Ana",
      resetUrl: "https://app.lixto.com.br/reset/xyz",
      expiresMinutes: 30,
    };
    const email = renderTemplate("password_reset", payload);
    expect(email.subject).toBe("Redefinição de senha — Lixto");
    expect(email.html).toContain(`href="${payload.resetUrl}"`);
    expect(email.text.length).toBeGreaterThan(0);
  });

  it("escapes XSS in payload fields for html but leaves text raw", () => {
    const payload: TemplatePayloads["welcome"] = {
      userName: '<script>alert(1)</script>',
      companyName: "Acme Ltda",
      appUrl: "https://app.lixto.com.br",
    };
    const email = renderTemplate("welcome", payload);
    expect(email.html).not.toContain("<script>alert(1)</script>");
    expect(email.html).toContain(
      "&lt;script&gt;alert(1)&lt;/script&gt;",
    );
    expect(email.text).toContain("<script>alert(1)</script>");
  });

  it("uses the attentionCount subject and renders up to 5 cards", () => {
    const attention: TemplatePayloads["daily_digest"]["attention"] = Array.from(
      { length: 7 },
      (_, i) => ({
        sourceId: `src-${i}`,
        description: `Pregão eletrônico número ${i} para aquisição de materiais diversos`,
        agency: "Prefeitura de Exemplo",
        state: "SP",
        score: 80 + i,
        closesAt: "2026-09-15T00:00:00.000Z",
        url: `https://app.lixto.com.br/procurement/src-${i}`,
      }),
    );
    const payload: TemplatePayloads["daily_digest"] = {
      companyName: "Acme Ltda",
      appUrl: "https://app.lixto.com.br",
      unsubscribeUrl: "https://app.lixto.com.br/unsubscribe/token",
      newCount: 20,
      matchedCount: 10,
      attentionCount: 7,
      attention,
    };
    const email = renderTemplate("daily_digest", payload);
    expect(email.subject).toBe("7 oportunidade(s) merecem sua atenção hoje");
    const cardMatches = email.html.match(/procurement\/src-/g) ?? [];
    expect(cardMatches.length).toBe(5);
    expect(email.html).toContain(payload.unsubscribeUrl);
    expect(email.text.length).toBeGreaterThan(0);
  });

  it("truncates long descriptions to 120 characters", () => {
    const longDescription = "A".repeat(200);
    const payload: TemplatePayloads["daily_digest"] = {
      companyName: "Acme Ltda",
      appUrl: "https://app.lixto.com.br",
      unsubscribeUrl: "https://app.lixto.com.br/unsubscribe/token",
      newCount: 1,
      matchedCount: 1,
      attentionCount: 1,
      attention: [
        {
          sourceId: "src-1",
          description: longDescription,
          agency: null,
          state: null,
          score: 90,
          closesAt: null,
          url: "https://app.lixto.com.br/procurement/src-1",
        },
      ],
    };
    const email = renderTemplate("daily_digest", payload);
    expect(email.html).not.toContain(longDescription);
    expect(email.html).toContain(`${"A".repeat(119)}…`);
  });

  it("falls back to the matchedCount subject and renders no cards when attention is empty", () => {
    const payload: TemplatePayloads["daily_digest"] = {
      companyName: "Acme Ltda",
      appUrl: "https://app.lixto.com.br",
      unsubscribeUrl: "https://app.lixto.com.br/unsubscribe/token",
      newCount: 4,
      matchedCount: 3,
      attentionCount: 0,
      attention: [],
    };
    const email = renderTemplate("daily_digest", payload);
    expect(email.subject).toBe("Resumo Lixto: 3 licitações compatíveis hoje");
    expect(email.html).not.toContain('href="https://app.lixto.com.br/procurement');
    expect(email.html).toContain("Nenhuma oportunidade exigiu atenção hoje.");
  });

  it("renders the unsubscribe footer only for daily_digest", () => {
    const digest = renderTemplate("daily_digest", {
      companyName: "Acme Ltda",
      appUrl: "https://app.lixto.com.br",
      unsubscribeUrl: "https://app.lixto.com.br/unsubscribe/token",
      newCount: 1,
      matchedCount: 1,
      attentionCount: 1,
      attention: [],
    });
    expect(digest.html).toContain("https://app.lixto.com.br/unsubscribe/token");

    const welcome = renderTemplate("welcome", {
      userName: "Maria",
      companyName: "Acme Ltda",
      appUrl: "https://app.lixto.com.br",
    });
    expect(welcome.html).not.toContain("unsubscribe");

    const invite = renderTemplate("invite", {
      inviterName: "João",
      companyName: "Acme Ltda",
      acceptUrl: "https://app.lixto.com.br/invite/abc",
      expiresAt: "2026-09-10T12:00:00.000Z",
    });
    expect(invite.html).not.toContain("unsubscribe");

    const reset = renderTemplate("password_reset", {
      userName: "Ana",
      resetUrl: "https://app.lixto.com.br/reset/xyz",
      expiresMinutes: 15,
    });
    expect(reset.html).not.toContain("unsubscribe");
  });

  it("renders the signup_received subject and no CTA", () => {
    const payload: TemplatePayloads["signup_received"] = {
      userName: "Maria",
      companyName: "Acme Ltda",
    };
    const email = renderTemplate("signup_received", payload);
    expect(email.subject).toBe("Recebemos o cadastro da Acme Ltda");
    expect(email.html).toContain("Acme Ltda");
    expect(email.html).toContain("Estamos avaliando os dados da sua empresa");
    expect(email.text.length).toBeGreaterThan(0);
  });

  it("renders the signup_pending_admin subject, CTA and formatted CNPJ", () => {
    const payload: TemplatePayloads["signup_pending_admin"] = {
      companyName: "Acme Ltda",
      taxId: "12345678000195",
      adminName: "João",
      adminEmail: "joao@acme.com",
      adminUrl: "https://app.lixto.com.br/admin/companies/1",
    };
    const email = renderTemplate("signup_pending_admin", payload);
    expect(email.subject).toBe(
      "Nova empresa aguardando aprovação: Acme Ltda",
    );
    expect(email.html).toContain("12.345.678/0001-95");
    expect(email.html).toContain(`href="${payload.adminUrl}"`);
    expect(email.html).toContain("Revisar cadastro");
    expect(email.text.length).toBeGreaterThan(0);
  });

  it("renders the signup_approved subject and CTA", () => {
    const payload: TemplatePayloads["signup_approved"] = {
      userName: "Maria",
      companyName: "Acme Ltda",
      loginUrl: "https://app.lixto.com.br/login",
    };
    const email = renderTemplate("signup_approved", payload);
    expect(email.subject).toBe("Acesso liberado: Acme Ltda no Lixto");
    expect(email.html).toContain(`href="${payload.loginUrl}"`);
    expect(email.html).toContain("Entrar no Lixto");
    expect(email.text.length).toBeGreaterThan(0);
  });

  it("renders the signup_rejected subject with a reason", () => {
    const payload: TemplatePayloads["signup_rejected"] = {
      userName: "Maria",
      companyName: "Acme Ltda",
      reason: "CNPJ inválido",
    };
    const email = renderTemplate("signup_rejected", payload);
    expect(email.subject).toBe("Cadastro da Acme Ltda não aprovado");
    expect(email.html).toContain("Motivo: CNPJ inválido");
    expect(email.text).toContain("Motivo: CNPJ inválido");
  });

  it("renders the signup_rejected subject without a reason", () => {
    const payload: TemplatePayloads["signup_rejected"] = {
      userName: "Ana",
      companyName: "ACME",
      reason: null,
    };
    const email = renderTemplate("signup_rejected", payload);
    expect(email.subject).toBe("Cadastro da ACME não aprovado");
    expect(email.html).not.toContain("Motivo:");
    expect(email.text).not.toContain("Motivo:");
  });

  it("escapes XSS in signup_pending_admin fields for html but leaves text raw", () => {
    const payload: TemplatePayloads["signup_pending_admin"] = {
      companyName: "Acme Ltda",
      taxId: "12345678000195",
      adminName: '<script>alert(1)</script>',
      adminEmail: "joao@acme.com",
      adminUrl: "https://app.lixto.com.br/admin/companies/1",
    };
    const email = renderTemplate("signup_pending_admin", payload);
    expect(email.html).not.toContain("<script>alert(1)</script>");
    expect(email.html).toContain(
      "&lt;script&gt;alert(1)&lt;/script&gt;",
    );
    expect(email.text).toContain("<script>alert(1)</script>");
  });

  it("renders the case_ready subject with the truncated procurement title", () => {
    const payload: TemplatePayloads["case_ready"] = {
      companyName: "Acme Ltda",
      procurementTitle: "Pregão eletrônico para aquisição de materiais",
      agency: "Prefeitura de Exemplo",
      stateUf: "SP",
      sessionAt: "2026-10-01T15:00:00.000Z",
      met: 2,
      expiring: 1,
      missing: 1,
      manual: 1,
      caseUrl: "https://app.lixto.com.br/cases/31",
    };
    const email = renderTemplate("case_ready", payload);
    expect(email.subject).toBe(
      "Caso pronto para decidir: Pregão eletrônico para aquisição de materiais",
    );
  });

  it("renders the case_ready CTA, counts sentence and session date in html", () => {
    const payload: TemplatePayloads["case_ready"] = {
      companyName: "Acme Ltda",
      procurementTitle: "Pregão eletrônico",
      agency: "Prefeitura de Exemplo",
      stateUf: "SP",
      sessionAt: "2026-10-01T15:00:00.000Z",
      met: 2,
      expiring: 1,
      missing: 1,
      manual: 1,
      caseUrl: "https://app.lixto.com.br/cases/31",
    };
    const email = renderTemplate("case_ready", payload);
    expect(email.html).toContain(payload.caseUrl);
    expect(email.html).toContain(
      "Habilitação: 2 atendida(s), 1 vence(m) antes da sessão, 1 falta(m), 1 para verificar.",
    );
    expect(email.html).toContain("Prefeitura de Exemplo · SP");
    expect(email.html).toContain(formatDateBR(payload.sessionAt));
  });

  it("renders a to-be-confirmed session line when case_ready has no sessionAt", () => {
    const payload: TemplatePayloads["case_ready"] = {
      companyName: "Acme Ltda",
      procurementTitle: "Pregão eletrônico",
      agency: null,
      stateUf: null,
      sessionAt: null,
      met: 0,
      expiring: 0,
      missing: 4,
      manual: 0,
      caseUrl: "https://app.lixto.com.br/cases/31",
    };
    const email = renderTemplate("case_ready", payload);
    expect(email.html).toContain("Data da sessão: a confirmar");
    expect(email.text).toContain("Data da sessão: a confirmar");
  });

  it("renders the case_ready text version with no markup and the URL", () => {
    const payload: TemplatePayloads["case_ready"] = {
      companyName: "Acme Ltda",
      procurementTitle: "Pregão eletrônico",
      agency: "Prefeitura de Exemplo",
      stateUf: "SP",
      sessionAt: "2026-10-01T15:00:00.000Z",
      met: 2,
      expiring: 1,
      missing: 1,
      manual: 1,
      caseUrl: "https://app.lixto.com.br/cases/31",
    };
    const email = renderTemplate("case_ready", payload);
    expect(email.text).not.toContain("<");
    expect(email.text).toContain(payload.caseUrl);
  });

  it("escapes a case_ready title with markup in html", () => {
    const payload: TemplatePayloads["case_ready"] = {
      companyName: "Acme Ltda",
      procurementTitle: "Pregão <b>urgente</b>",
      agency: null,
      stateUf: null,
      sessionAt: null,
      met: 0,
      expiring: 0,
      missing: 0,
      manual: 0,
      caseUrl: "https://app.lixto.com.br/cases/31",
    };
    const email = renderTemplate("case_ready", payload);
    expect(email.html).not.toContain("<b>urgente</b>");
    expect(email.html).toContain("Pregão &lt;b&gt;urgente&lt;/b&gt;");
  });

  it("throws on an unknown template name", () => {
    expect(() =>
      renderTemplate(
        // @ts-expect-error deliberate unknown template name
        "not_a_real_template",
        {},
      ),
    ).toThrow();
  });
});
