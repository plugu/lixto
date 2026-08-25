"use client";

import { updateRoleAction, removeUserAction } from "@/app/(app)/company/users/actions";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/input";
import { X } from "@/components/ui/icons";
import { StatusDot } from "@/components/ui/status-dot";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import type { UserWithPending } from "@/lib/user-queries";

const ROLE_LABELS: Record<string, string> = {
  admin: "Admin",
  member: "Membro",
};

function UserActions({
  row,
  isSelf,
}: {
  row: UserWithPending;
  isSelf: boolean;
}) {
  return (
    <div className="flex items-center gap-2">
      <form action={updateRoleAction}>
        <input type="hidden" name="userId" value={row.id} />
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
        action={removeUserAction}
        onSubmit={(e) => {
          if (!confirm(`Remover ${row.name}?`)) {
            e.preventDefault();
          }
        }}
      >
        <input type="hidden" name="userId" value={row.id} />
        <Button
          type="submit"
          variant="ghost"
          size="sm"
          disabled={isSelf}
          aria-label={`Remover ${row.name}`}
        >
          <X size={16} />
        </Button>
      </form>
    </div>
  );
}

export function UsersTable({
  rows,
  currentUserId,
}: {
  rows: UserWithPending[];
  currentUserId: number;
}) {
  return (
    <>
      {/* Stacked-card reflow below `md` (ticket 45) — same rows/fields as the
          table, name prominent, cargo/status secondary, actions in footer. */}
      <div className="flex flex-col gap-2.5 md:hidden">
        {rows.map((row) => {
          const isSelf = row.id === currentUserId;
          return (
            <div
              key={row.id}
              className="flex flex-col gap-2.5 rounded-[10px] border border-line bg-surface p-3.5"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex flex-col gap-0.5">
                  <p className="text-sm font-medium text-ink">{row.name}</p>
                  <p className="truncate text-xs text-ink-muted">{row.email}</p>
                </div>
                <StatusDot
                  tone={row.pending ? "warn" : "ok"}
                  label={row.pending ? "Pendente" : "Ativo"}
                />
              </div>
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-muted">
                <span>Cargo: {row.job_title ?? "—"}</span>
                <span>Papel: {ROLE_LABELS[row.role]}</span>
              </div>
              <div className="border-t border-line pt-2.5">
                <UserActions row={row} isSelf={isSelf} />
              </div>
            </div>
          );
        })}
      </div>

      <div className="hidden overflow-x-auto md:block">
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
                  <TD>{row.name}</TD>
                  <TD>{row.email}</TD>
                  <TD>{row.job_title ?? "—"}</TD>
                  <TD>{ROLE_LABELS[row.role]}</TD>
                  <TD>
                    <StatusDot
                      tone={row.pending ? "warn" : "ok"}
                      label={row.pending ? "Pendente" : "Ativo"}
                    />
                  </TD>
                  <TD>
                    <UserActions row={row} isSelf={isSelf} />
                  </TD>
                </TR>
              );
            })}
          </TBody>
        </Table>
      </div>
    </>
  );
}
