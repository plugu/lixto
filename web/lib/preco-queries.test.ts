import { beforeEach, describe, expect, it, vi } from "vitest";

// Relative imports (not "@/lib/...") on purpose: vitest runs without a config
// file. The pool is mocked — these tests never touch a live database.
vi.mock("./db", () => ({ pool: { query: vi.fn() } }));

import { pool } from "./db";
import {
  buildTsQuery,
  enqueueResultadosFaltantes,
  fetchPrecoBenchmark,
} from "./preco-queries";

const query = pool.query as unknown as ReturnType<typeof vi.fn>;

const CONTROLE = "12345678000199-1-000123/2026";

type QueryResult = { rows: unknown[]; rowCount?: number };

function result(rows: unknown[], rowCount?: number): QueryResult {
  return { rows, rowCount: rowCount ?? rows.length };
}

/** The first query of both exported functions: the licitação's own itens. */
function itens(...rows: { numero_item: number; descricao: string | null }[]) {
  return result(rows);
}

function benchRow(over: Record<string, unknown> = {}) {
  return {
    numero_item: 1,
    n: 0,
    mediana: null,
    p25: null,
    p75: null,
    vencedores: null,
    pendente: false,
    ...over,
  };
}

beforeEach(() => {
  query.mockReset();
});

describe("buildTsQuery", () => {
  it("returns nulls for null/empty descrição", () => {
    expect(buildTsQuery(null)).toEqual({ primary: null, fallback: null });
    expect(buildTsQuery("")).toEqual({ primary: null, fallback: null });
    expect(buildTsQuery("   ")).toEqual({ primary: null, fallback: null });
  });

  it("strips accents and lowercases", () => {
    expect(buildTsQuery("Lápis Preto Nº2 GRÁFITE").primary).toBe(
      "lapis & preto & grafite",
    );
  });

  it("drops tokens shorter than 4 characters", () => {
    expect(buildTsQuery("papel A4 de gramatura").primary).toBe(
      "papel & gramatura",
    );
  });

  it("drops stop words, including accented ones after stripping", () => {
    expect(
      buildTsQuery("Material de limpeza tipo detergente conforme referência")
        .primary,
    ).toBe("limpeza & detergente");
    expect(buildTsQuery("Serviço de manutenção predial").primary).toBe(
      "manutencao & predial",
    );
  });

  it("caps primary at 6 tokens and fallback at 3", () => {
    const descricao =
      "cadeira giratoria ergonomica encosto telado braco regulavel rodizio";
    expect(buildTsQuery(descricao)).toEqual({
      primary:
        "cadeira & giratoria & ergonomica & encosto & telado & braco",
      fallback: "cadeira & giratoria & ergonomica",
    });
  });

  it("uses whatever survives when there are fewer than 3 tokens", () => {
    expect(buildTsQuery("papel sulfite")).toEqual({
      primary: "papel & sulfite",
      fallback: "papel & sulfite",
    });
  });

  it("returns nulls when every token is dropped", () => {
    expect(buildTsQuery("de um p/ 12 - item")).toEqual({
      primary: null,
      fallback: null,
    });
  });
});

describe("fetchPrecoBenchmark", () => {
  it("marks n >= 5 as ok and keeps the percentiles", async () => {
    query
      .mockResolvedValueOnce(itens({ numero_item: 1, descricao: "papel sulfite branco" }))
      .mockResolvedValueOnce(
        result([
          benchRow({ n: 7, mediana: "19.90", p25: "18.00", p75: "22.50" }),
        ]),
      );

    const map = await fetchPrecoBenchmark(CONTROLE);

    expect(query).toHaveBeenCalledTimes(2);
    expect(map.get(1)).toMatchObject({
      numero_item: 1,
      estado: "ok",
      n: 7,
      mediana: "19.90",
      p25: "18.00",
      p75: "22.50",
    });
  });

  it("binds numeroControlePncp as $1 and never interpolates it", async () => {
    query
      .mockResolvedValueOnce(itens({ numero_item: 1, descricao: "papel sulfite branco" }))
      .mockResolvedValueOnce(result([benchRow({ n: 9 })]));

    await fetchPrecoBenchmark(CONTROLE);

    const [text, values] = query.mock.calls[1];
    expect(text).toContain("hist.numero_controle_pncp <> $1");
    expect(text).not.toContain(CONTROLE);
    expect(values[0]).toBe(CONTROLE);
    expect(values[1]).toEqual([1]);
    expect(values[2]).toEqual(["papel & sulfite & branco"]);
  });

  it("uses the GIN-indexed FTS expression and the bounded LATERAL", async () => {
    query
      .mockResolvedValueOnce(itens({ numero_item: 1, descricao: "papel sulfite branco" }))
      .mockResolvedValueOnce(result([benchRow({ n: 9 })]));

    await fetchPrecoBenchmark(CONTROLE);

    const [text] = query.mock.calls[1];
    expect(text).toContain(
      "to_tsvector('portuguese', f_unaccent(coalesce(hist.descricao, '')))",
    );
    expect(text).toContain("to_tsquery('portuguese', alvo.tsq)");
    expect(text).toContain("LIMIT 200");
    expect(text).toContain(
      "(r.ordem_classificacao_srp IS NULL OR r.ordem_classificacao_srp = 1)",
    );
    expect(text).toContain("r.data_resultado >= current_date - interval '24 months'");
  });

  it("reports coletando with null percentiles when n < 5 and itens are queued", async () => {
    query
      .mockResolvedValueOnce(itens({ numero_item: 1, descricao: "papel sulfite branco" }))
      .mockResolvedValueOnce(
        result([
          benchRow({ n: 2, mediana: "19.90", p25: "18.00", p75: "22.50", pendente: true }),
        ]),
      );

    const map = await fetchPrecoBenchmark(CONTROLE);

    expect(map.get(1)).toMatchObject({
      estado: "coletando",
      n: 2,
      mediana: null,
      p25: null,
      p75: null,
    });
  });

  it("reports insuficiente when n < 5 and nothing is pending", async () => {
    query
      .mockResolvedValueOnce(itens({ numero_item: 1, descricao: "papel sulfite branco" }))
      .mockResolvedValueOnce(
        result([benchRow({ n: 2, mediana: "19.90", pendente: false })]),
      );

    const map = await fetchPrecoBenchmark(CONTROLE);

    expect(map.get(1)).toMatchObject({ estado: "insuficiente", n: 2, mediana: null });
  });

  it("fires the fallback query only for the itens below the threshold", async () => {
    query
      .mockResolvedValueOnce(
        itens(
          { numero_item: 1, descricao: "cadeira giratoria ergonomica encosto telado" },
          { numero_item: 2, descricao: "mesa escritorio retangular tampo melaminico" },
        ),
      )
      .mockResolvedValueOnce(
        result([
          benchRow({ numero_item: 1, n: 8, mediana: "500.00" }),
          benchRow({ numero_item: 2, n: 1 }),
        ]),
      )
      .mockResolvedValueOnce(
        result([benchRow({ numero_item: 2, n: 6, mediana: "300.00" })]),
      );

    const map = await fetchPrecoBenchmark(CONTROLE);

    expect(query).toHaveBeenCalledTimes(3);
    const [, values] = query.mock.calls[2];
    expect(values[1]).toEqual([2]);
    expect(values[2]).toEqual(["mesa & escritorio & retangular"]);
    expect(map.get(1)).toMatchObject({ estado: "ok", n: 8, mediana: "500.00" });
    expect(map.get(2)).toMatchObject({ estado: "ok", n: 6, mediana: "300.00" });
  });

  it("skips both queries for itens with no usable token", async () => {
    query.mockResolvedValueOnce(itens({ numero_item: 1, descricao: "item de um" }));

    const map = await fetchPrecoBenchmark(CONTROLE);

    expect(query).toHaveBeenCalledTimes(1);
    expect(map.get(1)).toEqual({
      numero_item: 1,
      estado: "insuficiente",
      n: 0,
      mediana: null,
      p25: null,
      p75: null,
      vencedores: [],
    });
  });

  it("deduplicates winners by ni_fornecedor, caps at 3 and sorts most recent first", async () => {
    query
      .mockResolvedValueOnce(itens({ numero_item: 1, descricao: "papel sulfite branco" }))
      .mockResolvedValueOnce(
        result([
          benchRow({
            n: 9,
            mediana: "19.90",
            vencedores: [
              { ni_fornecedor: "A", nome_razao_social_fornecedor: "Alfa", porte_fornecedor_nome: "ME", valor_unitario_homologado: "19.00", data_resultado: "2026-05-01" },
              { ni_fornecedor: "A", nome_razao_social_fornecedor: "Alfa", porte_fornecedor_nome: "ME", valor_unitario_homologado: "18.00", data_resultado: "2026-06-01" },
              { ni_fornecedor: "B", nome_razao_social_fornecedor: "Beta", porte_fornecedor_nome: "EPP", valor_unitario_homologado: "20.00", data_resultado: "2026-04-01" },
              { ni_fornecedor: "C", nome_razao_social_fornecedor: "Gama", porte_fornecedor_nome: null, valor_unitario_homologado: "21.00", data_resultado: "2026-03-01" },
              { ni_fornecedor: "D", nome_razao_social_fornecedor: "Delta", porte_fornecedor_nome: null, valor_unitario_homologado: "22.00", data_resultado: "2026-02-01" },
            ],
          }),
        ]),
      );

    const vencedores = (await fetchPrecoBenchmark(CONTROLE)).get(1)!.vencedores;

    expect(vencedores).toHaveLength(3);
    expect(vencedores.map((v) => v.ni_fornecedor)).toEqual(["A", "B", "C"]);
    // Most recent row wins for the deduplicated supplier.
    expect(vencedores[0].valor_unitario_homologado).toBe("18.00");
    expect(vencedores[0].data_resultado).toBeInstanceOf(Date);
    expect(vencedores[0].data_resultado?.getFullYear()).toBe(2026);
  });

  it("returns an empty vencedores array when there are none", async () => {
    query
      .mockResolvedValueOnce(itens({ numero_item: 1, descricao: "papel sulfite branco" }))
      .mockResolvedValueOnce(result([benchRow({ n: 0, pendente: true })]));

    const map = await fetchPrecoBenchmark(CONTROLE);

    expect(map.get(1)).toMatchObject({ estado: "coletando", n: 0, vencedores: [] });
  });
});

describe("enqueueResultadosFaltantes", () => {
  it("returns rowCount and binds numeroControlePncp as $1", async () => {
    query
      .mockResolvedValueOnce(itens({ numero_item: 1, descricao: "papel sulfite branco" }))
      .mockResolvedValueOnce({ rows: [], rowCount: 12 });

    expect(await enqueueResultadosFaltantes(CONTROLE)).toBe(12);

    const [text, values] = query.mock.calls[1];
    expect(text).toContain("UPDATE item SET resultados_solicitados_em = now()");
    expect(text).toContain("hist.numero_controle_pncp <> $1");
    expect(text).not.toContain(CONTROLE);
    expect(values[0]).toBe(CONTROLE);
    expect(values[1]).toEqual([1]);
    expect(values[2]).toEqual(["papel & sulfite & branco"]);
  });

  it("excludes already-queued and already-collected itens, so a second call converges to zero", async () => {
    query
      .mockResolvedValueOnce(itens({ numero_item: 1, descricao: "papel sulfite branco" }))
      .mockResolvedValueOnce({ rows: [], rowCount: 0 });

    expect(await enqueueResultadosFaltantes(CONTROLE)).toBe(0);

    const [text] = query.mock.calls[1];
    expect(text).toContain("hist.resultados_solicitados_em IS NULL");
    expect(text).toContain("hist.resultados_sincronizados_em IS NULL");
    expect(text).toContain("AND resultados_solicitados_em IS NULL");
    expect(text).toContain("LIMIT 40");
  });

  it("does not run the update when no item has a usable token", async () => {
    query.mockResolvedValueOnce(itens({ numero_item: 1, descricao: null }));

    expect(await enqueueResultadosFaltantes(CONTROLE)).toBe(0);
    expect(query).toHaveBeenCalledTimes(1);
  });
});
