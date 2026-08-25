import { beforeEach, describe, expect, it, vi } from "vitest";

// Relative imports (not "@/lib/...") on purpose: vitest runs without a config
// file. The pool is mocked — these tests never touch a live database.
vi.mock("./db", () => ({ pool: { query: vi.fn() } }));

import { pool } from "./db";
import { PORTAIS_ATIVOS } from "./portais";
import type { PerfilResumo } from "./match-engine";
import {
  buildCandidateQuery,
  buildTermosTsQuery,
  fetchMatches,
  type MatchFilters,
} from "./match-queries";

const query = pool.query as unknown as ReturnType<typeof vi.fn>;

type Perfil = PerfilResumo & { exclusoes_termos: string[] };

function perfil(over: Partial<Perfil> = {}): Perfil {
  return {
    termos: ["lapis"],
    exclusoes_termos: [],
    ufs: [],
    valor_min: null,
    valor_max: null,
    porte: "ME",
    ...over,
  };
}

function candidato(over: Record<string, unknown> = {}) {
  return {
    numero_controle_pncp: "12345678000199-1-000001/2026",
    objeto_compra: "Aquisição de lápis",
    orgao_razao_social: "Prefeitura",
    municipio_nome: "Rio de Janeiro",
    uf: "RJ",
    modalidade_nome: "Pregão",
    valor_total_estimado: "1000.00",
    data_abertura_proposta: new Date("2026-09-01T12:00:00Z"),
    data_encerramento_proposta: new Date("2026-09-30T12:00:00Z"),
    resumo: null,
    riscos: null,
    complexidade: null,
    enriquecido: false,
    cnae_hits_principal: [],
    cnae_hits_secundario: [],
    termo_hits: [],
    texto_hit: false,
    exclusao_hit: false,
    me_epp_exclusivo: null,
    exige_certificacao: null,
    exige_atestado_tecnico: null,
    similaridade: null,
    ...over,
  };
}

beforeEach(() => {
  query.mockReset();
});

describe("buildTermosTsQuery", () => {
  it("builds an OR of AND-joined terms", () => {
    expect(buildTermosTsQuery(["lapis", "lapis preto"])).toBe(
      "(lapis) | (lapis & preto)",
    );
  });

  it("returns null for an empty list", () => {
    expect(buildTermosTsQuery([])).toBe(null);
  });

  it("sanitizes each term to [a-z0-9 ], so no operator can leak through", () => {
    expect(buildTermosTsQuery(["lápis:*! | caneta", "papel-a4"])).toBe(
      "(l & pis & caneta) | (papel & a4)",
    );
  });

  it("drops terms left empty by sanitization", () => {
    expect(buildTermosTsQuery(["!!!", "lapis"])).toBe("(lapis)");
    expect(buildTermosTsQuery(["!!!", "  "])).toBe(null);
  });
});

describe("buildCandidateQuery", () => {
  it("binds empresaId as $1 and never interpolates it", () => {
    const q = buildCandidateQuery(42, {}, perfil(), 200);
    expect(q.values[0]).toBe(42);
    expect(q.text).toContain("FROM empresa_cnae WHERE empresa_id = $1");
    expect(q.text).not.toContain("42");
  });

  it("always applies the portal allowlist, bound as a parameter", () => {
    const q = buildCandidateQuery(1, {}, perfil(), 200);
    expect(q.text).toContain("l.usuario_nome = ANY(");
    expect(q.values).toContainEqual(PORTAIS_ATIVOS);
  });

  it("defaults to aberta OR vai_abrir and honours explicit statuses", () => {
    const padrao = buildCandidateQuery(1, {}, perfil(), 200);
    expect(padrao.text).toContain("l.data_abertura_proposta > now()");
    expect(padrao.text).toContain(
      "l.data_abertura_proposta <= now() AND now() < l.data_encerramento_proposta",
    );
    expect(padrao.text).not.toContain("l.data_encerramento_proposta < now()");

    const fechada = buildCandidateQuery(1, { statuses: ["fechada"] }, perfil(), 200);
    expect(fechada.text).toContain("l.data_encerramento_proposta < now()");
    expect(fechada.text).not.toContain("l.data_abertura_proposta > now()");
  });

  it("binds the termos tsquery and the termos array", () => {
    const q = buildCandidateQuery(1, {}, perfil({ termos: ["lapis", "lapis preto"] }), 200);
    expect(q.values[1]).toEqual(["lapis", "lapis preto"]);
    expect(q.values[2]).toBe("(lapis) | (lapis & preto)");
  });

  it("binds null for empty termos and exclusões", () => {
    const q = buildCandidateQuery(1, {}, perfil({ termos: [], exclusoes_termos: [] }), 200);
    expect(q.values[1]).toEqual([]);
    expect(q.values[2]).toBe(null);
    expect(q.values[3]).toBe(null);
    // The FTS predicate collapses to a plain false rather than NULL.
    expect(q.text).toContain("IS NULL THEN false");
  });

  it("includes numero_controle_pncp = ANY only when numeros is given", () => {
    const sem = buildCandidateQuery(1, {}, perfil(), 200);
    expect(sem.text).not.toContain("l.numero_controle_pncp = ANY(");

    const com = buildCandidateQuery(1, { numeros: ["a", "b"] }, perfil(), 200);
    expect(com.text).toContain("l.numero_controle_pncp = ANY(");
    expect(com.values).toContainEqual(["a", "b"]);
  });

  it("requires at least one signal, except when numeros is given", () => {
    const sem = buildCandidateQuery(1, {}, perfil(), 200);
    expect(sem.text).toContain("FROM licitacao_cnae lc JOIN cnaes c ON c.codigo = lc.codigo");

    const com = buildCandidateQuery(1, { numeros: ["a"] }, perfil(), 200);
    // The facts still select CNAE hits; only the WHERE-side signal is dropped.
    expect(com.text).not.toContain("SELECT 1 FROM licitacao_cnae lc JOIN cnaes c");
  });

  it("binds every optional filter as a parameter", () => {
    const filters: MatchFilters = {
      q: "lapis",
      ufs: ["RJ"],
      modalidadeIds: [6, 8],
      valorMin: 1000,
      valorMax: 500000,
    };
    const q = buildCandidateQuery(7, filters, perfil(), 200);
    expect(q.text).toContain("l.uf = ANY(");
    expect(q.text).toContain("l.modalidade_id = ANY(");
    expect(q.text).toContain("l.valor_total_estimado >= $");
    expect(q.text).toContain("l.valor_total_estimado <= $");
    expect(q.text).toContain("websearch_to_tsquery('portuguese', f_unaccent($");
    expect(q.values).toContainEqual(["RJ"]);
    expect(q.values).toContainEqual([6, 8]);
    expect(q.values).toContain(1000);
    expect(q.values).toContain(500000);
    expect(q.values).toContain("lapis");
    expect(q.text).not.toContain("'lapis'");
  });

  it("joins enrichment and binds the candidate limit", () => {
    const q = buildCandidateQuery(1, {}, perfil(), 200);
    expect(q.text).toContain("LEFT JOIN enriquecimento e");
    expect(q.text).toContain(
      "ON e.numero_controle_pncp = l.numero_controle_pncp AND e.status = 'done'",
    );
    expect(q.text).toContain(
      "ORDER BY l.data_encerramento_proposta ASC NULLS LAST",
    );
    expect(q.text).toContain(`LIMIT $${q.values.length}`);
    expect(q.values[q.values.length - 1]).toBe(200);
  });

  it("numbers every placeholder it uses, with no gaps", () => {
    const q = buildCandidateQuery(1, { q: "lapis", ufs: ["RJ"] }, perfil(), 200);
    const usados = new Set(
      [...q.text.matchAll(/\$(\d+)/g)].map((m) => Number(m[1])),
    );
    for (let i = 1; i <= q.values.length; i++) {
      expect(usados.has(i)).toBe(true);
    }
    expect(Math.max(...usados)).toBe(q.values.length);
  });

  it("selects NULL::real as similaridade when there is no perfil embedding", () => {
    const q = buildCandidateQuery(1, {}, perfil(), 200);
    expect(q.text).toContain("NULL::real AS similaridade");
    expect(q.text).not.toContain("<=>");
    expect(q.text).not.toContain("LEFT JOIN semantico");
    expect(q.values.every((v) => typeof v !== "string" || !v.startsWith("["))).toBe(
      true,
    );
  });

  it("adds the pgvector CTE and binds the vector as text when given", () => {
    const vetor = "[0.1,0.2,0.3]";
    const q = buildCandidateQuery(1, {}, perfil(), 200, vetor);

    expect(q.text).toContain("semantico AS (");
    expect(q.text).toContain("1 - (embedding <=> $");
    expect(q.text).toContain("::vector");
    expect(q.text).toContain("LEFT JOIN semantico s");
    expect(q.text).toContain("s.similaridade");
    // Bound exactly once and never interpolated.
    expect(q.values.filter((v) => v === vetor)).toHaveLength(1);
    expect(q.text).not.toContain("0.1,0.2,0.3");
  });

  it("accepts the similaridade as a standalone signal", () => {
    const q = buildCandidateQuery(1, {}, perfil(), 200, "[0.1,0.2]");
    expect(q.text).toContain("OR s.similaridade >= 0.40");

    const sem = buildCandidateQuery(1, {}, perfil(), 200);
    expect(sem.text).not.toContain("s.similaridade >=");
  });

  it("still numbers every placeholder with no gaps with the vector bound", () => {
    const q = buildCandidateQuery(
      1,
      { q: "lapis", ufs: ["RJ"] },
      perfil(),
      200,
      "[0.1,0.2]",
    );
    const usados = new Set(
      [...q.text.matchAll(/\$(\d+)/g)].map((m) => Number(m[1])),
    );
    for (let i = 1; i <= q.values.length; i++) {
      expect(usados.has(i)).toBe(true);
    }
    expect(Math.max(...usados)).toBe(q.values.length);
  });
});

describe("fetchMatches", () => {
  /** Four statements, in order: getPerfil, the porte lookup,
   * getPerfilEmbeddingText, then the candidate query (mock.calls[3]). */
  function mockEmpresa(
    perfilRow: Record<string, unknown> | null,
    porte: string | null,
    candidatos: Record<string, unknown>[],
    embedding: string | null = null,
  ) {
    query
      .mockResolvedValueOnce({ rows: perfilRow ? [perfilRow] : [] })
      .mockResolvedValueOnce({ rows: porte === null ? [] : [{ porte }] })
      .mockResolvedValueOnce({ rows: [{ embedding }] })
      .mockResolvedValueOnce({ rows: candidatos });
  }

  const perfilRow = {
    empresa_id: 1,
    produtos: ["lápis"],
    palavras_chave: [],
    exclusoes: [],
    termos: ["lapis"],
    exclusoes_termos: [],
    ufs: ["RJ"],
    valor_min: null,
    valor_max: null,
    observacoes: null,
    embedding_texto: null,
  };

  it("scores rows, sorts by score desc and returns motivos", async () => {
    mockEmpresa(perfilRow, "ME", [
      candidato({ numero_controle_pncp: "fraco", texto_hit: true }),
      candidato({
        numero_controle_pncp: "forte",
        cnae_hits_principal: ["4761003"],
        termo_hits: ["lapis", "caneta"],
      }),
    ]);

    const rows = await fetchMatches(1, { q: "lapis", ufs: ["RJ"] });

    expect(rows.map((r) => r.numero_controle_pncp)).toEqual(["forte", "fraco"]);
    expect(rows[0].score).toBe(90);
    expect(rows[0].motivos.map((m) => m.codigo)).toEqual([
      "cnae_principal",
      "termo_enriquecimento",
      "uf_ok",
      "valor_ok",
    ]);
    expect(rows[1].score).toBe(35);
  });

  it("breaks score ties by data_encerramento_proposta ascending", async () => {
    mockEmpresa(perfilRow, "ME", [
      candidato({
        numero_controle_pncp: "tarde",
        texto_hit: true,
        data_encerramento_proposta: new Date("2026-12-01T12:00:00Z"),
      }),
      candidato({
        numero_controle_pncp: "sem-prazo",
        texto_hit: true,
        data_encerramento_proposta: null,
      }),
      candidato({
        numero_controle_pncp: "cedo",
        texto_hit: true,
        data_encerramento_proposta: new Date("2026-09-01T12:00:00Z"),
      }),
    ]);

    const rows = await fetchMatches(1, {});

    expect(rows.map((r) => r.numero_controle_pncp)).toEqual([
      "cedo",
      "tarde",
      "sem-prazo",
    ]);
  });

  it("truncates to limit", async () => {
    mockEmpresa(
      perfilRow,
      "ME",
      [1, 2, 3, 4, 5].map((n) =>
        candidato({ numero_controle_pncp: `n${n}`, texto_hit: true }),
      ),
    );

    const rows = await fetchMatches(1, {}, 2);

    expect(rows).toHaveLength(2);
  });

  it("scores an ME/EPP-exclusive licitação 40 lower for a GRANDE empresa", async () => {
    const linha = candidato({
      cnae_hits_principal: ["4761003"],
      termo_hits: ["lapis"],
      me_epp_exclusivo: true,
    });

    mockEmpresa(perfilRow, "ME", [linha]);
    const [comoMe] = await fetchMatches(1, {});

    query.mockReset();
    mockEmpresa(perfilRow, "GRANDE", [linha]);
    const [comoGrande] = await fetchMatches(1, {});

    expect(comoMe.score - comoGrande.score).toBe(40);
    expect(comoGrande.motivos.map((m) => m.codigo)).toContain("me_epp_exclusivo");
    expect(comoMe.motivos.map((m) => m.codigo)).not.toContain("me_epp_exclusivo");
  });

  it("falls back to empty termos/ufs when the empresa has no perfil row", async () => {
    mockEmpresa(null, "ME", [candidato({ cnae_hits_secundario: ["4789099"] })]);

    const rows = await fetchMatches(1, {});

    const [, values] = query.mock.calls[3];
    expect(values[0]).toBe(1);
    expect(values[1]).toEqual([]);
    expect(values[2]).toBe(null);
    // CNAE-only matching still works: 25 + 10 (uf livre) + 10 (valor livre).
    expect(rows[0].score).toBe(45);
  });

  it("never interpolates filter values into the SQL text", async () => {
    mockEmpresa(perfilRow, "ME", []);

    await fetchMatches(1, { q: "lapis'; DROP TABLE licitacao; --", ufs: ["RJ"] });

    const [text, values] = query.mock.calls[3];
    expect(text).not.toContain("DROP TABLE");
    expect(values).toContain("lapis'; DROP TABLE licitacao; --");
  });

  it("passes the perfil embedding to the candidate query and scores it", async () => {
    mockEmpresa(
      perfilRow,
      "ME",
      [candidato({ termo_hits: ["lapis"], similaridade: "0.62" })],
      "[0.1,0.2,0.3]",
    );

    const rows = await fetchMatches(1, {});

    const [text, values] = query.mock.calls[3];
    expect(text).toContain("<=>");
    expect(values).toContain("[0.1,0.2,0.3]");
    expect(rows[0].motivos.map((m) => m.codigo)).toContain("semantico_alto");
    expect(
      rows[0].motivos.find((m) => m.codigo === "semantico_alto")?.detalhe,
    ).toBe("sim=0.62");
    // 25 (1 termo) + 10 (uf) + 10 (valor) + 20 (semântico)
    expect(rows[0].score).toBe(65);
  });

  it("omits the vector CTE when the empresa has no embedding", async () => {
    mockEmpresa(perfilRow, "ME", [candidato({ termo_hits: ["lapis"] })]);

    const rows = await fetchMatches(1, {});

    const [text] = query.mock.calls[3];
    expect(text).not.toContain("<=>");
    expect(rows[0].motivos.map((m) => m.codigo)).not.toContain("semantico");
    expect(rows[0].score).toBe(45);
  });
});
