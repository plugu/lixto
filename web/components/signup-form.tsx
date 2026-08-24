"use client";

import { useActionState, useState } from "react";
import { formatCNPJ, onlyDigits } from "@/lib/br-validators";
import type { CnpjCnae } from "@/lib/cnpj-lookup";
import { lookupAction, signupAction, type SignupState } from "@/app/signup/actions";
import { PORTES, UF_LIST } from "@/lib/tenant-types";
import { Field, Input, Select } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Section } from "@/components/ui/section";
import { StatusDot } from "@/components/ui/status-dot";
import { Check, X } from "@/components/ui/icons";

const INITIAL_STATE: SignupState = { erro: null };

type CnaeRow = CnpjCnae;

export function SignupForm() {
  const [state, formAction, pending] = useActionState(
    signupAction,
    INITIAL_STATE,
  );

  const [cnpj, setCnpj] = useState("");
  const [buscando, setBuscando] = useState(false);
  const [buscaFalhou, setBuscaFalhou] = useState(false);

  const [razaoSocial, setRazaoSocial] = useState("");
  const [nomeFantasia, setNomeFantasia] = useState("");
  const [naturezaJuridica, setNaturezaJuridica] = useState("");
  const [porte, setPorte] = useState("");
  const [optanteSimples, setOptanteSimples] = useState(false);
  const [inscricaoEstadual, setInscricaoEstadual] = useState("");
  const [inscricaoMunicipal, setInscricaoMunicipal] = useState("");
  const [cep, setCep] = useState("");
  const [logradouro, setLogradouro] = useState("");
  const [numero, setNumero] = useState("");
  const [complemento, setComplemento] = useState("");
  const [bairro, setBairro] = useState("");
  const [municipio, setMunicipio] = useState("");
  const [uf, setUf] = useState("");
  const [empresaTelefone, setEmpresaTelefone] = useState("");
  const [empresaEmail, setEmpresaEmail] = useState("");

  const [cnaes, setCnaes] = useState<CnaeRow[]>([]);
  const [novoCnaeCodigo, setNovoCnaeCodigo] = useState("");
  const [novoCnaeDescricao, setNovoCnaeDescricao] = useState("");

  const [nome, setNome] = useState("");
  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  const [confirmarSenha, setConfirmarSenha] = useState("");
  const [cpf, setCpf] = useState("");
  const [telefone, setTelefone] = useState("");
  const [cargo, setCargo] = useState("");

  const principalIndex = cnaes.findIndex((c) => c.principal);

  async function handleBuscar() {
    setBuscando(true);
    setBuscaFalhou(false);
    try {
      const result = await lookupAction(cnpj);
      if (!result) {
        setBuscaFalhou(true);
        return;
      }
      setRazaoSocial(result.razaoSocial);
      setNomeFantasia(result.nomeFantasia ?? "");
      setNaturezaJuridica(result.naturezaJuridica ?? "");
      setPorte(result.porte ?? "");
      setOptanteSimples(result.optanteSimples);
      setCep(result.cep ?? "");
      setLogradouro(result.logradouro ?? "");
      setNumero(result.numero ?? "");
      setComplemento(result.complemento ?? "");
      setBairro(result.bairro ?? "");
      setMunicipio(result.municipio ?? "");
      setUf(result.uf ?? "");
      setEmpresaTelefone(result.telefone ?? "");
      setEmpresaEmail(result.email ?? "");
      setCnaes(result.cnaes);
    } finally {
      setBuscando(false);
    }
  }

  function handleAdicionarCnae() {
    if (!novoCnaeCodigo.trim() || !novoCnaeDescricao.trim()) return;
    setCnaes((prev) => [
      ...prev,
      {
        codigo: novoCnaeCodigo.trim(),
        descricao: novoCnaeDescricao.trim(),
        principal: prev.length === 0,
      },
    ]);
    setNovoCnaeCodigo("");
    setNovoCnaeDescricao("");
  }

  function handleRemoverCnae(index: number) {
    setCnaes((prev) => {
      const next = prev.filter((_, i) => i !== index);
      if (!next.some((c) => c.principal) && next.length > 0) {
        next[0] = { ...next[0], principal: true };
      }
      return next;
    });
  }

  function handleSetPrincipal(index: number) {
    setCnaes((prev) => prev.map((c, i) => ({ ...c, principal: i === index })));
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
                name="cnpj"
                required
                value={cnpj}
                onChange={(e) => setCnpj(e.target.value)}
                onBlur={(e) => setCnpj(formatCNPJ(onlyDigits(e.target.value)))}
                placeholder="00.000.000/0000-00"
              />
            </Field>
          </div>
          <Button
            type="button"
            variant="secondary"
            size="md"
            onClick={handleBuscar}
            disabled={buscando || onlyDigits(cnpj).length !== 14}
          >
            {buscando ? "Buscando…" : "Buscar dados"}
          </Button>
        </div>
        {buscaFalhou ? (
          <p className="text-[13px] text-ink-faint">
            Não foi possível buscar os dados automaticamente. Preencha os
            campos manualmente.
          </p>
        ) : null}
        {razaoSocial && !buscaFalhou ? (
          <div className="flex items-center gap-2 rounded-[10px] bg-surface-raised px-3 py-2 text-[13px] text-ink-muted">
            <Check size={16} className="shrink-0 text-ok" />
            <span>
              Dados encontrados: <strong className="text-ink">{razaoSocial}</strong>
            </span>
          </div>
        ) : null}

        <Field label="Razão social">
          <Input
            type="text"
            name="razaoSocial"
            required
            value={razaoSocial}
            onChange={(e) => setRazaoSocial(e.target.value)}
          />
        </Field>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Nome fantasia">
            <Input
              type="text"
              name="nomeFantasia"
              value={nomeFantasia}
              onChange={(e) => setNomeFantasia(e.target.value)}
            />
          </Field>
          <Field label="Natureza jurídica">
            <Input
              type="text"
              name="naturezaJuridica"
              value={naturezaJuridica}
              onChange={(e) => setNaturezaJuridica(e.target.value)}
            />
          </Field>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Field label="Porte">
            <Select
              name="porte"
              value={porte}
              onChange={(e) => setPorte(e.target.value)}
            >
              <option value="">Selecione</option>
              {PORTES.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Inscrição estadual">
            <Input
              type="text"
              name="inscricaoEstadual"
              value={inscricaoEstadual}
              onChange={(e) => setInscricaoEstadual(e.target.value)}
            />
          </Field>
          <Field label="Inscrição municipal">
            <Input
              type="text"
              name="inscricaoMunicipal"
              value={inscricaoMunicipal}
              onChange={(e) => setInscricaoMunicipal(e.target.value)}
            />
          </Field>
        </div>

        <label className="flex items-center gap-2 text-sm text-ink">
          <input
            type="checkbox"
            name="optanteSimples"
            checked={optanteSimples}
            onChange={(e) => setOptanteSimples(e.target.checked)}
            className="h-4 w-4 rounded border-line accent-accent"
          />
          Optante pelo Simples Nacional
        </label>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Field label="CEP">
            <Input
              type="text"
              name="cep"
              value={cep}
              onChange={(e) => setCep(e.target.value)}
            />
          </Field>
          <div className="col-span-1 sm:col-span-2">
            <Field label="Logradouro">
              <Input
                type="text"
                name="logradouro"
                value={logradouro}
                onChange={(e) => setLogradouro(e.target.value)}
              />
            </Field>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Número">
            <Input
              type="text"
              name="numero"
              value={numero}
              onChange={(e) => setNumero(e.target.value)}
            />
          </Field>
          <Field label="Complemento">
            <Input
              type="text"
              name="complemento"
              value={complemento}
              onChange={(e) => setComplemento(e.target.value)}
            />
          </Field>
          <Field label="Bairro">
            <Input
              type="text"
              name="bairro"
              value={bairro}
              onChange={(e) => setBairro(e.target.value)}
            />
          </Field>
          <Field label="Município">
            <Input
              type="text"
              name="municipio"
              value={municipio}
              onChange={(e) => setMunicipio(e.target.value)}
            />
          </Field>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Field label="UF">
            <Select
              name="uf"
              value={uf}
              onChange={(e) => setUf(e.target.value)}
            >
              <option value="">Selecione</option>
              {UF_LIST.map((sigla) => (
                <option key={sigla} value={sigla}>
                  {sigla}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Telefone">
            <Input
              type="text"
              name="empresaTelefone"
              value={empresaTelefone}
              onChange={(e) => setEmpresaTelefone(e.target.value)}
            />
          </Field>
          <Field label="E-mail da empresa">
            <Input
              type="email"
              name="empresaEmail"
              value={empresaEmail}
              onChange={(e) => setEmpresaEmail(e.target.value)}
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
                key={`${c.codigo}-${i}`}
                className={`inline-flex items-center gap-2 rounded-md px-3 py-1.5 text-[13px] font-medium ${
                  i === principalIndex
                    ? "bg-accent-soft text-accent"
                    : "bg-surface-raised text-ink-muted"
                }`}
              >
                <label className="flex items-center gap-1.5">
                  <input
                    type="radio"
                    name="cnae_principal_ui"
                    checked={i === principalIndex}
                    onChange={() => handleSetPrincipal(i)}
                    className="h-3 w-3 accent-accent"
                  />
                  <span>
                    {c.codigo} — {c.descricao}
                  </span>
                </label>
                <button
                  type="button"
                  onClick={() => handleRemoverCnae(i)}
                  aria-label="Remover CNAE"
                  className="text-ink-faint hover:text-ink"
                >
                  <X size={12} />
                </button>
                <input type="hidden" name="cnae_codigo" value={c.codigo} />
                <input type="hidden" name="cnae_descricao" value={c.descricao} />
              </span>
            ))}
          </div>
        )}
        <input type="hidden" name="cnae_principal" value={principalIndex} />

        <div className="grid grid-cols-1 gap-3 sm:flex sm:items-end">
          <div className="sm:w-32">
            <Field label="Código">
              <Input
                type="text"
                value={novoCnaeCodigo}
                onChange={(e) => setNovoCnaeCodigo(e.target.value)}
                placeholder="6201501"
              />
            </Field>
          </div>
          <div className="flex-1">
            <Field label="Descrição">
              <Input
                type="text"
                value={novoCnaeDescricao}
                onChange={(e) => setNovoCnaeDescricao(e.target.value)}
              />
            </Field>
          </div>
          <Button type="button" variant="secondary" size="md" onClick={handleAdicionarCnae} className="sm:flex-none">
            Adicionar CNAE
          </Button>
        </div>
      </Section>

      <Section title="Seu usuário (administrador)">
        <Field label="Nome">
          <Input
            type="text"
            name="nome"
            required
            value={nome}
            onChange={(e) => setNome(e.target.value)}
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
              name="senha"
              required
              minLength={8}
              value={senha}
              onChange={(e) => setSenha(e.target.value)}
            />
          </Field>
          <Field label="Confirmar senha">
            <Input
              type="password"
              name="confirmarSenha"
              required
              minLength={8}
              value={confirmarSenha}
              onChange={(e) => setConfirmarSenha(e.target.value)}
            />
          </Field>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Telefone">
            <Input
              type="text"
              name="telefone"
              value={telefone}
              onChange={(e) => setTelefone(e.target.value)}
            />
          </Field>
          <Field label="Cargo">
            <Input
              type="text"
              name="cargo"
              value={cargo}
              onChange={(e) => setCargo(e.target.value)}
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
