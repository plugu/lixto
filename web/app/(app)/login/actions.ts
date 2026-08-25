"use server";

import { redirect } from "next/navigation";
import { login } from "@/lib/auth";

export async function loginAction(formData: FormData): Promise<void> {
  const email = String(formData.get("email") ?? "");
  const password = String(formData.get("password") ?? "");
  const next = String(formData.get("next") ?? "");

  const session = await login(email, password);
  if (!session) {
    const params = new URLSearchParams({ error: "1" });
    if (next.startsWith("/")) params.set("next", next);
    redirect(`/login?${params.toString()}`);
  }

  // Only allow same-origin relative targets (no "//evil.com").
  const target = next.startsWith("/") && !next.startsWith("//") ? next : "/";
  redirect(target);
}
