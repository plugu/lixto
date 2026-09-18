"use server";

import { redirect } from "next/navigation";
import { login } from "@/lib/auth";

export async function loginAction(formData: FormData): Promise<void> {
  const email = String(formData.get("email") ?? "");
  const password = String(formData.get("password") ?? "");
  const next = String(formData.get("next") ?? "");

  // "invalid" | "pending" | "rejected" round-trip as ?error= so the login
  // page can render the right copy; only "ok" carries a session/cookie.
  const result = await login(email, password);
  if (result.status !== "ok") {
    const params = new URLSearchParams({ error: result.status });
    if (next.startsWith("/")) params.set("next", next);
    redirect(`/login?${params.toString()}`);
  }

  // Only allow same-origin relative targets (no "//evil.com"). Without a
  // `next`, land on the dashboard: `/` is the public marketing page.
  const target =
    next.startsWith("/") && !next.startsWith("//") ? next : "/dashboard";
  redirect(target);
}
