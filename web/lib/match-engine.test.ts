import { describe, expect, it } from "vitest";

import {
  scoreCandidate,
  type CandidatoFatos,
  type MotivoCodigo,
  type PerfilResumo,
} from "./match-engine";

function fatos(over: Partial<CandidatoFatos> = {}): CandidatoFatos {
  return {
    numero_controle_pncp: "12345678000199-1-000123/2026",
    uf: "RJ",
    valor_total_estimado: "184000.00",
    cnae_hits_principal: [],
    cnae_hits_secundario: [],
    termo_hits: [],
    texto_hit: false,
    exclusao_hit: false,
    me_epp_exclusivo: null,
    exige_certificacao: null,
    exige_atestado_tecnico: null,
    ...over,
  };
}

function perfil(over: Partial<PerfilResumo> = {}): PerfilResumo {
  return {
    termos: ["lapis"],
    ufs: [],
    valor_min: null,
    valor_max: null,
    porte: "ME",
    ...over,
  };
}

function codigos(motivos: { codigo: MotivoCodigo }[]): MotivoCodigo[] {
  return motivos.map((m) => m.codigo);
}

function peso(
  motivos: { codigo: MotivoCodigo; peso: number }[],
  codigo: MotivoCodigo,
): number | undefined {
  return motivos.find((m) => m.codigo === codigo)?.peso;
}

describe("scoreCandidate — sem_perfil", () => {
  it("returns a single peso-0 motivo and score 0 with no terms and no CNAE hit", () => {
    const out = scoreCandidate(fatos(), perfil({ termos: [] }));
    expect(out.score).toBe(0);
    expect(out.motivos).toEqual([
      {
        codigo: "sem_perfil",
        peso: 0,
        detalhe: "Perfil sem termos e sem CNAE em comum com a licitação",
      },
    ]);
  });

  it("still scores with no terms when a CNAE matches", () => {
    const out = scoreCandidate(
      fatos({ cnae_hits_principal: ["4761003"] }),
      perfil({ termos: [] }),
    );
    // 35 (cnae) + 10 (uf, perfil sem ufs) + 10 (valor, sem limites)
    expect(out.score).toBe(55);
    expect(codigos(out.motivos)).toEqual(["cnae_principal", "uf_ok", "valor_ok"]);
  });
});

describe("scoreCandidate — CNAE", () => {
  it("gives +35 for a principal hit, with the code as detalhe", () => {
    const out = scoreCandidate(fatos({ cnae_hits_principal: ["4761003"] }), perfil());
    expect(peso(out.motivos, "cnae_principal")).toBe(35);
    expect(out.motivos[0].detalhe).toBe("4761003");
  });

  it("gives +25 for a secundário hit", () => {
    const out = scoreCandidate(fatos({ cnae_hits_secundario: ["4789099"] }), perfil());
    expect(peso(out.motivos, "cnae_secundario")).toBe(25);
    expect(out.motivos[0].detalhe).toBe("4789099");
  });

  it("prefers principal and never emits both", () => {
    const out = scoreCandidate(
      fatos({ cnae_hits_principal: ["4761003"], cnae_hits_secundario: ["4789099"] }),
      perfil(),
    );
    expect(codigos(out.motivos)).toContain("cnae_principal");
    expect(codigos(out.motivos)).not.toContain("cnae_secundario");
  });

  it("emits no motivo when there is no CNAE hit", () => {
    const out = scoreCandidate(fatos({ texto_hit: true }), perfil());
    expect(codigos(out.motivos)).not.toContain("cnae_principal");
    expect(codigos(out.motivos)).not.toContain("cnae_secundario");
  });
});

describe("scoreCandidate — termos", () => {
  it("gives +35 for two or more enrichment hits, joined by ', '", () => {
    const out = scoreCandidate(
      fatos({ termo_hits: ["lapis", "caneta"] }),
      perfil({ termos: ["lapis", "caneta"] }),
    );
    expect(peso(out.motivos, "termo_enriquecimento")).toBe(35);
    expect(out.motivos[0].detalhe).toBe("lapis, caneta");
  });

  it("gives +25 for exactly one enrichment hit", () => {
    const out = scoreCandidate(fatos({ termo_hits: ["lapis"] }), perfil());
    expect(peso(out.motivos, "termo_enriquecimento")).toBe(25);
  });

  it("falls back to +15 termo_texto when only the FTS hit exists", () => {
    const out = scoreCandidate(fatos({ texto_hit: true }), perfil());
    expect(peso(out.motivos, "termo_texto")).toBe(15);
    expect(codigos(out.motivos)).not.toContain("termo_enriquecimento");
  });

  it("ignores texto_hit when there is an enrichment hit", () => {
    const out = scoreCandidate(
      fatos({ termo_hits: ["lapis"], texto_hit: true }),
      perfil(),
    );
    expect(codigos(out.motivos)).not.toContain("termo_texto");
  });
});

describe("scoreCandidate — UF", () => {
  it("gives +10 when the perfil has no UF restriction", () => {
    const out = scoreCandidate(fatos({ termo_hits: ["lapis"] }), perfil({ ufs: [] }));
    expect(peso(out.motivos, "uf_ok")).toBe(10);
  });

  it("gives +10 when the UF is listed", () => {
    const out = scoreCandidate(
      fatos({ termo_hits: ["lapis"], uf: "RJ" }),
      perfil({ ufs: ["SP", "RJ"] }),
    );
    expect(peso(out.motivos, "uf_ok")).toBe(10);
  });

  it("gives −20 when the UF is outside the list", () => {
    const out = scoreCandidate(
      fatos({ termo_hits: ["lapis"], uf: "BA" }),
      perfil({ ufs: ["RJ"] }),
    );
    expect(peso(out.motivos, "uf_fora")).toBe(-20);
  });

  it("treats a null UF as fora when the perfil restricts UFs", () => {
    const out = scoreCandidate(
      fatos({ termo_hits: ["lapis"], uf: null }),
      perfil({ ufs: ["RJ"] }),
    );
    expect(peso(out.motivos, "uf_fora")).toBe(-20);
  });
});

describe("scoreCandidate — valor", () => {
  it("gives +5 when the valor is unknown", () => {
    const out = scoreCandidate(
      fatos({ termo_hits: ["lapis"], valor_total_estimado: null }),
      perfil(),
    );
    expect(peso(out.motivos, "valor_desconhecido")).toBe(5);
  });

  it("gives +10 inside the range, comparing numeric strings with Number()", () => {
    const out = scoreCandidate(
      fatos({ termo_hits: ["lapis"], valor_total_estimado: "184000.00" }),
      perfil({ valor_min: "50000.00", valor_max: "1000000.00" }),
    );
    expect(peso(out.motivos, "valor_ok")).toBe(10);
    expect(out.motivos.find((m) => m.codigo === "valor_ok")?.detalhe).toBe(
      "184000.00",
    );
  });

  it("treats a null bound as open", () => {
    const abaixo = scoreCandidate(
      fatos({ termo_hits: ["lapis"], valor_total_estimado: "10.00" }),
      perfil({ valor_min: null, valor_max: "100.00" }),
    );
    expect(peso(abaixo.motivos, "valor_ok")).toBe(10);

    const acima = scoreCandidate(
      fatos({ termo_hits: ["lapis"], valor_total_estimado: "9999999.00" }),
      perfil({ valor_min: "100.00", valor_max: null }),
    );
    expect(peso(acima.motivos, "valor_ok")).toBe(10);
  });

  it("gives −15 below the minimum and above the maximum", () => {
    const baixo = scoreCandidate(
      fatos({ termo_hits: ["lapis"], valor_total_estimado: "184000.00" }),
      perfil({ valor_min: "200000.00", valor_max: null }),
    );
    expect(peso(baixo.motivos, "valor_fora")).toBe(-15);

    const alto = scoreCandidate(
      fatos({ termo_hits: ["lapis"], valor_total_estimado: "184000.00" }),
      perfil({ valor_min: null, valor_max: "100000.00" }),
    );
    expect(peso(alto.motivos, "valor_fora")).toBe(-15);
  });

  it("includes the bounds themselves", () => {
    const out = scoreCandidate(
      fatos({ termo_hits: ["lapis"], valor_total_estimado: "100000.00" }),
      perfil({ valor_min: "100000.00", valor_max: "100000.00" }),
    );
    expect(peso(out.motivos, "valor_ok")).toBe(10);
  });
});

describe("scoreCandidate — flags", () => {
  it("penalizes −40 for an ME/EPP-exclusive licitação when the porte does not qualify", () => {
    const f = fatos({ cnae_hits_principal: ["4761003"], me_epp_exclusivo: true });
    const grande = scoreCandidate(f, perfil({ porte: "GRANDE" }));
    const me = scoreCandidate(f, perfil({ porte: "ME" }));

    expect(me.score - grande.score).toBe(40);
    expect(peso(grande.motivos, "me_epp_exclusivo")).toBe(-40);
    expect(codigos(me.motivos)).not.toContain("me_epp_exclusivo");
  });

  it("does not penalize MEI, ME or EPP", () => {
    const f = fatos({ termo_hits: ["lapis"], me_epp_exclusivo: true });
    for (const porte of ["MEI", "ME", "EPP"]) {
      expect(codigos(scoreCandidate(f, perfil({ porte })).motivos)).not.toContain(
        "me_epp_exclusivo",
      );
    }
    expect(
      codigos(scoreCandidate(f, perfil({ porte: null })).motivos),
    ).toContain("me_epp_exclusivo");
  });

  it("gives −5 for certificação and −5 for atestado técnico", () => {
    const out = scoreCandidate(
      fatos({
        termo_hits: ["lapis"],
        exige_certificacao: true,
        exige_atestado_tecnico: true,
      }),
      perfil(),
    );
    expect(peso(out.motivos, "exige_certificacao")).toBe(-5);
    expect(peso(out.motivos, "exige_atestado")).toBe(-5);
    // 25 + 10 + 10 − 5 − 5
    expect(out.score).toBe(35);
  });

  it("ignores null and false flags", () => {
    const out = scoreCandidate(
      fatos({
        termo_hits: ["lapis"],
        me_epp_exclusivo: false,
        exige_certificacao: false,
        exige_atestado_tecnico: null,
      }),
      perfil({ porte: "GRANDE" }),
    );
    expect(codigos(out.motivos)).toEqual(["termo_enriquecimento", "uf_ok", "valor_ok"]);
  });

  it("gives −50 for an exclusão hit", () => {
    const out = scoreCandidate(
      fatos({ termo_hits: ["lapis"], exclusao_hit: true }),
      perfil(),
    );
    expect(peso(out.motivos, "exclusao")).toBe(-50);
    // 25 + 10 + 10 − 50 = −5 → clamped to 0
    expect(out.score).toBe(0);
  });
});

describe("scoreCandidate — clamping", () => {
  it("never exceeds 100 — the best possible candidate scores 90", () => {
    const out = scoreCandidate(
      fatos({
        cnae_hits_principal: ["4761003"],
        termo_hits: ["lapis", "caneta"],
        valor_total_estimado: "1000.00",
      }),
      perfil({ ufs: ["RJ"], valor_min: "100.00", valor_max: "10000.00" }),
    );
    // 35 (cnae) + 35 (2 termos) + 10 (uf) + 10 (valor) = 90, the ceiling.
    expect(out.score).toBe(90);
    expect(out.score).toBeLessThanOrEqual(100);
  });

  it("clamps at 0 but keeps the raw pesos in the motivos", () => {
    const out = scoreCandidate(
      fatos({
        termo_hits: ["lapis"],
        uf: "BA",
        valor_total_estimado: "1.00",
        me_epp_exclusivo: true,
        exclusao_hit: true,
      }),
      perfil({ ufs: ["RJ"], valor_min: "1000.00", porte: "GRANDE" }),
    );
    expect(out.score).toBe(0);
    expect(peso(out.motivos, "me_epp_exclusivo")).toBe(-40);
    expect(peso(out.motivos, "exclusao")).toBe(-50);
  });
});
