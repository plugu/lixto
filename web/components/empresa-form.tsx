"use client";

// Empresa profile form (ticket 26): admins edit + save every field; members
// see the same layout with everything disabled and no save button.

import { useActionState, useState, type ReactNode } from "react";
import { formatCEP, formatCNPJ, onlyDigits } from "@/lib/br-validators";
import { PORTES, UF_LIST, type Empresa, type EmpresaCnae } from "@/lib/tenant-types";
import { CnaeEditor, type CnaeRow } from "./cnae-editor";
import { updateEmpresaAction, type EmpresaActionState } from "@/app/empresa/actions";

const INPUT_CLASS =
  "w-full rounded-lg border border-border bg-card px-3 py-2 text-sm shadow-subtle outline-none focus-visible:ring-2 focus-visible:ring-accent/40 disabled:opacity-60 disabled:cursor-not-allowed";
const LABEL_CLASS = "text-xs font-medium text-muted-foreground";
const CARD_CLASS =
  "rounded-lg border border-border bg-card p-5 shadow-subtle flex flex-col gap-4";
const CARD_TITLE_CLASS = "font-display text-base font-semibold tracking-tight";

function Field({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className={LABEL_CLASS}>{label}</span>
      {children}
    </label>
  );
}

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
    <form action={formAction} className="flex flex-col gap-6">
      {state.erro ? (
        <p
          role="alert"
          className="rounded-lg border border-unclear/30 bg-unclear/10 px-3 py-2 text-sm text-foreground"
        >
          {state.erro}
        </p>
      ) : null}
      {state.ok ? (
        <p
          role="status"
          className="rounded-lg border border-met/30 bg-met/10 px-3 py-2 text-sm text-foreground"
        >
          Alterações salvas.
        </p>
      ) : null}

      <section className={CARD_CLASS}>
        <h2 className={CARD_TITLE_CLASS}>Identificação</h2>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Razão social">
            <input
              type="text"
              name="razaoSocial"
              defaultValue={empresa.razao_social}
              disabled={readOnly}
              required
              className={INPUT_CLASS}
            />
          </Field>
          <Field label="Nome fantasia">
            <input
              type="text"
              name="nomeFantasia"
              defaultValue={empresa.nome_fantasia ?? ""}
              disabled={readOnly}
              className={INPUT_CLASS}
            />
          </Field>
          <Field label="CNPJ">
            <input
              type="text"
              value={formatCNPJ(empresa.cnpj)}
              disabled
              readOnly
              className={INPUT_CLASS}
            />
          </Field>
          <Field label="Natureza jurídica">
            <input
              type="text"
              name="naturezaJuridica"
              defaultValue={empresa.natureza_juridica ?? ""}
              disabled={readOnly}
              className={INPUT_CLASS}
            />
          </Field>
          <Field label="Porte">
            <select
              name="porte"
              defaultValue={empresa.porte ?? ""}
              disabled={readOnly}
              className={`${INPUT_CLASS} max-w-56`}
            >
              <option value="">Selecione</option>
              {PORTES.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </Field>
          <label className="mt-6 flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              name="optanteSimples"
              value="on"
              defaultChecked={empresa.optante_simples}
              disabled={readOnly}
            />
            Optante pelo Simples Nacional
          </label>
          <Field label="Inscrição estadual">
            <input
              type="text"
              name="inscricaoEstadual"
              defaultValue={empresa.inscricao_estadual ?? ""}
              disabled={readOnly}
              className={INPUT_CLASS}
            />
          </Field>
          <Field label="Inscrição municipal">
            <input
              type="text"
              name="inscricaoMunicipal"
              defaultValue={empresa.inscricao_municipal ?? ""}
              disabled={readOnly}
              className={INPUT_CLASS}
            />
          </Field>
        </div>
      </section>

      <section className={CARD_CLASS}>
        <h2 className={CARD_TITLE_CLASS}>Endereço</h2>
        <div className="grid grid-cols-3 gap-4">
          <Field label="CEP">
            <input
              type="text"
              name="cep"
              value={formatCEP(cep)}
              onChange={(e) => setCep(onlyDigits(e.target.value))}
              disabled={readOnly}
              maxLength={9}
              className={INPUT_CLASS}
            />
          </Field>
          <Field label="Logradouro">
            <input
              type="text"
              name="logradouro"
              defaultValue={empresa.logradouro ?? ""}
              disabled={readOnly}
              className={INPUT_CLASS}
            />
          </Field>
          <Field label="Número">
            <input
              type="text"
              name="numero"
              defaultValue={empresa.numero ?? ""}
              disabled={readOnly}
              className={INPUT_CLASS}
            />
          </Field>
          <Field label="Complemento">
            <input
              type="text"
              name="complemento"
              defaultValue={empresa.complemento ?? ""}
              disabled={readOnly}
              className={INPUT_CLASS}
            />
          </Field>
          <Field label="Bairro">
            <input
              type="text"
              name="bairro"
              defaultValue={empresa.bairro ?? ""}
              disabled={readOnly}
              className={INPUT_CLASS}
            />
          </Field>
          <Field label="Município">
            <input
              type="text"
              name="municipio"
              defaultValue={empresa.municipio ?? ""}
              disabled={readOnly}
              className={INPUT_CLASS}
            />
          </Field>
          <Field label="UF">
            <select
              name="uf"
              defaultValue={empresa.uf ?? ""}
              disabled={readOnly}
              className={`${INPUT_CLASS} max-w-56`}
            >
              <option value="">Selecione</option>
              {UF_LIST.map((uf) => (
                <option key={uf} value={uf}>
                  {uf}
                </option>
              ))}
            </select>
          </Field>
        </div>
      </section>

      <section className={CARD_CLASS}>
        <h2 className={CARD_TITLE_CLASS}>Contato</h2>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Telefone">
            <input
              type="text"
              name="telefone"
              defaultValue={empresa.telefone ?? ""}
              disabled={readOnly}
              className={INPUT_CLASS}
            />
          </Field>
          <Field label="E-mail">
            <input
              type="email"
              name="email"
              defaultValue={empresa.email ?? ""}
              disabled={readOnly}
              className={INPUT_CLASS}
            />
          </Field>
        </div>
      </section>

      <section className={CARD_CLASS}>
        <h2 className={CARD_TITLE_CLASS}>CNAEs</h2>
        <CnaeEditor initialCnaes={initialCnaes} readOnly={readOnly} />
      </section>

      {!readOnly ? (
        <button
          type="submit"
          disabled={pending}
          className="self-start rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground shadow-sm transition-all duration-150 hover:bg-primary/90 active:scale-[0.98] disabled:opacity-60"
        >
          {pending ? "Salvando…" : "Salvar"}
        </button>
      ) : null}
    </form>
  );
}
