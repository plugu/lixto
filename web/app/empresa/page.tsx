import { requireSession } from "@/lib/auth";
import { getCnaes, getEmpresa } from "@/lib/empresa-queries";
import { EmpresaForm } from "@/components/empresa-form";

export default async function EmpresaPage() {
  const session = await requireSession();
  const empresa = await getEmpresa(session.usuario.empresaId);

  if (!empresa) {
    return (
      <div className="min-h-[40vh] rounded-lg border border-dashed border-border flex items-center justify-center text-sm text-muted-foreground">
        Empresa não encontrada.
      </div>
    );
  }

  const cnaes = await getCnaes(session.usuario.empresaId);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="font-display text-2xl font-bold tracking-tight">
          Minha empresa
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {empresa.razao_social}
        </p>
      </div>

      <EmpresaForm
        empresa={empresa}
        cnaes={cnaes}
        readOnly={session.usuario.role !== "admin"}
      />
    </div>
  );
}
