"use client";

import { useActionState, useState } from "react";
import { formatCNPJ, onlyDigits } from "@/lib/br-validators";
import {
  lookupAction,
  signupAction,
  type SignupState,
} from "@/app/(app)/signup/actions";
import { COMPANY_SIZES, UF_LIST } from "@/lib/types";
import { Field, Input, Select } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Section } from "@/components/ui/section";
import { StatusDot } from "@/components/ui/status-dot";
import { Check, X } from "@/components/ui/icons";

const INITIAL_STATE: SignupState = { erro: null };

type CnaeRow = {
  code: string;
  description: string;
  isPrimary: boolean;
};

export function SignupForm() {
  const [state, formAction, pending] = useActionState(
    signupAction,
    INITIAL_STATE,
  );

  const [taxId, setTaxId] = useState("");
  const [searching, setSearching] = useState(false);
  const [searchFailed, setSearchFailed] = useState(false);

  const [legalName, setLegalName] = useState("");
  const [tradeName, setTradeName] = useState("");
  const [legalNature, setLegalNature] = useState("");
  const [size, setSize] = useState("");
  const [simplesOptant, setSimplesOptant] = useState(false);
  const [stateRegistration, setStateRegistration] = useState("");
  const [municipalRegistration, setMunicipalRegistration] = useState("");
  const [postalCode, setPostalCode] = useState("");
  const [street, setStreet] = useState("");
  const [streetNumber, setStreetNumber] = useState("");
  const [addressLine2, setAddressLine2] = useState("");
  const [district, setDistrict] = useState("");
  const [cityName, setCityName] = useState("");
  const [companyState, setCompanyState] = useState("");
  const [companyPhone, setCompanyPhone] = useState("");
  const [companyEmail, setCompanyEmail] = useState("");

  const [cnaes, setCnaes] = useState<CnaeRow[]>([]);
  const [newCnaeCode, setNewCnaeCode] = useState("");
  const [newCnaeDescription, setNewCnaeDescription] = useState("");

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [cpf, setCpf] = useState("");
  const [phone, setPhone] = useState("");
  const [jobTitle, setJobTitle] = useState("");

  const primaryIndex = cnaes.findIndex((c) => c.isPrimary);

  async function handleLookup() {
    setSearching(true);
    setSearchFailed(false);
    try {
      const result = await lookupAction(taxId);
      if (!result) {
        setSearchFailed(true);
        return;
      }
      setLegalName(result.legalName);
      setTradeName(result.tradeName ?? "");
      setLegalNature(result.legalNature ?? "");
      setSize(result.size ?? "");
      setSimplesOptant(result.simplesOptant);
      setPostalCode(result.postalCode ?? "");
      setStreet(result.street ?? "");
      setStreetNumber(result.streetNumber ?? "");
      setAddressLine2(result.addressLine2 ?? "");
      setDistrict(result.district ?? "");
      setCityName(result.cityName ?? "");
      setCompanyState(result.state ?? "");
      setCompanyPhone(result.phone ?? "");
      setCompanyEmail(result.email ?? "");
      setCnaes(result.cnaes);
    } finally {
      setSearching(false);
    }
  }

  function handleAddCnae() {
    if (!newCnaeCode.trim() || !newCnaeDescription.trim()) return;
    setCnaes((prev) => [
      ...prev,
      {
        code: newCnaeCode.trim(),
        description: newCnaeDescription.trim(),
        isPrimary: prev.length === 0,
      },
    ]);
    setNewCnaeCode("");
    setNewCnaeDescription("");
  }

  function handleRemoveCnae(index: number) {
    setCnaes((prev) => {
      const next = prev.filter((_, i) => i !== index);
      if (!next.some((c) => c.isPrimary) && next.length > 0) {
        next[0] = { ...next[0], isPrimary: true };
      }
      return next;
    });
  }

  function handleSetPrimary(index: number) {
    setCnaes((prev) => prev.map((c, i) => ({ ...c, isPrimary: i === index })));
  }

  return (
    <form action={formAction} className="mt-2 flex flex-col gap-8">
      {state.erro ? (
        <p
          role="alert"
          className="rounded-md bg-warn-soft px-3 py-2 text-sm text-warn"
        >
          {state.erro}
        </p>
      ) : null}

      <div className="flex items-center gap-6">
        <StatusDot tone="accent" label="Empresa" />
        <StatusDot tone="neutral" label="CNAEs" />
        <StatusDot tone="neutral" label="Usuário" />
      </div>

      <Section title="Dados da empresa">
        <div className="flex items-end gap-3">
          <div className="flex-1">
            <Field label="CNPJ">
              <Input
                type="text"
                name="taxId"
                required
                value={taxId}
                onChange={(e) => setTaxId(e.target.value)}
                onBlur={(e) => setTaxId(formatCNPJ(onlyDigits(e.target.value)))}
                placeholder="00.000.000/0000-00"
              />
            </Field>
          </div>
          <Button
            type="button"
            variant="secondary"
            size="md"
            onClick={handleLookup}
            disabled={searching || onlyDigits(taxId).length !== 14}
          >
            {searching ? "Buscando…" : "Buscar dados"}
          </Button>
        </div>
        {searchFailed ? (
          <p className="text-[13px] text-ink-faint">
            Não foi possível buscar os dados automaticamente. Preencha os
            campos manualmente.
          </p>
        ) : null}
        {legalName && !searchFailed ? (
          <div className="flex items-center gap-2 rounded-[10px] bg-surface-raised px-3 py-2 text-[13px] text-ink-muted">
            <Check size={16} className="shrink-0 text-ok" />
            <span>
              Dados encontrados: <strong className="text-ink">{legalName}</strong>
            </span>
          </div>
        ) : null}

        <Field label="Razão social">
          <Input
            type="text"
            name="legalName"
            required
            value={legalName}
            onChange={(e) => setLegalName(e.target.value)}
          />
        </Field>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Nome fantasia">
            <Input
              type="text"
              name="tradeName"
              value={tradeName}
              onChange={(e) => setTradeName(e.target.value)}
            />
          </Field>
          <Field label="Natureza jurídica">
            <Input
              type="text"
              name="legalNature"
              value={legalNature}
              onChange={(e) => setLegalNature(e.target.value)}
            />
          </Field>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Field label="Porte">
            <Select
              name="size"
              value={size}
              onChange={(e) => setSize(e.target.value)}
            >
              <option value="">Selecione</option>
              {COMPANY_SIZES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Inscrição estadual">
            <Input
              type="text"
              name="stateRegistration"
              value={stateRegistration}
              onChange={(e) => setStateRegistration(e.target.value)}
            />
          </Field>
          <Field label="Inscrição municipal">
            <Input
              type="text"
              name="municipalRegistration"
              value={municipalRegistration}
              onChange={(e) => setMunicipalRegistration(e.target.value)}
            />
          </Field>
        </div>

        <label className="flex items-center gap-2 text-sm text-ink">
          <input
            type="checkbox"
            name="simplesOptant"
            checked={simplesOptant}
            onChange={(e) => setSimplesOptant(e.target.checked)}
            className="h-4 w-4 rounded border-line accent-accent"
          />
          Optante pelo Simples Nacional
        </label>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Field label="CEP">
            <Input
              type="text"
              name="postalCode"
              value={postalCode}
              onChange={(e) => setPostalCode(e.target.value)}
            />
          </Field>
          <div className="col-span-1 sm:col-span-2">
            <Field label="Logradouro">
              <Input
                type="text"
                name="street"
                value={street}
                onChange={(e) => setStreet(e.target.value)}
              />
            </Field>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Número">
            <Input
              type="text"
              name="streetNumber"
              value={streetNumber}
              onChange={(e) => setStreetNumber(e.target.value)}
            />
          </Field>
          <Field label="Complemento">
            <Input
              type="text"
              name="addressLine2"
              value={addressLine2}
              onChange={(e) => setAddressLine2(e.target.value)}
            />
          </Field>
          <Field label="Bairro">
            <Input
              type="text"
              name="district"
              value={district}
              onChange={(e) => setDistrict(e.target.value)}
            />
          </Field>
          <Field label="Município">
            <Input
              type="text"
              name="cityName"
              value={cityName}
              onChange={(e) => setCityName(e.target.value)}
            />
          </Field>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Field label="UF">
            <Select
              name="state"
              value={companyState}
              onChange={(e) => setCompanyState(e.target.value)}
            >
              <option value="">Selecione</option>
              {UF_LIST.map((uf) => (
                <option key={uf} value={uf}>
                  {uf}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Telefone">
            <Input
              type="text"
              name="companyPhone"
              value={companyPhone}
              onChange={(e) => setCompanyPhone(e.target.value)}
            />
          </Field>
          <Field label="E-mail da empresa">
            <Input
              type="email"
              name="companyEmail"
              value={companyEmail}
              onChange={(e) => setCompanyEmail(e.target.value)}
            />
          </Field>
        </div>
      </Section>

      <Section title="CNAEs">
        {cnaes.length === 0 ? (
          <p className="text-[13px] text-ink-faint">
            Nenhum CNAE adicionado ainda.
          </p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {cnaes.map((c, i) => (
              <span
                key={`${c.code}-${i}`}
                className={`inline-flex items-center gap-2 rounded-md px-3 py-1.5 text-[13px] font-medium ${
                  i === primaryIndex
                    ? "bg-accent-soft text-accent"
                    : "bg-surface-raised text-ink-muted"
                }`}
              >
                <label className="flex items-center gap-1.5">
                  <input
                    type="radio"
                    name="cnae_primary_ui"
                    checked={i === primaryIndex}
                    onChange={() => handleSetPrimary(i)}
                    className="h-3 w-3 accent-accent"
                  />
                  <span>
                    {c.code} — {c.description}
                  </span>
                </label>
                <button
                  type="button"
                  onClick={() => handleRemoveCnae(i)}
                  aria-label="Remover CNAE"
                  className="text-ink-faint hover:text-ink"
                >
                  <X size={12} />
                </button>
                <input type="hidden" name="cnae_code" value={c.code} />
                <input type="hidden" name="cnae_description" value={c.description} />
              </span>
            ))}
          </div>
        )}
        <input type="hidden" name="cnae_primary" value={primaryIndex} />

        <div className="grid grid-cols-1 gap-3 sm:flex sm:items-end">
          <div className="sm:w-32">
            <Field label="Código">
              <Input
                type="text"
                value={newCnaeCode}
                onChange={(e) => setNewCnaeCode(e.target.value)}
                placeholder="6201501"
              />
            </Field>
          </div>
          <div className="flex-1">
            <Field label="Descrição">
              <Input
                type="text"
                value={newCnaeDescription}
                onChange={(e) => setNewCnaeDescription(e.target.value)}
              />
            </Field>
          </div>
          <Button type="button" variant="secondary" size="md" onClick={handleAddCnae} className="sm:flex-none">
            Adicionar CNAE
          </Button>
        </div>
      </Section>

      <Section title="Seu usuário (administrador)">
        <Field label="Nome">
          <Input
            type="text"
            name="name"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </Field>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="E-mail">
            <Input
              type="email"
              name="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </Field>
          <Field label="CPF (opcional)">
            <Input
              type="text"
              name="cpf"
              value={cpf}
              onChange={(e) => setCpf(e.target.value)}
            />
          </Field>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Senha">
            <Input
              type="password"
              name="password"
              required
              minLength={8}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </Field>
          <Field label="Confirmar senha">
            <Input
              type="password"
              name="confirmPassword"
              required
              minLength={8}
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
            />
          </Field>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Telefone">
            <Input
              type="text"
              name="phone"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
            />
          </Field>
          <Field label="Cargo">
            <Input
              type="text"
              name="jobTitle"
              value={jobTitle}
              onChange={(e) => setJobTitle(e.target.value)}
            />
          </Field>
        </div>
      </Section>

      <Button
        type="submit"
        variant="primary"
        size="md"
        disabled={pending}
        className="w-full"
      >
        {pending ? "Criando conta…" : "Criar conta"}
      </Button>
    </form>
  );
}
