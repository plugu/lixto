import { beforeEach, describe, expect, it, vi } from "vitest";

// vi.mock hoists above these imports; every dependency the two server
// actions touch (DB-backed query modules, auth/session, navigation) is
// mocked here so the module graph never opens a real connection or reads
// cookies. Following `lib/agent/tools.test.ts`'s style.
vi.mock("@/lib/email/outbox", () => ({
  enqueue: vi.fn(),
  suppress: vi.fn(),
}));
vi.mock("@/lib/auth", () => ({
  createSession: vi.fn(),
  hashPassword: vi.fn(),
  setSessionCookie: vi.fn(),
  requireAdmin: vi.fn(),
}));
vi.mock("@/lib/br-validators", () => ({
  isValidCEP: vi.fn(() => true),
  isValidCNPJ: vi.fn(() => true),
  isValidCPF: vi.fn(() => true),
  isValidEmail: vi.fn(() => true),
  onlyDigits: (value: string) => value.replace(/\D/g, ""),
}));
vi.mock("@/lib/cnpj-lookup", () => ({ lookupCNPJ: vi.fn() }));
vi.mock("@/lib/signup-queries", () => ({ createCompanyWithAdmin: vi.fn() }));
vi.mock("@/lib/types", () => ({ COMPANY_SIZES: [], UF_LIST: [] }));
vi.mock("@/lib/user-queries", () => ({
  createInvite: vi.fn(),
  removeUser: vi.fn(),
  updateRole: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  redirect: vi.fn(() => {
    throw new Error("NEXT_REDIRECT");
  }),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { createSession, setSessionCookie, requireAdmin } from "@/lib/auth";
import { enqueue } from "@/lib/email/outbox";
import { createCompanyWithAdmin } from "@/lib/signup-queries";
import { createInvite } from "@/lib/user-queries";
import { redirect } from "next/navigation";

import {
  createInviteAction,
  buildInviteEmailInput,
} from "../../app/(app)/company/users/actions";
import {
  signupAction,
  buildWelcomeEmailInput,
} from "../../app/(app)/signup/actions";
import {
  buildUnsubscribeUrl,
  unsubscribeToken,
  verifyUnsubscribeToken,
} from "./unsubscribe";

const mock = <T>(fn: T) => fn as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("unsubscribeToken / verifyUnsubscribeToken", () => {
  it("round-trips a valid token", () => {
    const token = unsubscribeToken("user@example.com");
    expect(verifyUnsubscribeToken("user@example.com", token)).toBe(true);
    // Case/whitespace-insensitive, since the token is over the normalized
    // address.
    expect(verifyUnsubscribeToken("  User@Example.com ", token)).toBe(true);
  });

  it("rejects a tampered token", () => {
    const token = unsubscribeToken("user@example.com");
    const tampered = token.slice(0, -1) + (token.at(-1) === "A" ? "B" : "A");
    expect(verifyUnsubscribeToken("user@example.com", tampered)).toBe(false);
  });

  it("rejects a length-mismatched token without throwing", () => {
    const token = unsubscribeToken("user@example.com");
    expect(() =>
      verifyUnsubscribeToken("user@example.com", token.slice(0, -1)),
    ).not.toThrow();
    expect(verifyUnsubscribeToken("user@example.com", token.slice(0, -1))).toBe(
      false,
    );
  });

  it("builds an unsubscribe URL carrying the email and a valid token", () => {
    const url = new URL(buildUnsubscribeUrl("USER@example.com"));
    const email = url.searchParams.get("email");
    const token = url.searchParams.get("token");
    expect(email).toBe("user@example.com");
    expect(token).toBeTruthy();
    expect(verifyUnsubscribeToken("user@example.com", token!)).toBe(true);
  });
});

function signupFormData(): FormData {
  const fd = new FormData();
  fd.set("taxId", "12345678000199");
  fd.set("legalName", "Alfa Comércio Ltda");
  fd.set("tradeName", "Alfa");
  fd.set("name", "Maria Silva");
  fd.set("email", "maria@example.com");
  fd.set("password", "password123");
  fd.set("confirmPassword", "password123");
  fd.append("cnae_code", "4761003");
  fd.append("cnae_description", "Comércio varejista");
  fd.set("cnae_primary", "0");
  return fd;
}

describe("signupAction", () => {
  beforeEach(() => {
    mock(createCompanyWithAdmin).mockResolvedValue({
      companyId: 42,
      userId: 7,
    });
    mock(createSession).mockResolvedValue("session-token");
    mock(setSessionCookie).mockResolvedValue(undefined);
  });

  it("enqueues one welcome email with the created ids", async () => {
    mock(enqueue).mockResolvedValue({ id: 1 });

    await expect(
      signupAction({ error: null }, signupFormData()),
    ).rejects.toThrow("NEXT_REDIRECT");

    expect(enqueue).toHaveBeenCalledTimes(1);
    expect(enqueue).toHaveBeenCalledWith({
      toEmail: "maria@example.com",
      template: "welcome",
      payload: {
        userName: "Maria Silva",
        companyName: "Alfa",
        appUrl: expect.stringContaining("/lixto"),
      },
      companyId: 42,
      userId: 7,
    });
    expect(redirect).toHaveBeenCalledWith("/company");
  });

  it("still creates the session and redirects when enqueue rejects", async () => {
    mock(enqueue).mockRejectedValue(new Error("smtp down"));

    await expect(
      signupAction({ error: null }, signupFormData()),
    ).rejects.toThrow("NEXT_REDIRECT");

    expect(createSession).toHaveBeenCalledWith(7);
    expect(redirect).toHaveBeenCalledWith("/company");
    expect(console.error).toHaveBeenCalled();
  });
});

describe("buildWelcomeEmailInput", () => {
  it("falls back to the legal name when there is no trade name", async () => {
    const input = await buildWelcomeEmailInput({
      name: "Maria",
      email: "maria@example.com",
      tradeName: "",
      legalName: "Alfa Ltda",
      companyId: 1,
      userId: 2,
    });
    expect(input.payload).toMatchObject({ companyName: "Alfa Ltda" });
  });
});

function inviteFormData(): FormData {
  const fd = new FormData();
  fd.set("name", "João");
  fd.set("email", "joao@example.com");
  fd.set("role", "member");
  return fd;
}

const SESSION = {
  user: { id: 1, name: "Admin", email: "admin@example.com", role: "admin" as const, companyId: 9 },
  company: { id: 9, legalName: "Beta Ltda", tradeName: "Beta", taxId: "12345678000199" },
};

describe("createInviteAction", () => {
  beforeEach(() => {
    mock(requireAdmin).mockResolvedValue(SESSION);
    mock(createInvite).mockResolvedValue({ token: "raw-invite-token" });
  });

  it("enqueues one invite email whose acceptUrl carries the raw token, and still returns { token }", async () => {
    mock(enqueue).mockResolvedValue({ id: 5 });

    const result = await createInviteAction({}, inviteFormData());

    expect(result).toEqual({ token: "raw-invite-token" });
    expect(enqueue).toHaveBeenCalledTimes(1);
    const call = mock(enqueue).mock.calls[0][0];
    expect(call.toEmail).toBe("joao@example.com");
    expect(call.template).toBe("invite");
    expect(call.companyId).toBe(9);
    expect(call.payload).toMatchObject({
      inviterName: "Admin",
      companyName: "Beta",
      acceptUrl: expect.stringContaining("/invite/raw-invite-token"),
    });
    expect(typeof call.payload.expiresAt).toBe("string");
    expect(Number.isNaN(Date.parse(call.payload.expiresAt as string))).toBe(
      false,
    );
  });

  it("still returns { token } when enqueue rejects", async () => {
    mock(enqueue).mockRejectedValue(new Error("smtp down"));

    const result = await createInviteAction({}, inviteFormData());

    expect(result).toEqual({ token: "raw-invite-token" });
    expect(console.error).toHaveBeenCalled();
  });
});

describe("buildInviteEmailInput", () => {
  it("shapes the invite payload with a future ISO expiry", async () => {
    const input = await buildInviteEmailInput({
      inviterName: "Admin",
      companyName: "Beta",
      email: "joao@example.com",
      token: "tok",
      companyId: 9,
    });
    expect(input).toMatchObject({
      toEmail: "joao@example.com",
      template: "invite",
      companyId: 9,
    });
    const expiresAt = (input.payload as { expiresAt: string }).expiresAt;
    expect(Date.parse(expiresAt)).toBeGreaterThan(Date.now());
  });
});
