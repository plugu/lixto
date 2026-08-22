import { headers } from "next/headers";
import { ConviteForm } from "@/components/convite-form";
import { UsuariosTable } from "@/components/usuarios-table";
import { requireAdmin } from "@/lib/auth";
import { listUsuarios } from "@/lib/usuario-queries";

export default async function UsuariosPage() {
  const session = await requireAdmin();

  const headerList = await headers();
  const host = headerList.get("host") ?? "";
  const proto = process.env.NODE_ENV === "production" ? "https" : "http";
  const origin = `${proto}://${host}`;

  const rows = await listUsuarios(session.empresa.id);

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="font-display text-2xl font-bold tracking-tight">
          Usuários
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Gerencie quem tem acesso à conta de {session.empresa.razaoSocial}.
        </p>
      </div>

      <ConviteForm origin={origin} />

      <UsuariosTable rows={rows} currentUserId={session.usuario.id} />
    </div>
  );
}
