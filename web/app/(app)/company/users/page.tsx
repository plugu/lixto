import { headers } from "next/headers";
import { LinkButton } from "@/components/ui/button";
import { Section } from "@/components/ui/section";
import { InviteForm } from "@/components/invite-form";
import { UsersTable } from "@/components/users-table";
import { requireAdmin } from "@/lib/auth";
import { listUsers } from "@/lib/user-queries";
import { COMPANY_NAV } from "@/lib/types";

export default async function UsersPage() {
  const session = await requireAdmin();

  const headerList = await headers();
  const host = headerList.get("host") ?? "";
  const proto = process.env.NODE_ENV === "production" ? "https" : "http";
  const origin = `${proto}://${host}`;

  const rows = await listUsers(session.company.id);

  return (
    <div className="flex flex-col gap-8">
      <Section eyebrow="Empresa" title="Usuários">
        <div className="flex flex-col gap-4">
          <p className="text-sm text-ink-muted">
            Gerencie quem tem acesso à conta de {session.company.legalName}.
          </p>
          <nav className="flex items-center gap-2">
            {COMPANY_NAV.map((item) => (
              <LinkButton
                key={item.href}
                href={item.href}
                variant="pill"
                size="sm"
                className={
                  item.href === "/company/users" ? "bg-accent-soft text-accent" : undefined
                }
              >
                {item.label}
              </LinkButton>
            ))}
          </nav>
        </div>
      </Section>

      <InviteForm origin={origin} />

      <UsersTable rows={rows} currentUserId={session.user.id} />
    </div>
  );
}
