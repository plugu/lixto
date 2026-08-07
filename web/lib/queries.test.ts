import { describe, expect, it } from "vitest";
import { PORTAIS_ATIVOS } from "./portais";
import {
  buildCountQuery,
  buildListQuery,
  buildModalidadeFacetQuery,
  buildPortalFacetQuery,
  buildPortalOptionsQuery,
  buildSetorFacetQuery,
  buildStatusFacetQuery,
  buildUfFacetQuery,
  buildWhereClause,
  parseFilters,
} from "./queries";

describe("parseFilters", () => {
  it("returns an empty object when no params are present", () => {
    expect(parseFilters({})).toEqual({});
  });

  it("trims and keeps q when non-empty", () => {
    expect(parseFilters({ q: "  merenda  " })).toEqual({ q: "merenda" });
  });

  it("drops an empty/whitespace-only q", () => {
    expect(parseFilters({ q: "   " })).toEqual({});
  });

  it("unwraps array-valued q param (first value wins)", () => {
    expect(parseFilters({ q: ["a", "b"] })).toEqual({ q: "a" });
  });

  describe("portais", () => {
    it("parses a single value as a one-element array", () => {
      expect(parseFilters({ portal: "www.bll.org.br" })).toEqual({
        portais: ["www.bll.org.br"],
      });
    });

    it("parses repeated values as an array", () => {
      expect(
        parseFilters({ portal: ["Compras.gov.br", "IPM Sistemas"] }),
      ).toEqual({
        portais: ["Compras.gov.br", "IPM Sistemas"],
      });
    });

    it("drops empty/whitespace-only entries", () => {
      expect(parseFilters({ portal: ["", "  ", "IPM Sistemas"] })).toEqual({
        portais: ["IPM Sistemas"],
      });
    });
  });

  describe("modalidadeIds", () => {
    it("parses a single modalidade as a one-element array of ids", () => {
      expect(parseFilters({ modalidade: "6" })).toEqual({
        modalidadeIds: [6],
      });
    });

    it("parses repeated modalidade params as an array of ids", () => {
      expect(parseFilters({ modalidade: ["6", "8"] })).toEqual({
        modalidadeIds: [6, 8],
      });
    });

    it("drops a fully non-numeric modalidade", () => {
      expect(parseFilters({ modalidade: "abc" })).toEqual({});
    });

    it("keeps valid ids and drops invalid ones when mixed", () => {
      expect(parseFilters({ modalidade: ["6", "abc", "8"] })).toEqual({
        modalidadeIds: [6, 8],
      });
    });
  });

  describe("statuses", () => {
    it("keeps only known status values, as an array", () => {
      expect(parseFilters({ status: "aberta" })).toEqual({
        statuses: ["aberta"],
      });
      expect(parseFilters({ status: "vai_abrir" })).toEqual({
        statuses: ["vai_abrir"],
      });
      expect(parseFilters({ status: "fechada" })).toEqual({
        statuses: ["fechada"],
      });
      expect(parseFilters({ status: "bogus" })).toEqual({});
    });

    it("parses repeated status params, dropping unknown values when mixed", () => {
      expect(parseFilters({ status: ["aberta", "bogus", "vai_abrir"] })).toEqual({
        statuses: ["aberta", "vai_abrir"],
      });
    });
  });

  describe("setores", () => {
    it("parses a single setor as a one-element array", () => {
      expect(parseFilters({ setor: "Saúde" })).toEqual({ setores: ["Saúde"] });
    });

    it("parses repeated setor params as an array", () => {
      expect(parseFilters({ setor: ["Saúde", "Educação"] })).toEqual({
        setores: ["Saúde", "Educação"],
      });
    });
  });

  describe("ufs", () => {
    it("parses a single 2-letter uf", () => {
      expect(parseFilters({ uf: "SP" })).toEqual({ ufs: ["SP"] });
    });

    it("parses repeated uf params", () => {
      expect(parseFilters({ uf: ["SP", "MG"] })).toEqual({ ufs: ["SP", "MG"] });
    });

    it("uppercases lowercase ufs", () => {
      expect(parseFilters({ uf: "sp" })).toEqual({ ufs: ["SP"] });
    });

    it("drops values that aren't exactly 2 letters", () => {
      expect(parseFilters({ uf: ["S", "SPX", "123", "SP"] })).toEqual({
        ufs: ["SP"],
      });
    });
  });

  describe("categoria", () => {
    it("keeps only known categoria values", () => {
      expect(parseFilters({ categoria: "produto" })).toEqual({
        categoria: "produto",
      });
      expect(parseFilters({ categoria: "servico" })).toEqual({
        categoria: "servico",
      });
      expect(parseFilters({ categoria: "mista" })).toEqual({
        categoria: "mista",
      });
      expect(parseFilters({ categoria: "bogus" })).toEqual({});
    });
  });

  describe("valorMin / valorMax", () => {
    it("parses numeric valorMin and valorMax", () => {
      expect(parseFilters({ valorMin: "50000", valorMax: "500000" })).toEqual({
        valorMin: 50000,
        valorMax: 500000,
      });
    });

    it("drops non-numeric valorMin/valorMax", () => {
      expect(parseFilters({ valorMin: "abc", valorMax: "" })).toEqual({});
    });

    it("accepts a valorMin of 0", () => {
      expect(parseFilters({ valorMin: "0" })).toEqual({ valorMin: 0 });
    });
  });

  it("combines all filters together", () => {
    expect(
      parseFilters({
        q: "merenda",
        portal: ["www.bll.org.br", "IPM Sistemas"],
        modalidade: ["6", "8"],
        status: "aberta",
        setor: "Saúde",
        uf: ["SP", "MG"],
        valorMin: "1000",
        valorMax: "9000",
      }),
    ).toEqual({
      q: "merenda",
      portais: ["www.bll.org.br", "IPM Sistemas"],
      modalidadeIds: [6, 8],
      statuses: ["aberta"],
      setores: ["Saúde"],
      ufs: ["SP", "MG"],
      valorMin: 1000,
      valorMax: 9000,
    });
  });
});

describe("buildWhereClause", () => {
  it("always applies the top-7 portal allowlist as the base predicate, even with no filters", () => {
    const { where, values } = buildWhereClause({});
    expect(where).toBe("WHERE usuario_nome = ANY($1)");
    expect(values).toEqual([PORTAIS_ATIVOS]);
  });

  it("builds the q predicate against objeto_compra and item.descricao, after the allowlist param", () => {
    const { where, values } = buildWhereClause({ q: "merenda" });
    expect(values).toEqual([PORTAIS_ATIVOS, "merenda"]);
    expect(where).toContain(
      "to_tsvector('portuguese', objeto_compra) @@ websearch_to_tsquery('portuguese', $2)",
    );
    expect(where).toContain("EXISTS (");
    expect(where).toContain(
      "item.numero_controle_pncp = licitacao.numero_controle_pncp",
    );
    expect(where).toContain(
      "to_tsvector('portuguese', coalesce(item.descricao, '')) @@ websearch_to_tsquery('portuguese', $2)",
    );
  });

  it("builds the portais predicate as = ANY, intersected with the allowlist", () => {
    const { where, values } = buildWhereClause({
      portais: ["Compras.gov.br", "IPM Sistemas"],
    });
    expect(where).toBe("WHERE usuario_nome = ANY($1) AND usuario_nome = ANY($2)");
    expect(values).toEqual([PORTAIS_ATIVOS, ["Compras.gov.br", "IPM Sistemas"]]);
  });

  it("builds the modalidadeIds predicate as = ANY, after the allowlist param", () => {
    const { where, values } = buildWhereClause({ modalidadeIds: [6, 8] });
    expect(where).toBe("WHERE usuario_nome = ANY($1) AND modalidade_id = ANY($2)");
    expect(values).toEqual([PORTAIS_ATIVOS, [6, 8]]);
  });

  it("builds a single status predicate with no extra params", () => {
    const { where, values } = buildWhereClause({ statuses: ["aberta"] });
    expect(where).toBe(
      "WHERE usuario_nome = ANY($1) AND ((data_abertura_proposta <= now() AND now() < data_encerramento_proposta))",
    );
    expect(values).toEqual([PORTAIS_ATIVOS]);
  });

  it("OR-combines multiple statuses' date predicates", () => {
    const { where } = buildWhereClause({ statuses: ["aberta", "vai_abrir"] });
    expect(where).toBe(
      "WHERE usuario_nome = ANY($1) AND ((data_abertura_proposta <= now() AND now() < data_encerramento_proposta) OR (data_abertura_proposta > now()))",
    );
  });

  it("builds the setores predicate as = ANY", () => {
    const { where, values } = buildWhereClause({ setores: ["Saúde", "Educação"] });
    expect(where).toBe("WHERE usuario_nome = ANY($1) AND setor = ANY($2)");
    expect(values).toEqual([PORTAIS_ATIVOS, ["Saúde", "Educação"]]);
  });

  it("builds the ufs predicate as = ANY", () => {
    const { where, values } = buildWhereClause({ ufs: ["SP", "MG"] });
    expect(where).toBe("WHERE usuario_nome = ANY($1) AND uf = ANY($2)");
    expect(values).toEqual([PORTAIS_ATIVOS, ["SP", "MG"]]);
  });

  it("builds valorMin as a >= predicate", () => {
    const { where, values } = buildWhereClause({ valorMin: 50000 });
    expect(where).toBe("WHERE usuario_nome = ANY($1) AND valor_total_estimado >= $2");
    expect(values).toEqual([PORTAIS_ATIVOS, 50000]);
  });

  it("builds valorMax as a <= predicate", () => {
    const { where, values } = buildWhereClause({ valorMax: 500000 });
    expect(where).toBe("WHERE usuario_nome = ANY($1) AND valor_total_estimado <= $2");
    expect(values).toEqual([PORTAIS_ATIVOS, 500000]);
  });

  it("combines valorMin and valorMax bounds", () => {
    const { where, values } = buildWhereClause({ valorMin: 50000, valorMax: 500000 });
    expect(where).toBe(
      "WHERE usuario_nome = ANY($1) AND valor_total_estimado >= $2 AND valor_total_estimado <= $3",
    );
    expect(values).toEqual([PORTAIS_ATIVOS, 50000, 500000]);
  });

  it("combines all filters with AND after the allowlist, each with correctly numbered params", () => {
    const { where, values } = buildWhereClause({
      q: "merenda",
      portais: ["www.bll.org.br"],
      modalidadeIds: [6],
      statuses: ["aberta"],
      setores: ["Saúde"],
      ufs: ["SP"],
      valorMin: 1000,
      valorMax: 9000,
    });
    expect(values).toEqual([
      PORTAIS_ATIVOS,
      "merenda",
      ["www.bll.org.br"],
      [6],
      ["Saúde"],
      ["SP"],
      1000,
      9000,
    ]);
    expect(where).toContain("WHERE usuario_nome = ANY($1)");
    expect(where).toContain("usuario_nome = ANY($3)");
    expect(where).toContain("modalidade_id = ANY($4)");
    expect(where).toContain(
      "(data_abertura_proposta <= now() AND now() < data_encerramento_proposta)",
    );
    expect(where).toContain("setor = ANY($5)");
    expect(where).toContain("uf = ANY($6)");
    expect(where).toContain("valor_total_estimado >= $7");
    expect(where).toContain("valor_total_estimado <= $8");
    expect(where.match(/AND/g)?.length).toBeGreaterThanOrEqual(7);
  });
});

describe("buildPortalOptionsQuery", () => {
  it("restricts distinct portal options to the top-7 allowlist", () => {
    const { text, values } = buildPortalOptionsQuery();
    expect(text).toContain("usuario_nome = ANY($1)");
    expect(values).toEqual([PORTAIS_ATIVOS]);
  });
});

describe("buildListQuery", () => {
  it("appends limit/offset params after the allowlist and filter params", () => {
    const { text, values } = buildListQuery(
      { portais: ["www.bll.org.br"] },
      25,
      50,
    );
    expect(values).toEqual([PORTAIS_ATIVOS, ["www.bll.org.br"], 25, 50]);
    expect(text).toContain("usuario_nome = ANY($1)");
    expect(text).toContain("usuario_nome = ANY($2)");
    expect(text).toContain("LIMIT $3 OFFSET $4");
  });

  it("uses the allowlist param plus limit/offset when no other filters are active", () => {
    const { text, values } = buildListQuery({}, 25, 0);
    expect(values).toEqual([PORTAIS_ATIVOS, 25, 0]);
    expect(text).toContain("WHERE usuario_nome = ANY($1)");
    expect(text).toContain("LIMIT $2 OFFSET $3");
  });

  it("preserves the status-group/sort_val ordering logic", () => {
    const { text } = buildListQuery({}, 25, 0);
    expect(text).toContain("ORDER BY status_group ASC, sort_val ASC NULLS LAST");
  });
});

describe("buildCountQuery", () => {
  it("reuses the same WHERE clause and params as the list query", () => {
    const filters = { q: "merenda", statuses: ["aberta" as const] };
    const count = buildCountQuery(filters);
    const { where, values } = buildWhereClause(filters);
    expect(count.text).toContain(where);
    expect(count.values).toEqual(values);
  });

  it("always applies the allowlist WHERE clause, even with no other filters", () => {
    const { text, values } = buildCountQuery({});
    expect(text).toContain("WHERE usuario_nome = ANY($1)");
    expect(values).toEqual([PORTAIS_ATIVOS]);
  });
});

describe("categoria filter", () => {
  it("builds produto as has-M-and-not-S over item, with only the allowlist param", () => {
    const { where, values } = buildWhereClause({ categoria: "produto" });
    expect(values).toEqual([PORTAIS_ATIVOS]);
    expect(where).toContain("i.material_ou_servico = 'M'");
    expect(where).toContain("AND NOT EXISTS");
  });

  it("builds mista as has-M-and-has-S", () => {
    const { where } = buildWhereClause({ categoria: "mista" });
    expect(where).toContain("i.material_ou_servico = 'M'");
    expect(where).toContain("i.material_ou_servico = 'S'");
    expect(where).not.toContain("NOT EXISTS");
  });
});

describe("facet-count query builders", () => {
  it("modalidade facet excludes modalidadeIds but keeps other active filters and the allowlist", () => {
    const { text, values } = buildModalidadeFacetQuery({
      modalidadeIds: [6],
      setores: ["Saúde"],
    });
    expect(text).toContain("usuario_nome = ANY($1)");
    expect(text).not.toContain("modalidade_id = ANY");
    expect(text).toContain("setor = ANY($2)");
    expect(text).toContain("GROUP BY modalidade_id, modalidade_nome");
    expect(text).toContain("modalidade_id IS NOT NULL");
    expect(values).toEqual([PORTAIS_ATIVOS, ["Saúde"]]);
  });

  it("setor facet excludes setores but keeps other active filters", () => {
    const { text, values } = buildSetorFacetQuery({
      setores: ["Saúde"],
      ufs: ["SP"],
    });
    expect(text).not.toContain("setor = ANY");
    expect(text).toContain("uf = ANY($2)");
    expect(text).toContain("GROUP BY setor");
    expect(values).toEqual([PORTAIS_ATIVOS, ["SP"]]);
  });

  it("portal facet excludes portais but keeps the base allowlist and other filters", () => {
    const { text, values } = buildPortalFacetQuery({
      portais: ["Compras.gov.br"],
      modalidadeIds: [6],
    });
    // Only one usuario_nome = ANY($1) — the allowlist; the user's own portal
    // selection is excluded from this facet's own WHERE clause.
    expect(text.match(/usuario_nome = ANY/g)?.length).toBe(1);
    expect(text).toContain("modalidade_id = ANY($2)");
    expect(text).toContain("GROUP BY usuario_nome");
    expect(values).toEqual([PORTAIS_ATIVOS, [6]]);
  });

  it("status facet excludes statuses but keeps other active filters, using FILTER aggregates", () => {
    const { text, values } = buildStatusFacetQuery({
      statuses: ["aberta"],
      ufs: ["SP"],
    });
    expect(text).toContain("count(*) FILTER (WHERE");
    expect(text).toContain("AS aberta");
    expect(text).toContain("AS vai_abrir");
    expect(text).toContain("AS fechada");
    expect(text).toContain("uf = ANY($2)");
    expect(values).toEqual([PORTAIS_ATIVOS, ["SP"]]);
  });

  it("uf facet excludes ufs but keeps other active filters", () => {
    const { text, values } = buildUfFacetQuery({
      ufs: ["SP"],
      statuses: ["aberta"],
    });
    expect(text).not.toContain("uf = ANY");
    expect(text).toContain("uf IS NOT NULL");
    expect(text).toContain("GROUP BY uf");
    expect(text).toContain(
      "(data_abertura_proposta <= now() AND now() < data_encerramento_proposta)",
    );
    expect(values).toEqual([PORTAIS_ATIVOS]);
  });
});
