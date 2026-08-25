"use client";

// Company profile form: admins edit + save every field; members see the same
// layout with everything disabled and no save button. Ported from the legacy
// empresa-form (same layout and copy); field names are now English and match
// the lixto `companies` columns.

import { useActionState, useState } from "react";
import { formatCEP, formatCNPJ, onlyDigits } from "@/lib/br-validators";
import {
  COMPANY_SIZES,
  UF_LIST,
  type Company,
  type CompanyCnae,
} from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/input";
import { Section } from "@/components/ui/section";
import { CnaeEditor, type CnaeRow } from "./cnae-editor";
import {
  updateCompanyAction,
  type CompanyActionState,
} from "@/app/(app)/company/actions";

const INITIAL_STATE: CompanyActionState = {};

export function CompanyForm({
  company,
  cnaes,
  readOnly,
}: {
  company: Company;
  cnaes: CompanyCnae[];
  readOnly: boolean;
}) {
  const [state, formAction, pending] = useActionState(
    updateCompanyAction,
    INITIAL_STATE,
  );
  const [postalCode, setPostalCode] = useState(company.postal_code ?? "");

  const initialCnaes: CnaeRow[] = cnaes.map((c) => ({
    code: c.cnae_code,
    description: c.description,
    isPrimary: c.is_primary,
  }));

  return (
    <form action={formAction} className="flex flex-col gap-10 pb-24">
      {state.error ? (
        <p role="alert" className="rounded-md bg-danger/10 px-3 py-2 text-sm text-danger">
          {state.error}
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
              name="legalName"
              defaultValue={company.legal_name}
              disabled={readOnly}
              required
            />
          </Field>
          <Field label="Nome fantasia">
            <Input
              type="text"
              name="tradeName"
              defaultValue={company.trade_name ?? ""}
              disabled={readOnly}
            />
          </Field>
          <Field label="CNPJ">
            <Input type="text" value={formatCNPJ(company.tax_id)} disabled readOnly />
          </Field>
          <Field label="Natureza jurídica">
            <Input
              type="text"
              name="legalNature"
              defaultValue={company.legal_nature ?? ""}
              disabled={readOnly}
            />
          </Field>
          <Field label="Porte">
            <Select name="size" defaultValue={company.size ?? ""} disabled={readOnly}>
              <option value="">Selecione</option>
              {COMPANY_SIZES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </Select>
          </Field>
          <label className="flex items-center gap-2 self-end pb-2 text-sm text-ink">
            <input
              type="checkbox"
              name="simplesOptant"
              value="on"
              defaultChecked={company.simples_optant}
              disabled={readOnly}
              className="h-4 w-4 rounded-[6px] border border-line accent-accent disabled:opacity-50"
            />
            Optante pelo Simples Nacional
          </label>
          <Field label="Inscrição estadual">
            <Input
              type="text"
              name="stateRegistration"
              defaultValue={company.state_registration ?? ""}
              disabled={readOnly}
            />
          </Field>
          <Field label="Inscrição municipal">
            <Input
              type="text"
              name="municipalRegistration"
              defaultValue={company.municipal_registration ?? ""}
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
              name="postalCode"
              value={formatCEP(postalCode)}
              onChange={(e) => setPostalCode(onlyDigits(e.target.value))}
              disabled={readOnly}
              maxLength={9}
            />
          </Field>
          <Field label="Logradouro">
            <Input
              type="text"
              name="street"
              defaultValue={company.street ?? ""}
              disabled={readOnly}
            />
          </Field>
          <Field label="Número">
            <Input
              type="text"
              name="streetNumber"
              defaultValue={company.street_number ?? ""}
              disabled={readOnly}
            />
          </Field>
          <Field label="Complemento">
            <Input
              type="text"
              name="addressLine2"
              defaultValue={company.address_line2 ?? ""}
              disabled={readOnly}
            />
          </Field>
          <Field label="Bairro">
            <Input
              type="text"
              name="district"
              defaultValue={company.district ?? ""}
              disabled={readOnly}
            />
          </Field>
          <Field label="Município">
            <Input
              type="text"
              name="cityName"
              defaultValue={company.city_name ?? ""}
              disabled={readOnly}
            />
          </Field>
          <Field label="UF">
            <Select name="state" defaultValue={company.state ?? ""} disabled={readOnly}>
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
              name="phone"
              defaultValue={company.phone ?? ""}
              disabled={readOnly}
            />
          </Field>
          <Field label="E-mail">
            <Input
              type="email"
              name="email"
              defaultValue={company.email ?? ""}
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
