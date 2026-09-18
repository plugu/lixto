import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// vi.mock hoists above these imports; every dependency the two server
// actions touch (DB-backed query modules, auth/session, navigation) is
// mocked here so the module graph never opens a real connection or reads
// cookies.
vi.mock("@/lib/email/outbox", () => ({
  enqueue: vi.fn(),
  suppress: vi.fn(),
}));
// The unsubscribe route (an app/ file) legitimately imports through "@/",
// which vitest cannot resolve without a config alias; point those two
// specifiers at the *real* modules so the route runs against real HTML
// escaping and real token verification.
vi.mock("@/lib/email/layout", async () => await import("./layout"));
vi.mock("@/lib/email/unsubscribe", async () => await import("./unsubscribe"));
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
vi.mock("@/lib/superadmin-queries", () => ({
  listSuperadminRecipients: vi.fn(),
}));
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
import { enqueue, suppress } from "@/lib/email/outbox";
import { createCompanyWithAdmin } from "@/lib/signup-queries";
import { listSuperadminRecipients } from "@/lib/superadmin-queries";
import { createInvite } from "@/lib/user-queries";
import { NextRequest } from "next/server";
import { redirect } from "next/navigation";

import {
  createInviteAction,
  buildInviteEmailInput,
} from "../../app/(app)/company/users/actions";
import {
  GET as unsubscribeGET,
  POST as unsubscribePOST,
} from "../../app/(app)/email/unsubscribe/route";
import {
  signupAction,
  buildSignupReceivedInput,
  buildPendingAdminInput,
} from "../../app/(app)/signup/actions";
import { proxy } from "../../proxy";
import {
  buildUnsubscribeUrl,
  unsubscribeToken,
  verifyUnsubscribeToken,
} from "./unsubscribe";

const mock = <T>(fn: T) => fn as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  // The signing key is read at call time, so stubbing it here is enough.
  vi.stubEnv("LIXTO_UNSUBSCRIBE_SECRET", "test-unsubscribe-secret");
});

afterEach(() => {
  vi.unstubAllEnvs();
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

  it("refuses to mint a token when the secret is unset, instead of signing with an empty key", () => {
    const signed = unsubscribeToken("user@example.com");
    vi.stubEnv("LIXTO_UNSUBSCRIBE_SECRET", "");
    expect(() => unsubscribeToken("user@example.com")).toThrow(
      /LIXTO_UNSUBSCRIBE_SECRET/,
    );
    expect(() => buildUnsubscribeUrl("user@example.com")).toThrow();
    // And nothing verifies — not even a token that was valid a moment ago.
    expect(verifyUnsubscribeToken("user@example.com", signed)).toBe(false);
    expect(verifyUnsubscribeToken("user@example.com", "")).toBe(false);
  });

  it("does not fall back to LIXTO_INTERNAL_TOKEN", () => {
    vi.stubEnv("LIXTO_UNSUBSCRIBE_SECRET", "");
    vi.stubEnv("LIXTO_INTERNAL_TOKEN", "internal-token");
    expect(() => unsubscribeToken("user@example.com")).toThrow();
  });
});

describe("proxy: /email/unsubscribe is reachable logged out", () => {
  const request = (url: string) => new NextRequest(new Request(url));

  it("passes a session-less unsubscribe request through with its query intact", () => {
    const url =
      "http://localhost:3000/email/unsubscribe?email=user%40example.com&token=abc";
    const response = proxy(request(url));

    expect(response.headers.get("location")).toBeNull();
    expect(response.headers.get("x-middleware-next")).toBe("1");
  });

  it("still redirects a session-less request to a private path", () => {
    const response = proxy(request("http://localhost:3000/dashboard"));
    expect(response.headers.get("location")).toContain("/login");
  });
});

describe("GET /email/unsubscribe", () => {
  const url = (email: string, token: string) =>
    `http://localhost:3000/email/unsubscribe?${new URLSearchParams({
      email,
      token,
    })}`;

  it("renders the confirmation form and suppresses nothing", async () => {
    const email = "user@example.com";
    const response = await unsubscribeGET(
      new Request(url(email, unsubscribeToken(email))),
    );
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(html).toContain('<form method="post"');
    expect(html).toContain('name="token"');
    expect(html).toContain(email);
    expect(suppress).not.toHaveBeenCalled();
  });

  it("400s an invalid token without suppressing", async () => {
    const response = await unsubscribeGET(
      new Request(url("user@example.com", "forged")),
    );
    expect(response.status).toBe(400);
    expect(suppress).not.toHaveBeenCalled();
  });
});

describe("POST /email/unsubscribe", () => {
  const path = "http://localhost:3000/email/unsubscribe";

  function form(email: string, token: string): Request {
    return new Request(path, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ email, token }).toString(),
    });
  }

  it("suppresses once for a valid token posted as a form body", async () => {
    const email = "user@example.com";
    const response = await unsubscribePOST(
      form(email, unsubscribeToken(email)),
    );

    expect(response.status).toBe(200);
    expect(suppress).toHaveBeenCalledTimes(1);
    expect(suppress).toHaveBeenCalledWith(email, "unsubscribe");
  });

  it("accepts the credentials from the query string (one-click senders)", async () => {
    const email = "user@example.com";
    const query = new URLSearchParams({
      email,
      token: unsubscribeToken(email),
    });
    const response = await unsubscribePOST(
      new Request(`${path}?${query}`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: "List-Unsubscribe=One-Click",
      }),
    );

    expect(response.status).toBe(200);
    expect(suppress).toHaveBeenCalledTimes(1);
  });

  it("400s a forged token and suppresses nothing", async () => {
    const response = await unsubscribePOST(form("user@example.com", "forged"));

    expect(response.status).toBe(400);
    expect(suppress).not.toHaveBeenCalled();
  });

  it("400s when the secret is unset, even with a previously valid token", async () => {
    const email = "user@example.com";
    const token = unsubscribeToken(email);
    vi.stubEnv("LIXTO_UNSUBSCRIBE_SECRET", "");

    const response = await unsubscribePOST(form(email, token));

    expect(response.status).toBe(400);
    expect(suppress).not.toHaveBeenCalled();
  });
});

/** Sentinel standing in for the `PoolClient` a real transaction would hand
 * the hook — distinct from `pool` so tests can assert `enqueue` was called
 * with *this*, not the default pool. */
const TX_CLIENT = { query: vi.fn(), __brand: "tx-client" };

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
    // Stands in for the real transaction: invokes the `onCommitted` hook
    // signup/actions.ts passes to `createCompanyWithAdmin`, with `TX_CLIENT`
    // as the ctx's client — same as the real hook getting the open
    // `PoolClient` before COMMIT.
    mock(createCompanyWithAdmin).mockImplementation(
      async (
        _input: unknown,
        onCommitted?: (ctx: {
          client: typeof TX_CLIENT;
          companyId: number;
          userId: number;
        }) => Promise<void>,
      ) => {
        if (onCommitted) {
          await onCommitted({ client: TX_CLIENT, companyId: 42, userId: 7 });
        }
        return { companyId: 42, userId: 7 };
      },
    );
    mock(createSession).mockResolvedValue("session-token");
    mock(setSessionCookie).mockResolvedValue(undefined);
    mock(listSuperadminRecipients).mockResolvedValue([]);
  });

  it("enqueues signup_received through the transaction client, with the created ids, and never creates a session", async () => {
    mock(enqueue).mockResolvedValue({ id: 1 });

    await expect(
      signupAction({ error: null }, signupFormData()),
    ).rejects.toThrow("NEXT_REDIRECT");

    expect(enqueue).toHaveBeenCalledWith(
      {
        toEmail: "maria@example.com",
        template: "signup_received",
        payload: {
          userName: "Maria Silva",
          companyName: "Alfa",
        },
        companyId: 42,
        userId: 7,
      },
      TX_CLIENT,
    );
    expect(createSession).not.toHaveBeenCalled();
    expect(setSessionCookie).not.toHaveBeenCalled();
    expect(redirect).toHaveBeenCalledWith("/signup/recebido");
  });

  it("enqueues one signup_pending_admin mail per superadmin recipient, to their own email with their own id as userId", async () => {
    mock(enqueue).mockResolvedValue({ id: 1 });
    mock(listSuperadminRecipients).mockResolvedValue([
      { id: 101, email: "owner@example.com", name: "Owner" },
      { id: 102, email: "second@example.com", name: "Second" },
    ]);

    await expect(
      signupAction({ error: null }, signupFormData()),
    ).rejects.toThrow("NEXT_REDIRECT");

    // One signup_received + one signup_pending_admin per superadmin.
    expect(enqueue).toHaveBeenCalledTimes(3);
    expect(enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        toEmail: "owner@example.com",
        template: "signup_pending_admin",
        userId: 101,
      }),
      TX_CLIENT,
    );
    expect(enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        toEmail: "second@example.com",
        template: "signup_pending_admin",
        userId: 102,
      }),
      TX_CLIENT,
    );
  });

  it("propagates a rejecting enqueue instead of swallowing it — signup rolls back", async () => {
    mock(enqueue).mockRejectedValue(new Error("smtp down"));

    await expect(
      signupAction({ error: null }, signupFormData()),
    ).rejects.toThrow("smtp down");

    // The transaction rolled back before COMMIT — no session was created
    // and no redirect happened for a user that (in reality) was never
    // persisted.
    expect(createSession).not.toHaveBeenCalled();
    expect(redirect).not.toHaveBeenCalled();
  });
});

describe("buildSignupReceivedInput", () => {
  it("falls back to the legal name when there is no trade name", async () => {
    const input = await buildSignupReceivedInput({
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

describe("buildPendingAdminInput", () => {
  it("addresses the given recipient, uses their id as userId, and points adminUrl at /admin/companies", async () => {
    const input = await buildPendingAdminInput(
      { id: 101, email: "owner@example.com", name: "Owner" },
      {
        companyName: "Alfa",
        taxId: "12.345.678/0001-99",
        adminName: "Maria Silva",
        adminEmail: "maria@example.com",
        companyId: 42,
      },
    );
    expect(input).toMatchObject({
      toEmail: "owner@example.com",
      template: "signup_pending_admin",
      // F6: companyId is null — the recipient is a superadmin, not a member
      // of the applicant company, which is already identified in the
      // payload (companyName/taxId).
      companyId: null,
      userId: 101,
    });
    expect(input.payload).toMatchObject({
      companyName: "Alfa",
      taxId: "12345678000199",
      adminName: "Maria Silva",
      adminEmail: "maria@example.com",
      adminUrl: expect.stringContaining("/admin/companies"),
    });
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

const DB_INVITE_EXPIRES_AT = new Date("2026-09-10T00:00:00.000Z");

describe("createInviteAction", () => {
  beforeEach(() => {
    mock(requireAdmin).mockResolvedValue(SESSION);
    // Stands in for the real transaction: invokes the `onCommitted` hook
    // company/users/actions.ts passes to `createInvite`, with `TX_CLIENT` as
    // the ctx's client and the DB-persisted `invite_expires_at` — same as
    // the real hook getting the open `PoolClient` and row before COMMIT.
    mock(createInvite).mockImplementation(
      async (
        _companyId: number,
        _data: unknown,
        onCommitted?: (ctx: {
          client: typeof TX_CLIENT;
          userId: number;
          token: string;
          expiresAt: Date;
        }) => Promise<void>,
      ) => {
        if (onCommitted) {
          await onCommitted({
            client: TX_CLIENT,
            userId: 3,
            token: "raw-invite-token",
            expiresAt: DB_INVITE_EXPIRES_AT,
          });
        }
        return { token: "raw-invite-token" };
      },
    );
  });

  it("enqueues one invite email through the transaction client, whose acceptUrl carries the raw token and expiresAt comes from the persisted row, and still returns { token }", async () => {
    mock(enqueue).mockResolvedValue({ id: 5 });

    const result = await createInviteAction({}, inviteFormData());

    expect(result).toEqual({ token: "raw-invite-token" });
    expect(enqueue).toHaveBeenCalledTimes(1);
    const [call, client] = mock(enqueue).mock.calls[0];
    expect(client).toBe(TX_CLIENT);
    expect(call.toEmail).toBe("joao@example.com");
    expect(call.template).toBe("invite");
    expect(call.companyId).toBe(9);
    expect(call.payload).toMatchObject({
      inviterName: "Admin",
      companyName: "Beta",
      acceptUrl: expect.stringContaining("/invite/raw-invite-token"),
      expiresAt: DB_INVITE_EXPIRES_AT.toISOString(),
    });
  });

  it("propagates a rejecting enqueue instead of swallowing it — the invite rolls back", async () => {
    mock(enqueue).mockRejectedValue(new Error("smtp down"));

    const result = await createInviteAction({}, inviteFormData());

    expect(result).toEqual({ error: "smtp down" });
  });
});

describe("buildInviteEmailInput", () => {
  it("shapes the invite payload using the given expiresAt, not a locally re-derived one", async () => {
    const input = await buildInviteEmailInput({
      inviterName: "Admin",
      companyName: "Beta",
      email: "joao@example.com",
      token: "tok",
      companyId: 9,
      expiresAt: DB_INVITE_EXPIRES_AT,
    });
    expect(input).toMatchObject({
      toEmail: "joao@example.com",
      template: "invite",
      companyId: 9,
    });
    const expiresAt = (input.payload as { expiresAt: string }).expiresAt;
    expect(expiresAt).toBe(DB_INVITE_EXPIRES_AT.toISOString());
  });
});
