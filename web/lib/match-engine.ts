// Deterministic match scoring (ticket 66): enriched licitação facts × empresa
// profile → a 0–100 score plus machine-readable reasons. Pure, no I/O, no LLM.
//
// The weights below are the product decision for cycle 16 and are fixed: the
// SQL side (match-queries.ts) only gathers facts, every judgement happens here
// so it is unit-testable and reproducible. On demand, never persisted — a
// just-edited profile is reflected on the next request.

export type MotivoCodigo =
  | "cnae_principal"
  | "cnae_secundario"
  | "termo_enriquecimento"
  | "termo_texto"
  | "uf_ok"
  | "uf_fora"
  | "valor_ok"
  | "valor_fora"
  | "valor_desconhecido"
  | "me_epp_exclusivo"
  | "exige_certificacao"
  | "exige_atestado"
  | "exclusao"
  | "semantico_alto"
  | "semantico"
  | "sem_perfil";

export type Motivo = { codigo: MotivoCodigo; peso: number; detalhe: string };

export type CandidatoFatos = {
  numero_controle_pncp: string;
  uf: string | null;
  valor_total_estimado: string | null;
  cnae_hits_principal: string[];
  cnae_hits_secundario: string[];
  /** perfil.termos ∩ (enriquecimento.palavras_chave ∪ conceitos) */
  termo_hits: string[];
  /** FTS hit of the perfil terms on objeto_compra / item.descricao */
  texto_hit: boolean;
  /** FTS hit of the perfil exclusões on objeto_compra / item.descricao */
  exclusao_hit: boolean;
  me_epp_exclusivo: boolean | null;
  exige_certificacao: boolean | null;
  exige_atestado_tecnico: boolean | null;
  /** Cosine similarity (0..1) between the perfil vector and the enrichment
   * vector; null when either side has no embedding (ticket 72). */
  similaridade: number | null;
};

export type PerfilResumo = {
  termos: string[];
  ufs: string[];
  valor_min: string | null;
  valor_max: string | null;
  porte: string | null;
};

/** Portes that qualify for a licitação reserved to ME/EPP (LC 123/2006). */
const PORTES_ME_EPP = new Set(["MEI", "ME", "EPP"]);

function clamp(score: number): number {
  return Math.max(0, Math.min(100, score));
}

/**
 * Scores one candidate against one profile. Every applied rule line becomes a
 * `Motivo` carrying its own `peso`, so the UI can explain the number without
 * re-deriving it. The sum is clamped to 0..100 (max raw is 110 since the
 * semantic band was added) but the motivos keep their raw weights on purpose
 * (a −40 ME/EPP penalty stays visible even at score 0).
 */
export function scoreCandidate(
  f: CandidatoFatos,
  p: PerfilResumo,
): { score: number; motivos: Motivo[] } {
  const temCnae =
    f.cnae_hits_principal.length > 0 || f.cnae_hits_secundario.length > 0;

  // Nothing to match on: an empresa with no terms, no CNAE overlap and no
  // semantic signal gets a single honest reason instead of a score built out
  // of UF/valor noise. A similaridade alone is enough to keep scoring.
  if (p.termos.length === 0 && !temCnae && f.similaridade === null) {
    return {
      score: 0,
      motivos: [
        {
          codigo: "sem_perfil",
          peso: 0,
          detalhe: "Perfil sem termos e sem CNAE em comum com a licitação",
        },
      ],
    };
  }

  const motivos: Motivo[] = [];
  let score = 0;

  const add = (codigo: MotivoCodigo, peso: number, detalhe: string) => {
    motivos.push({ codigo, peso, detalhe });
    score += peso;
  };

  // CNAE: principal beats secundário, never both.
  if (f.cnae_hits_principal.length > 0) {
    add("cnae_principal", 35, f.cnae_hits_principal.join(", "));
  } else if (f.cnae_hits_secundario.length > 0) {
    add("cnae_secundario", 25, f.cnae_hits_secundario.join(", "));
  }

  // Terms: enrichment keywords first, raw full-text as the weaker fallback.
  if (f.termo_hits.length >= 2) {
    add("termo_enriquecimento", 35, f.termo_hits.join(", "));
  } else if (f.termo_hits.length === 1) {
    add("termo_enriquecimento", 25, f.termo_hits.join(", "));
  } else if (f.texto_hit) {
    add("termo_texto", 15, "Termos do perfil encontrados no objeto ou nos itens");
  }

  // UF: an empty list in the profile means "todas".
  if (p.ufs.length === 0 || (f.uf !== null && p.ufs.includes(f.uf))) {
    add("uf_ok", 10, f.uf ?? "UF não informada");
  } else {
    add("uf_fora", -20, f.uf ?? "UF não informada");
  }

  // Valor: numeric strings ("184000.00") compared with Number().
  if (f.valor_total_estimado === null) {
    add("valor_desconhecido", 5, "Valor estimado não informado");
  } else {
    const valor = Number(f.valor_total_estimado);
    const min = p.valor_min === null ? null : Number(p.valor_min);
    const max = p.valor_max === null ? null : Number(p.valor_max);
    const dentro = (min === null || valor >= min) && (max === null || valor <= max);
    if (dentro) {
      add("valor_ok", 10, f.valor_total_estimado);
    } else {
      add("valor_fora", -15, f.valor_total_estimado);
    }
  }

  if (f.me_epp_exclusivo === true && !PORTES_ME_EPP.has(p.porte ?? "")) {
    add(
      "me_epp_exclusivo",
      -40,
      `Exclusiva para ME/EPP; porte da empresa: ${p.porte ?? "não informado"}`,
    );
  }

  if (f.exige_certificacao === true) {
    add("exige_certificacao", -5, "Exige certificação");
  }

  if (f.exige_atestado_tecnico === true) {
    add("exige_atestado", -5, "Exige atestado de capacidade técnica");
  }

  if (f.exclusao_hit) {
    add("exclusao", -50, "Termo de exclusão do perfil encontrado");
  }

  // Semantic proximity between the perfil vector and the enrichment vector
  // (ticket 72). Fixed bands, deliberately worth less than a CNAE or keyword
  // hit: it is a recall booster, not a substitute for a hard signal.
  if (f.similaridade !== null) {
    const detalhe = `sim=${f.similaridade.toFixed(2)}`;
    if (f.similaridade >= 0.55) {
      add("semantico_alto", 20, detalhe);
    } else if (f.similaridade >= 0.4) {
      add("semantico", 10, detalhe);
    }
  }

  return { score: clamp(score), motivos };
}
