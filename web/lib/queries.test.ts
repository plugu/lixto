import { describe, expect, it } from "vitest";
import {
  buildCountQuery,
  buildListQuery,
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

  it("keeps portal as-is", () => {
    expect(parseFilters({ portal: "www.bll.org.br" })).toEqual({
      portal: "www.bll.org.br",
    });
  });

  it("parses modalidade as an integer id", () => {
    expect(parseFilters({ modalidade: "6" })).toEqual({ modalidadeId: 6 });
  });

  it("drops a non-numeric modalidade", () => {
    expect(parseFilters({ modalidade: "abc" })).toEqual({});
  });

  it("keeps only known status values", () => {
    expect(parseFilters({ status: "aberta" })).toEqual({ status: "aberta" });
    expect(parseFilters({ status: "vai_abrir" })).toEqual({
      status: "vai_abrir",
    });
    expect(parseFilters({ status: "fechada" })).toEqual({ status: "fechada" });
    expect(parseFilters({ status: "bogus" })).toEqual({});
  });

  it("unwraps array-valued params (first value wins)", () => {
    expect(parseFilters({ q: ["a", "b"] })).toEqual({ q: "a" });
  });

  it("combines all filters together", () => {
    expect(
      parseFilters({
        q: "merenda",
        portal: "www.bll.org.br",
        modalidade: "6",
        status: "aberta",
      }),
    ).toEqual({
      q: "merenda",
      portal: "www.bll.org.br",
      modalidadeId: 6,
      status: "aberta",
    });
  });
});

describe("buildWhereClause", () => {
  it("produces no WHERE clause when no filters are active", () => {
    const { where, values } = buildWhereClause({});
    expect(where).toBe("");
    expect(values).toEqual([]);
  });

  it("builds the q predicate against objeto_compra and item.descricao, reusing one param", () => {
    const { where, values } = buildWhereClause({ q: "merenda" });
    expect(values).toEqual(["merenda"]);
    expect(where).toContain(
      "to_tsvector('portuguese', objeto_compra) @@ websearch_to_tsquery('portuguese', $1)",
    );
    expect(where).toContain("EXISTS (");
    expect(where).toContain(
      "item.numero_controle_pncp = licitacao.numero_controle_pncp",
    );
    expect(where).toContain(
      "to_tsvector('portuguese', coalesce(item.descricao, '')) @@ websearch_to_tsquery('portuguese', $1)",
    );
  });

  it("builds the portal predicate as a parameterized equality", () => {
    const { where, values } = buildWhereClause({ portal: "www.bll.org.br" });
    expect(where).toBe("WHERE portal = $1");
    expect(values).toEqual(["www.bll.org.br"]);
  });

  it("builds the modalidade predicate as a parameterized equality", () => {
    const { where, values } = buildWhereClause({ modalidadeId: 6 });
    expect(where).toBe("WHERE modalidade_id = $1");
    expect(values).toEqual([6]);
  });

  it("builds the status predicate for aberta with no params", () => {
    const { where, values } = buildWhereClause({ status: "aberta" });
    expect(where).toBe(
      "WHERE (data_abertura_proposta <= now() AND now() < data_encerramento_proposta)",
    );
    expect(values).toEqual([]);
  });

  it("builds the status predicate for vai_abrir", () => {
    const { where } = buildWhereClause({ status: "vai_abrir" });
    expect(where).toBe("WHERE (data_abertura_proposta > now())");
  });

  it("builds the status predicate for fechada", () => {
    const { where } = buildWhereClause({ status: "fechada" });
    expect(where).toBe(
      "WHERE ((data_encerramento_proposta < now() OR data_encerramento_proposta IS NULL))",
    );
  });

  it("combines all filters with AND, each with correctly numbered params", () => {
    const { where, values } = buildWhereClause({
      q: "merenda",
      portal: "www.bll.org.br",
      modalidadeId: 6,
      status: "aberta",
    });
    expect(values).toEqual(["merenda", "www.bll.org.br", 6]);
    expect(where).toContain("$1");
    expect(where).toContain("portal = $2");
    expect(where).toContain("modalidade_id = $3");
    expect(where).toContain(
      "(data_abertura_proposta <= now() AND now() < data_encerramento_proposta)",
    );
    expect(where.match(/AND/g)?.length).toBeGreaterThanOrEqual(3);
  });
});

describe("buildListQuery", () => {
  it("appends limit/offset params after the filter params", () => {
    const { text, values } = buildListQuery(
      { portal: "www.bll.org.br" },
      25,
      50,
    );
    expect(values).toEqual(["www.bll.org.br", 25, 50]);
    expect(text).toContain("portal = $1");
    expect(text).toContain("LIMIT $2 OFFSET $3");
  });

  it("uses limit/offset as the only params when no filters are active", () => {
    const { text, values } = buildListQuery({}, 25, 0);
    expect(values).toEqual([25, 0]);
    expect(text).toContain("LIMIT $1 OFFSET $2");
    expect(text).not.toContain("WHERE");
  });

  it("preserves the status-group/sort_val ordering logic", () => {
    const { text } = buildListQuery({}, 25, 0);
    expect(text).toContain("ORDER BY status_group ASC, sort_val ASC NULLS LAST");
  });
});

describe("buildCountQuery", () => {
  it("reuses the same WHERE clause and params as the list query", () => {
    const filters = { q: "merenda", status: "aberta" as const };
    const count = buildCountQuery(filters);
    const { where, values } = buildWhereClause(filters);
    expect(count.text).toContain(where);
    expect(count.values).toEqual(values);
  });

  it("has no WHERE clause when no filters are active", () => {
    const { text, values } = buildCountQuery({});
    expect(text).not.toContain("WHERE");
    expect(values).toEqual([]);
  });
});
