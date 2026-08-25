import { LinkButton } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { FileText } from "@/components/ui/icons";
import { Section } from "@/components/ui/section";
import { DocumentUploadForm } from "@/components/document-upload-form";
import { CompanyDocumentsTable } from "@/components/company-documents-table";
import { requireSession } from "@/lib/auth";
import { listDocuments } from "@/lib/document-queries";

// The "Match" tab (/company/profile) is added by ticket 82.
const COMPANY_NAV = [
  { href: "/company", label: "Perfil" },
  { href: "/company/users", label: "Usuários" },
  { href: "/company/documents", label: "Documentos" },
];

export default async function DocumentsPage() {
  const session = await requireSession();
  const isAdmin = session.user.role === "admin";
  const documents = await listDocuments(session.company.id);

  return (
    <div className="flex flex-col gap-8">
      <Section eyebrow="Empresa" title="Documentos">
        <div className="flex flex-col gap-4">
          <p className="text-sm text-ink-muted">
            Documentos de habilitação da empresa.
          </p>
          <nav className="flex items-center gap-2">
            {COMPANY_NAV.map((item) => (
              <LinkButton
                key={item.href}
                href={item.href}
                variant="pill"
                size="sm"
                className={
                  item.href === "/company/documents" ? "bg-accent-soft text-accent" : undefined
                }
              >
                {item.label}
              </LinkButton>
            ))}
          </nav>
        </div>
      </Section>

      {isAdmin ? <DocumentUploadForm /> : null}

      {documents.length === 0 ? (
        <EmptyState icon={<FileText size={20} />} title="Nenhum documento enviado ainda." />
      ) : (
        <CompanyDocumentsTable documents={documents} isAdmin={isAdmin} />
      )}
    </div>
  );
}
