import { LinkButton } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Building } from "@/components/ui/icons";
import { Section } from "@/components/ui/section";
import { EmpresaForm } from "@/components/empresa-form";
import { requireSession } from "@/lib/auth";
import { getCnaes, getEmpresa } from "@/lib/empresa-queries";

const EMPRESA_NAV = [
  { href: "/empresa", label: "Perfil" },
  { href: "/empresa/perfil", label: "Match" },
  { href: "/empresa/usuarios", label: "Usuários" },
  { href: "/empresa/documentos", label: "Documentos" },
];

export default async function EmpresaPage() {
  const session = await requireSession();
  const empresa = await getEmpresa(session.usuario.empresaId);

  if (!empresa) {
    return (
      <EmptyState icon={<Building size={20} />} title="Empresa não encontrada." />
    );
  }

  const cnaes = await getCnaes(session.usuario.empresaId);

  return (
    <div className="flex flex-col gap-8">
      <Section eyebrow="Empresa" title="Minha empresa">
        <div className="flex flex-col gap-4">
          <p className="text-sm text-ink-muted">{empresa.razao_social}</p>
          <nav className="flex items-center gap-2">
            {EMPRESA_NAV.map((item) => (
              <LinkButton
                key={item.href}
                href={item.href}
                variant="pill"
                size="sm"
                className={item.href === "/empresa" ? "bg-accent-soft text-accent" : undefined}
              >
                {item.label}
              </LinkButton>
            ))}
          </nav>
        </div>
      </Section>

      <EmpresaForm
        empresa={empresa}
        cnaes={cnaes}
        readOnly={session.usuario.role !== "admin"}
      />
    </div>
  );
}
