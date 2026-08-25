import { LinkButton } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Building } from "@/components/ui/icons";
import { Section } from "@/components/ui/section";
import { CompanyForm } from "@/components/company-form";
import { requireSession } from "@/lib/auth";
import { getCompany, getCompanyCnaes } from "@/lib/company-queries";
import { COMPANY_NAV } from "@/lib/types";

export default async function CompanyPage() {
  const session = await requireSession();
  const company = await getCompany(session.user.companyId);

  if (!company) {
    return (
      <EmptyState icon={<Building size={20} />} title="Empresa não encontrada." />
    );
  }

  const cnaes = await getCompanyCnaes(session.user.companyId);

  return (
    <div className="flex flex-col gap-8">
      <Section eyebrow="Empresa" title="Minha empresa">
        <div className="flex flex-col gap-4">
          <p className="text-sm text-ink-muted">{company.legal_name}</p>
          <nav className="flex items-center gap-2">
            {COMPANY_NAV.map((item) => (
              <LinkButton
                key={item.href}
                href={item.href}
                variant="pill"
                size="sm"
                className={item.href === "/company" ? "bg-accent-soft text-accent" : undefined}
              >
                {item.label}
              </LinkButton>
            ))}
          </nav>
        </div>
      </Section>

      <CompanyForm
        company={company}
        cnaes={cnaes}
        readOnly={session.user.role !== "admin"}
      />
    </div>
  );
}
