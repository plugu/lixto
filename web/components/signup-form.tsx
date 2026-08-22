"use client";

import { useActionState, useState } from "react";
import { formatCNPJ, onlyDigits } from "@/lib/br-validators";
import type { CnpjCnae } from "@/lib/cnpj-lookup";
import { lookupAction, signupAction, type SignupState } from "@/app/signup/actions";
import { PORTES, UF_LIST } from "@/lib/tenant-types";

const INPUT_CLASS =
  "w-full rounded-lg border border-border bg-card px-3 py-2 text-sm shadow-subtle outline-none focus-visible:ring-2 focus-visible:ring-accent/40";
const LABEL_CLASS = "text-xs font-medium text-muted-foreground";
const SECTION_TITLE_CLASS =
  "font-display text-base font-bold tracking-tight";

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
    <form
      action={formAction}
      className="mt-6 flex flex-col gap-8"
    >
      {state.erro ? (
        <p
          role="alert"
          className="rounded-lg border border-unclear/30 bg-unclear/10 px-3 py-2 text-sm text-foreground"
        >
          {state.erro}
        </p>
      ) : null}

      <section className="flex flex-col gap-4">
        <h2 className={SECTION_TITLE_CLASS}>Dados da empresa</h2>

        <div className="flex items-end gap-3">
          <label className="flex flex-1 flex-col gap-1.5">
            <span className={LABEL_CLASS}>CNPJ</span>
            <input
              type="text"
              name="cnpj"
              required
              value={cnpj}
              onChange={(e) => setCnpj(e.target.value)}
              onBlur={(e) => setCnpj(formatCNPJ(onlyDigits(e.target.value)))}
              className={INPUT_CLASS}
              placeholder="00.000.000/0000-00"
            />
          </label>
          <button
            type="button"
            onClick={handleBuscar}
            disabled={buscando || onlyDigits(cnpj).length !== 14}
            className="mb-[1px] rounded-lg border border-border bg-card px-4 py-2 text-sm font-semibold shadow-subtle transition-all duration-150 hover:bg-muted/30 disabled:opacity-50"
          >
            {buscando ? "Buscando…" : "Buscar dados"}
          </button>
        </div>
        {buscaFalhou ? (
          <p className="text-xs text-muted-foreground">
            Não foi possível buscar os dados automaticamente. Preencha os
            campos manualmente.
          </p>
        ) : null}

        <label className="flex flex-col gap-1.5">
          <span className={LABEL_CLASS}>Razão social</span>
          <input
            type="text"
            name="razaoSocial"
            required
            value={razaoSocial}
            onChange={(e) => setRazaoSocial(e.target.value)}
            className={INPUT_CLASS}
          />
        </label>

        <div className="grid grid-cols-2 gap-4">
          <label className="flex flex-col gap-1.5">
            <span className={LABEL_CLASS}>Nome fantasia</span>
            <input
              type="text"
              name="nomeFantasia"
              value={nomeFantasia}
              onChange={(e) => setNomeFantasia(e.target.value)}
              className={INPUT_CLASS}
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className={LABEL_CLASS}>Natureza jurídica</span>
            <input
              type="text"
              name="naturezaJuridica"
              value={naturezaJuridica}
              onChange={(e) => setNaturezaJuridica(e.target.value)}
              className={INPUT_CLASS}
            />
          </label>
        </div>

        <div className="grid grid-cols-3 gap-4">
          <label className="flex flex-col gap-1.5">
            <span className={LABEL_CLASS}>Porte</span>
            <select
              name="porte"
              value={porte}
              onChange={(e) => setPorte(e.target.value)}
              className={`${INPUT_CLASS} max-w-56`}
            >
              <option value="">Selecione</option>
              {PORTES.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1.5">
            <span className={LABEL_CLASS}>Inscrição estadual</span>
            <input
              type="text"
              name="inscricaoEstadual"
              value={inscricaoEstadual}
              onChange={(e) => setInscricaoEstadual(e.target.value)}
              className={INPUT_CLASS}
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className={LABEL_CLASS}>Inscrição municipal</span>
            <input
              type="text"
              name="inscricaoMunicipal"
              value={inscricaoMunicipal}
              onChange={(e) => setInscricaoMunicipal(e.target.value)}
              className={INPUT_CLASS}
            />
          </label>
        </div>

        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            name="optanteSimples"
            checked={optanteSimples}
            onChange={(e) => setOptanteSimples(e.target.checked)}
          />
          Optante pelo Simples Nacional
        </label>

        <div className="grid grid-cols-3 gap-4">
          <label className="flex flex-col gap-1.5">
            <span className={LABEL_CLASS}>CEP</span>
            <input
              type="text"
              name="cep"
              value={cep}
              onChange={(e) => setCep(e.target.value)}
              className={INPUT_CLASS}
            />
          </label>
          <label className="col-span-2 flex flex-col gap-1.5">
            <span className={LABEL_CLASS}>Logradouro</span>
            <input
              type="text"
              name="logradouro"
              value={logradouro}
              onChange={(e) => setLogradouro(e.target.value)}
              className={INPUT_CLASS}
            />
          </label>
        </div>

        <div className="grid grid-cols-4 gap-4">
          <label className="flex flex-col gap-1.5">
            <span className={LABEL_CLASS}>Número</span>
            <input
              type="text"
              name="numero"
              value={numero}
              onChange={(e) => setNumero(e.target.value)}
              className={INPUT_CLASS}
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className={LABEL_CLASS}>Complemento</span>
            <input
              type="text"
              name="complemento"
              value={complemento}
              onChange={(e) => setComplemento(e.target.value)}
              className={INPUT_CLASS}
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className={LABEL_CLASS}>Bairro</span>
            <input
              type="text"
              name="bairro"
              value={bairro}
              onChange={(e) => setBairro(e.target.value)}
              className={INPUT_CLASS}
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className={LABEL_CLASS}>Município</span>
            <input
              type="text"
              name="municipio"
              value={municipio}
              onChange={(e) => setMunicipio(e.target.value)}
              className={INPUT_CLASS}
            />
          </label>
        </div>

        <div className="grid grid-cols-3 gap-4">
          <label className="flex flex-col gap-1.5">
            <span className={LABEL_CLASS}>UF</span>
            <select
              name="uf"
              value={uf}
              onChange={(e) => setUf(e.target.value)}
              className={`${INPUT_CLASS} max-w-56`}
            >
              <option value="">Selecione</option>
              {UF_LIST.map((sigla) => (
                <option key={sigla} value={sigla}>
                  {sigla}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1.5">
            <span className={LABEL_CLASS}>Telefone</span>
            <input
              type="text"
              name="empresaTelefone"
              value={empresaTelefone}
              onChange={(e) => setEmpresaTelefone(e.target.value)}
              className={INPUT_CLASS}
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className={LABEL_CLASS}>E-mail da empresa</span>
            <input
              type="email"
              name="empresaEmail"
              value={empresaEmail}
              onChange={(e) => setEmpresaEmail(e.target.value)}
              className={INPUT_CLASS}
            />
          </label>
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className={SECTION_TITLE_CLASS}>CNAEs</h2>

        {cnaes.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            Nenhum CNAE adicionado ainda.
          </p>
        ) : (
          <ul className="flex flex-col divide-y divide-border rounded-lg border border-border bg-card shadow-subtle">
            {cnaes.map((c, i) => (
              <li key={`${c.codigo}-${i}`} className="flex items-center gap-3 px-3 py-2">
                <label className="flex items-center gap-2 text-xs">
                  <input
                    type="radio"
                    name="cnae_principal_ui"
                    checked={i === principalIndex}
                    onChange={() => handleSetPrincipal(i)}
                  />
                  principal
                </label>
                <span className="text-sm">
                  {c.codigo} — {c.descricao}
                </span>
                <button
                  type="button"
                  onClick={() => handleRemoverCnae(i)}
                  className="ml-auto text-xs font-medium text-accent hover:underline"
                >
                  Remover
                </button>
                <input type="hidden" name="cnae_codigo" value={c.codigo} />
                <input type="hidden" name="cnae_descricao" value={c.descricao} />
              </li>
            ))}
          </ul>
        )}
        <input type="hidden" name="cnae_principal" value={principalIndex} />

        <div className="flex items-end gap-3">
          <label className="flex flex-col gap-1.5">
            <span className={LABEL_CLASS}>Código</span>
            <input
              type="text"
              value={novoCnaeCodigo}
              onChange={(e) => setNovoCnaeCodigo(e.target.value)}
              className={`${INPUT_CLASS} max-w-32`}
              placeholder="6201501"
            />
          </label>
          <label className="flex flex-1 flex-col gap-1.5">
            <span className={LABEL_CLASS}>Descrição</span>
            <input
              type="text"
              value={novoCnaeDescricao}
              onChange={(e) => setNovoCnaeDescricao(e.target.value)}
              className={INPUT_CLASS}
            />
          </label>
          <button
            type="button"
            onClick={handleAdicionarCnae}
            className="mb-[1px] rounded-lg border border-border bg-card px-4 py-2 text-sm font-semibold shadow-subtle transition-all duration-150 hover:bg-muted/30"
          >
            Adicionar CNAE
          </button>
        </div>
      </section>

      <section className="flex flex-col gap-4">
        <h2 className={SECTION_TITLE_CLASS}>Seu usuário (administrador)</h2>

        <label className="flex flex-col gap-1.5">
          <span className={LABEL_CLASS}>Nome</span>
          <input
            type="text"
            name="nome"
            required
            value={nome}
            onChange={(e) => setNome(e.target.value)}
            className={INPUT_CLASS}
          />
        </label>

        <div className="grid grid-cols-2 gap-4">
          <label className="flex flex-col gap-1.5">
            <span className={LABEL_CLASS}>E-mail</span>
            <input
              type="email"
              name="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className={INPUT_CLASS}
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className={LABEL_CLASS}>CPF (opcional)</span>
            <input
              type="text"
              name="cpf"
              value={cpf}
              onChange={(e) => setCpf(e.target.value)}
              className={INPUT_CLASS}
            />
          </label>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <label className="flex flex-col gap-1.5">
            <span className={LABEL_CLASS}>Senha</span>
            <input
              type="password"
              name="senha"
              required
              minLength={8}
              value={senha}
              onChange={(e) => setSenha(e.target.value)}
              className={INPUT_CLASS}
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className={LABEL_CLASS}>Confirmar senha</span>
            <input
              type="password"
              name="confirmarSenha"
              required
              minLength={8}
              value={confirmarSenha}
              onChange={(e) => setConfirmarSenha(e.target.value)}
              className={INPUT_CLASS}
            />
          </label>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <label className="flex flex-col gap-1.5">
            <span className={LABEL_CLASS}>Telefone</span>
            <input
              type="text"
              name="telefone"
              value={telefone}
              onChange={(e) => setTelefone(e.target.value)}
              className={INPUT_CLASS}
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className={LABEL_CLASS}>Cargo</span>
            <input
              type="text"
              name="cargo"
              value={cargo}
              onChange={(e) => setCargo(e.target.value)}
              className={INPUT_CLASS}
            />
          </label>
        </div>
      </section>

      <button
        type="submit"
        disabled={pending}
        className="mt-1 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground shadow-sm transition-all duration-150 hover:bg-primary/90 active:scale-[0.98] disabled:opacity-50"
      >
        {pending ? "Criando conta…" : "Criar conta"}
      </button>
    </form>
  );
}
