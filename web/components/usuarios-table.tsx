"use client";

import { updateRoleAction, removerUsuarioAction } from "@/app/empresa/usuarios/actions";
import type { UsuarioComPendente } from "@/lib/usuario-queries";

const BADGE_CLASS = "inline-flex shrink-0 items-center self-start rounded-full border px-2.5 py-0.5 text-xs font-semibold";

const ROLE_STYLES: Record<string, string> = {
  admin: "border-met/30 bg-met/10 text-met",
  member: "border-border bg-muted text-muted-foreground",
};

const ROLE_LABELS: Record<string, string> = {
  admin: "Admin",
  member: "Membro",
};

const STATUS_STYLES = {
  pendente: "border-partial/30 bg-partial/10 text-partial",
  ativo: "border-met/30 bg-met/10 text-met",
};

export function UsuariosTable({
  rows,
  currentUserId,
}: {
  rows: UsuarioComPendente[];
  currentUserId: number;
}) {
  return (
    <div className="overflow-hidden rounded-lg border border-border bg-card shadow-subtle">
      <table className="w-full text-left">
        <thead className="bg-muted/50">
          <tr>
            <th className="px-4 py-3 font-medium text-muted-foreground">Nome</th>
            <th className="px-4 py-3 font-medium text-muted-foreground">E-mail</th>
            <th className="px-4 py-3 font-medium text-muted-foreground">Cargo</th>
            <th className="px-4 py-3 font-medium text-muted-foreground">Papel</th>
            <th className="px-4 py-3 font-medium text-muted-foreground">Status</th>
            <th className="px-4 py-3 font-medium text-muted-foreground">Ações</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {rows.map((row) => {
            const isSelf = row.id === currentUserId;
            return (
              <tr key={row.id} className="transition-colors hover:bg-muted/30">
                <td className="px-4 py-3">{row.nome}</td>
                <td className="px-4 py-3">{row.email}</td>
                <td className="px-4 py-3">{row.cargo ?? "—"}</td>
                <td className="px-4 py-3">
                  <span className={`${BADGE_CLASS} ${ROLE_STYLES[row.role]}`}>
                    {ROLE_LABELS[row.role]}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <span
                    className={`${BADGE_CLASS} ${
                      row.pendente ? STATUS_STYLES.pendente : STATUS_STYLES.ativo
                    }`}
                  >
                    {row.pendente ? "Pendente" : "Ativo"}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-3">
                    <form action={updateRoleAction}>
                      <input type="hidden" name="usuarioId" value={row.id} />
                      <select
                        name="role"
                        defaultValue={row.role}
                        disabled={isSelf}
                        onChange={(e) => e.currentTarget.form?.requestSubmit()}
                        className="max-w-56 rounded-lg border border-border bg-card px-2 py-1 text-xs shadow-subtle outline-none focus-visible:ring-2 focus-visible:ring-accent/40 disabled:opacity-50"
                      >
                        <option value="member">Membro</option>
                        <option value="admin">Administrador</option>
                      </select>
                    </form>
                    <form
                      action={removerUsuarioAction}
                      onSubmit={(e) => {
                        if (!confirm(`Remover ${row.nome}?`)) {
                          e.preventDefault();
                        }
                      }}
                    >
                      <input type="hidden" name="usuarioId" value={row.id} />
                      <button
                        type="submit"
                        disabled={isSelf}
                        className="rounded-lg border border-border px-2.5 py-1 text-xs font-semibold text-foreground shadow-subtle transition-colors hover:bg-muted/60 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        Remover
                      </button>
                    </form>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
