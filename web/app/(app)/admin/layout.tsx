import { requireSuperadmin } from "@/lib/auth";

// Gates every /admin/* route in one place (F5): a future page under here
// that forgets its own `requireSuperadmin()` call still 404s for a
// non-superadmin instead of rendering. Each page keeps calling
// `requireSuperadmin()` itself too (defence in depth) — this layout is the
// backstop, not a replacement.
export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requireSuperadmin();
  return children;
}
