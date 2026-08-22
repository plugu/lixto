import { requireSession } from "@/lib/auth";
import { DocumentoUploadForm } from "@/components/documento-upload-form";
import { DocumentosEmpresaTable } from "@/components/documentos-empresa-table";
import { listDocumentos } from "@/lib/documento-queries";

export default async function DocumentosPage() {
  const session = await requireSession();
  const isAdmin = session.usuario.role === "admin";
  const documentos = await listDocumentos(session.empresa.id);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="font-display text-2xl font-bold tracking-tight">
          Documentos
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Documentos de habilitação da empresa.
        </p>
      </div>

      {isAdmin ? (
        <div className="rounded-lg border border-border bg-card p-6 shadow-subtle">
          <h2 className="text-sm font-semibold text-foreground">
            Enviar documento
          </h2>
          <DocumentoUploadForm />
        </div>
      ) : null}

      {documentos.length === 0 ? (
        <div className="flex min-h-[40vh] items-center justify-center rounded-lg border border-dashed border-border text-sm text-muted-foreground">
          Nenhum documento enviado ainda.
        </div>
      ) : (
        <DocumentosEmpresaTable documentos={documentos} isAdmin={isAdmin} />
      )}
    </div>
  );
}
