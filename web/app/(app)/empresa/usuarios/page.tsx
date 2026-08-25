import { headers } from "next/headers";
import { LinkButton } from "@/components/ui/button";
import { Section } from "@/components/ui/section";
import { ConviteForm } from "@/components/convite-form";
import { UsuariosTable } from "@/components/usuarios-table";
import { requireAdmin } from "@/lib/auth";
import { listUsuarios } from "@/lib/usuario-queries";

const EMPRESA_NAV = [
  { href: "/empresa", label: "Perfil" },
  { href: "/empresa/perfil", label: "Match" },
  { href: "/empresa/usuarios", label: "Usuários" },
  { href: "/empresa/documentos", label: "Documentos" },
];

export default async function UsuariosPage() {
  const session = await requireAdmin();

  const headerList = await headers();
  const host = headerList.get("host") ?? "";
  const proto = process.env.NODE_ENV === "production" ? "https" : "http";
  const origin = `${proto}://${host}`;

  const rows = await listUsuarios(session.empresa.id);

  return (
    <div className="flex flex-col gap-8">
      <Section eyebrow="Empresa" title="Usuários">
        <div className="flex flex-col gap-4">
          <p className="text-sm text-ink-muted">
            Gerencie quem tem acesso à conta de {session.empresa.razaoSocial}.
          </p>
          <nav className="flex items-center gap-2">
            {EMPRESA_NAV.map((item) => (
              <LinkButton
                key={item.href}
                href={item.href}
                variant="pill"
                size="sm"
                className={
                  item.href === "/empresa/usuarios" ? "bg-accent-soft text-accent" : undefined
                }
              >
                {item.label}
              </LinkButton>
            ))}
          </nav>
        </div>
      </Section>

      <ConviteForm origin={origin} />

      <UsuariosTable rows={rows} currentUserId={session.usuario.id} />
    </div>
  );
}
