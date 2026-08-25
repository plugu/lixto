import { LinkButton } from "@/components/ui/button";
import { Section } from "@/components/ui/section";
import { PerfilMatchForm } from "@/components/perfil-match-form";
import { requireSession } from "@/lib/auth";
import { getPerfil } from "@/lib/perfil-queries";

const EMPRESA_NAV = [
  { href: "/empresa", label: "Perfil" },
  { href: "/empresa/perfil", label: "Match" },
  { href: "/empresa/usuarios", label: "Usuários" },
  { href: "/empresa/documentos", label: "Documentos" },
];

export default async function PerfilMatchPage() {
  const session = await requireSession();
  const perfil = await getPerfil(session.usuario.empresaId);

  return (
    <div className="flex flex-col gap-8">
      <Section eyebrow="Empresa" title="Perfil de match">
        <div className="flex flex-col gap-4">
          <p className="text-sm text-ink-muted">
            Lixto usa este perfil para calcular a aderência de cada licitação
            à sua empresa.
          </p>
          <nav className="flex items-center gap-2">
            {EMPRESA_NAV.map((item) => (
              <LinkButton
                key={item.href}
                href={item.href}
                variant="pill"
                size="sm"
                className={
                  item.href === "/empresa/perfil" ? "bg-accent-soft text-accent" : undefined
                }
              >
                {item.label}
              </LinkButton>
            ))}
          </nav>
        </div>
      </Section>

      <PerfilMatchForm
        perfil={perfil}
        readOnly={session.usuario.role !== "admin"}
      />
    </div>
  );
}
