import { LinkButton } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { FileText } from "@/components/ui/icons";
import { Section } from "@/components/ui/section";
import { DocumentoUploadForm } from "@/components/documento-upload-form";
import { DocumentosEmpresaTable } from "@/components/documentos-empresa-table";
import { requireSession } from "@/lib/auth";
import { listDocumentos } from "@/lib/documento-queries";

const EMPRESA_NAV = [
  { href: "/empresa", label: "Perfil" },
  { href: "/empresa/usuarios", label: "Usuários" },
  { href: "/empresa/documentos", label: "Documentos" },
];

export default async function DocumentosPage() {
  const session = await requireSession();
  const isAdmin = session.usuario.role === "admin";
  const documentos = await listDocumentos(session.empresa.id);

  return (
    <div className="flex flex-col gap-8">
      <Section eyebrow="Empresa" title="Documentos">
        <div className="flex flex-col gap-4">
          <p className="text-sm text-ink-muted">
            Documentos de habilitação da empresa.
          </p>
          <nav className="flex items-center gap-2">
            {EMPRESA_NAV.map((item) => (
              <LinkButton
                key={item.href}
                href={item.href}
                variant="pill"
                size="sm"
                className={
                  item.href === "/empresa/documentos" ? "bg-accent-soft text-accent" : undefined
                }
              >
                {item.label}
              </LinkButton>
            ))}
          </nav>
        </div>
      </Section>

      {isAdmin ? <DocumentoUploadForm /> : null}

      {documentos.length === 0 ? (
        <EmptyState icon={<FileText size={20} />} title="Nenhum documento enviado ainda." />
      ) : (
        <DocumentosEmpresaTable documentos={documentos} isAdmin={isAdmin} />
      )}
    </div>
  );
}
