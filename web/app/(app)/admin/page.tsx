import { redirect } from "next/navigation";

import { requireSuperadmin } from "@/lib/auth";

// `/admin` has no dashboard of its own; send superadmins to the only admin
// surface. Non-superadmins still 404 (the layout and this call both gate).
export default async function AdminIndexPage(): Promise<never> {
  await requireSuperadmin();
  redirect("/admin/companies");
}
