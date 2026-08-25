"use client";

// Empresa profile form (ticket 26): admins edit + save every field; members
// see the same layout with everything disabled and no save button.
// Restyled on the cycle 8 kit (ticket 36) — action name and field names
// (`razaoSocial`, `cep`, `uf`, `cnaes`, …) stay identical.

import { useActionState, useState } from "react";
import { formatCEP, formatCNPJ, onlyDigits } from "@/lib/br-validators";
import { PORTES, UF_LIST, type Empresa, type EmpresaCnae } from "@/lib/tenant-types";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/input";
import { Section } from "@/components/ui/section";
import { CnaeEditor, type CnaeRow } from "./cnae-editor";
import { updateEmpresaAction, type EmpresaActionState } from "@/app/(app)/empresa/actions";

const INITIAL_STATE: EmpresaActionState = {};

export function EmpresaForm({
  empresa,
  cnaes,
  readOnly,
}: {
  empresa: Empresa;
  cnaes: EmpresaCnae[];
  readOnly: boolean;
}) {
  const [state, formAction, pending] = useActionState(
    updateEmpresaAction,
    INITIAL_STATE,
  );
  const [cep, setCep] = useState(empresa.cep ?? "");

  const initialCnaes: CnaeRow[] = cnaes.map((c) => ({
    codigo: c.codigo,
    descricao: c.descricao,
    principal: c.principal,
  }));

  return (
    <form action={formAction} className="flex flex-col gap-10 pb-24">
      {state.erro ? (
        <p role="alert" className="rounded-md bg-danger/10 px-3 py-2 text-sm text-danger">
          {state.erro}
        </p>
      ) : null}
      {state.ok ? (
        <p role="status" className="rounded-md bg-ok-soft px-3 py-2 text-sm text-ok">
          Alterações salvas.
        </p>
      ) : null}

      <Section title="Identificação">
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Field label="Razão social">
            <Input
              type="text"
              name="razaoSocial"
              defaultValue={empresa.razao_social}
              disabled={readOnly}
              required
            />
          </Field>
          <Field label="Nome fantasia">
            <Input
              type="text"
              name="nomeFantasia"
              defaultValue={empresa.nome_fantasia ?? ""}
              disabled={readOnly}
            />
          </Field>
          <Field label="CNPJ">
            <Input type="text" value={formatCNPJ(empresa.cnpj)} disabled readOnly />
          </Field>
          <Field label="Natureza jurídica">
            <Input
              type="text"
              name="naturezaJuridica"
              defaultValue={empresa.natureza_juridica ?? ""}
              disabled={readOnly}
            />
          </Field>
          <Field label="Porte">
            <Select name="porte" defaultValue={empresa.porte ?? ""} disabled={readOnly}>
              <option value="">Selecione</option>
              {PORTES.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </Select>
          </Field>
          <label className="flex items-center gap-2 self-end pb-2 text-sm text-ink">
            <input
              type="checkbox"
              name="optanteSimples"
              value="on"
              defaultChecked={empresa.optante_simples}
              disabled={readOnly}
              className="h-4 w-4 rounded-[6px] border border-line accent-accent disabled:opacity-50"
            />
            Optante pelo Simples Nacional
          </label>
          <Field label="Inscrição estadual">
            <Input
              type="text"
              name="inscricaoEstadual"
              defaultValue={empresa.inscricao_estadual ?? ""}
              disabled={readOnly}
            />
          </Field>
          <Field label="Inscrição municipal">
            <Input
              type="text"
              name="inscricaoMunicipal"
              defaultValue={empresa.inscricao_municipal ?? ""}
              disabled={readOnly}
            />
          </Field>
        </div>
      </Section>

      <Section title="Endereço">
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Field label="CEP">
            <Input
              type="text"
              name="cep"
              value={formatCEP(cep)}
              onChange={(e) => setCep(onlyDigits(e.target.value))}
              disabled={readOnly}
              maxLength={9}
            />
          </Field>
          <Field label="Logradouro">
            <Input
              type="text"
              name="logradouro"
              defaultValue={empresa.logradouro ?? ""}
              disabled={readOnly}
            />
          </Field>
          <Field label="Número">
            <Input
              type="text"
              name="numero"
              defaultValue={empresa.numero ?? ""}
              disabled={readOnly}
            />
          </Field>
          <Field label="Complemento">
            <Input
              type="text"
              name="complemento"
              defaultValue={empresa.complemento ?? ""}
              disabled={readOnly}
            />
          </Field>
          <Field label="Bairro">
            <Input
              type="text"
              name="bairro"
              defaultValue={empresa.bairro ?? ""}
              disabled={readOnly}
            />
          </Field>
          <Field label="Município">
            <Input
              type="text"
              name="municipio"
              defaultValue={empresa.municipio ?? ""}
              disabled={readOnly}
            />
          </Field>
          <Field label="UF">
            <Select name="uf" defaultValue={empresa.uf ?? ""} disabled={readOnly}>
              <option value="">Selecione</option>
              {UF_LIST.map((uf) => (
                <option key={uf} value={uf}>
                  {uf}
                </option>
              ))}
            </Select>
          </Field>
        </div>
      </Section>

      <Section title="Contato">
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Field label="Telefone">
            <Input
              type="text"
              name="telefone"
              defaultValue={empresa.telefone ?? ""}
              disabled={readOnly}
            />
          </Field>
          <Field label="E-mail">
            <Input
              type="email"
              name="email"
              defaultValue={empresa.email ?? ""}
              disabled={readOnly}
            />
          </Field>
        </div>
      </Section>

      <Section title="CNAEs">
        <CnaeEditor initialCnaes={initialCnaes} readOnly={readOnly} />
      </Section>

      {!readOnly ? (
        <div className="sticky bottom-0 z-10 flex items-center justify-end border-t border-line bg-canvas py-4">
          <Button type="submit" disabled={pending}>
            {pending ? "Salvando…" : "Salvar"}
          </Button>
        </div>
      ) : null}
    </form>
  );
}
