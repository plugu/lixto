import { beforeEach, describe, expect, it, vi } from "vitest";

// vi.mock hoists above these imports; every dependency `actions.ts` touches
// is mocked (same pattern as
// web/app/(app)/admin/companies/actions.test.ts) so the module graph never
// opens a real DB connection or reads cookies.
vi.mock("@/lib/auth", () => ({ login: vi.fn() }));
// `actions.ts` also imports `@/lib/safe-next`, which vitest cannot resolve
// without a config alias (same issue as web/lib/email/callsites.test.ts);
// point the specifier at the *real* module so the redirect targets below
// exercise real sanitisation, not a mock.
vi.mock("@/lib/safe-next", async () => await import("../../../lib/safe-next"));
vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw new Error("REDIRECT:" + url);
  }),
}));

import { login } from "@/lib/auth";
import { redirect } from "next/navigation";
import { loginAction } from "./actions";

const mock = <T>(fn: T) => fn as unknown as ReturnType<typeof vi.fn>;

function formData(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [key, value] of Object.entries(fields)) fd.set(key, value);
  return fd;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("loginAction", () => {
  it("redirects to the sanitised next on success", async () => {
    mock(login).mockResolvedValue({ status: "ok" });

    await expect(
      loginAction(
        formData({ email: "a@b.com", password: "x", next: "/radar" }),
      ),
    ).rejects.toThrow("REDIRECT:/radar");
    expect(redirect).toHaveBeenCalledWith("/radar");
  });

  it("falls back to /dashboard when next is a protocol-relative target", async () => {
    mock(login).mockResolvedValue({ status: "ok" });

    await expect(
      loginAction(
        formData({ email: "a@b.com", password: "x", next: "//evil.com" }),
      ),
    ).rejects.toThrow("REDIRECT:/dashboard");
  });

  it("falls back to /dashboard when next is a backslash-prefixed target", async () => {
    mock(login).mockResolvedValue({ status: "ok" });

    await expect(
      loginAction(
        formData({ email: "a@b.com", password: "x", next: "/\\evil.com" }),
      ),
    ).rejects.toThrow("REDIRECT:/dashboard");
  });

  it("falls back to /dashboard when there is no next", async () => {
    mock(login).mockResolvedValue({ status: "ok" });

    await expect(
      loginAction(formData({ email: "a@b.com", password: "x" })),
    ).rejects.toThrow("REDIRECT:/dashboard");
  });

  it("falls back to /dashboard when next is /logout", async () => {
    mock(login).mockResolvedValue({ status: "ok" });

    await expect(
      loginAction(
        formData({ email: "a@b.com", password: "x", next: "/logout" }),
      ),
    ).rejects.toThrow("REDIRECT:/dashboard");
  });

  it("redirects back to /login with the error and sanitised next on invalid credentials", async () => {
    mock(login).mockResolvedValue({ status: "invalid" });

    await expect(
      loginAction(
        formData({ email: "a@b.com", password: "x", next: "/radar" }),
      ),
    ).rejects.toThrow("REDIRECT:/login?error=invalid&next=%2Fradar");
  });

  it("drops a hostile next from the error redirect", async () => {
    mock(login).mockResolvedValue({ status: "invalid" });

    await expect(
      loginAction(
        formData({ email: "a@b.com", password: "x", next: "//evil.com" }),
      ),
    ).rejects.toThrow("REDIRECT:/login?error=invalid");
  });

  it("redirects to /login with error=pending", async () => {
    mock(login).mockResolvedValue({ status: "pending" });

    await expect(
      loginAction(formData({ email: "a@b.com", password: "x" })),
    ).rejects.toThrow("REDIRECT:/login?error=pending");
  });
});
