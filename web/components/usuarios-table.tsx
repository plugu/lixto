"use client";

import { updateRoleAction, removerUsuarioAction } from "@/app/empresa/usuarios/actions";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/input";
import { X } from "@/components/ui/icons";
import { StatusDot } from "@/components/ui/status-dot";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import type { UsuarioComPendente } from "@/lib/usuario-queries";

const ROLE_LABELS: Record<string, string> = {
  admin: "Admin",
  member: "Membro",
};

export function UsuariosTable({
  rows,
  currentUserId,
}: {
  rows: UsuarioComPendente[];
  currentUserId: number;
}) {
  return (
    <Table density="compact">
      <THead>
        <TH>Nome</TH>
        <TH>E-mail</TH>
        <TH>Cargo</TH>
        <TH>Papel</TH>
        <TH>Status</TH>
        <TH>Ações</TH>
      </THead>
      <TBody>
        {rows.map((row) => {
          const isSelf = row.id === currentUserId;
          return (
            <TR key={row.id}>
              <TD>{row.nome}</TD>
              <TD>{row.email}</TD>
              <TD>{row.cargo ?? "—"}</TD>
              <TD>{ROLE_LABELS[row.role]}</TD>
              <TD>
                <StatusDot
                  tone={row.pendente ? "warn" : "ok"}
                  label={row.pendente ? "Pendente" : "Ativo"}
                />
              </TD>
              <TD>
                <div className="flex items-center gap-2">
                  <form action={updateRoleAction}>
                    <input type="hidden" name="usuarioId" value={row.id} />
                    <Select
                      name="role"
                      defaultValue={row.role}
                      disabled={isSelf}
                      onChange={(e) => e.currentTarget.form?.requestSubmit()}
                    >
                      <option value="member">Membro</option>
                      <option value="admin">Administrador</option>
                    </Select>
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
                    <Button
                      type="submit"
                      variant="ghost"
                      size="sm"
                      disabled={isSelf}
                      aria-label={`Remover ${row.nome}`}
                    >
                      <X size={16} />
                    </Button>
                  </form>
                </div>
              </TD>
            </TR>
          );
        })}
      </TBody>
    </Table>
  );
}
