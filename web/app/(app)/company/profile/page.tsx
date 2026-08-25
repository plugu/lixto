import { LinkButton } from "@/components/ui/button";
import { Section } from "@/components/ui/section";
import { ProfileForm } from "@/components/profile-form";
import { requireSession } from "@/lib/auth";
import { getProfile } from "@/lib/profile-queries";
import { COMPANY_NAV } from "@/lib/types";

export default async function CompanyProfilePage() {
  const session = await requireSession();
  const profile = await getProfile(session.user.companyId);

  return (
    <div className="flex flex-col gap-8">
      <Section eyebrow="Empresa" title="Perfil de match">
        <div className="flex flex-col gap-4">
          <p className="text-sm text-ink-muted">
            Lixto usa estes dados para calcular a aderência de cada licitação à
            sua empresa.
          </p>
          <nav className="flex items-center gap-2">
            {COMPANY_NAV.map((item) => (
              <LinkButton
                key={item.href}
                href={item.href}
                variant="pill"
                size="sm"
                className={
                  item.href === "/company/profile"
                    ? "bg-accent-soft text-accent"
                    : undefined
                }
              >
                {item.label}
              </LinkButton>
            ))}
          </nav>
        </div>
      </Section>

      <ProfileForm
        profile={profile}
        readOnly={session.user.role !== "admin"}
      />
    </div>
  );
}
