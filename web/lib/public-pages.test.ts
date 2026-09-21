import { beforeEach, describe, expect, it, vi } from "vitest";

// vi.mock hoists above these imports; every dependency `public-pages.ts`
// touches is mocked (same pattern as
// web/app/(app)/admin/companies/actions.test.ts) so the module graph never
// opens a real DB connection or reads cookies.
vi.mock("./auth", () => ({ getSession: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw new Error("REDIRECT:" + url);
  }),
  unstable_rethrow: vi.fn(),
}));

import { getSession } from "./auth";
import { redirect, unstable_rethrow } from "next/navigation";
import { getOptionalSession, redirectIfLoggedIn } from "./public-pages";

const mock = <T>(fn: T) => fn as unknown as ReturnType<typeof vi.fn>;

const SESSION = {
  user: {
    id: 1,
    name: "Owner",
    email: "owner@example.com",
    role: "admin" as const,
    companyId: 1,
    isSuperadmin: false,
  },
  company: { id: 1, legalName: "Lixto", tradeName: null, taxId: "00000000000000" },
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("redirectIfLoggedIn", () => {
  it("redirects to /dashboard when there is a session and no next", async () => {
    mock(getSession).mockResolvedValue(SESSION);

    await expect(redirectIfLoggedIn()).rejects.toThrow(
      "REDIRECT:/dashboard",
    );
    expect(redirect).toHaveBeenCalledWith("/dashboard");
  });

  it("redirects to the sanitised next when there is a session", async () => {
    mock(getSession).mockResolvedValue(SESSION);

    await expect(redirectIfLoggedIn("/radar")).rejects.toThrow(
      "REDIRECT:/radar",
    );
  });

  it("falls back to /dashboard when next is hostile", async () => {
    mock(getSession).mockResolvedValue(SESSION);

    await expect(redirectIfLoggedIn("//evil.com")).rejects.toThrow(
      "REDIRECT:/dashboard",
    );
  });

  it("does not redirect when getSession resolves null (absent/empty/unknown/expired/pending/rejected cookie)", async () => {
    mock(getSession).mockResolvedValue(null);

    await expect(redirectIfLoggedIn("/radar")).resolves.toBeUndefined();
    expect(redirect).not.toHaveBeenCalled();
  });

  it("does not throw and does not redirect when getSession rejects (DB down)", async () => {
    mock(getSession).mockRejectedValue(new Error("connection refused"));

    await expect(redirectIfLoggedIn("/radar")).resolves.toBeUndefined();
    expect(redirect).not.toHaveBeenCalled();
  });
});

describe("getOptionalSession", () => {
  it("returns the session when getSession resolves one", async () => {
    mock(getSession).mockResolvedValue(SESSION);
    await expect(getOptionalSession()).resolves.toEqual(SESSION);
  });

  it("returns null when getSession rejects (DB down)", async () => {
    mock(getSession).mockRejectedValue(new Error("connection refused"));
    await expect(getOptionalSession()).resolves.toBeNull();
  });

  it("calls unstable_rethrow with a plain error and returns null", async () => {
    const err = new Error("db down");
    mock(getSession).mockRejectedValue(err);

    await expect(getOptionalSession()).resolves.toBeNull();
    expect(unstable_rethrow).toHaveBeenCalledWith(err);
  });

  it("rejects with the same error and does not log when unstable_rethrow throws (control-flow error)", async () => {
    const controlFlowErr = new Error("NEXT_REDIRECT");
    mock(getSession).mockRejectedValue(controlFlowErr);
    mock(unstable_rethrow).mockImplementation(() => {
      throw controlFlowErr;
    });

    await expect(getOptionalSession()).rejects.toBe(controlFlowErr);
    expect(console.error).not.toHaveBeenCalled();
  });
});
