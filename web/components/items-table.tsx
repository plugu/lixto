// Items table for the procurement detail page — the kit's compact-density
// Table (no card wrapper, hairline rows) for md and up. Below md, the same
// data renders as a stacked card list so no column is silently lost at narrow
// widths. The "Homologado" column is the price benchmark (price-queries.ts).

import { Badge } from "@/components/ui/badge";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { formatCurrencyBRL, formatDateBR } from "@/lib/format";
import type { PriceItem } from "@/lib/price-queries";
import type { ItemRow } from "@/lib/procurement-detail-queries";

const quantityFormatter = new Intl.NumberFormat("pt-BR");

function formatQuantity(value: string | null): string {
  if (value === null) return "—";
  const num = Number(value);
  if (Number.isNaN(num)) return "—";
  return quantityFormatter.format(num);
}

/** Desktop cell: median + n as a `<details>` disclosure when there is history,
 * an honest muted note otherwise. `undefined` covers a missing map entry —
 * `fetchPriceBenchmark` always returns one per item, but the prop is optional
 * so the component still works uncalled. */
function AwardedCell({ price }: { price: PriceItem | undefined }) {
  if (!price || price.state === "collecting") {
    return <span className="text-ink-muted">Coletando…</span>;
  }
  if (price.state === "insufficient") {
    return <span className="text-ink-muted">Amostra insuficiente</span>;
  }
  return (
    <details>
      <summary className="cursor-pointer tabular-nums text-ink">
        {formatCurrencyBRL(price.median)}{" "}
        <span className="text-ink-muted">· n={price.n}</span>
      </summary>
      <div className="mt-2 flex flex-col gap-1.5 text-xs">
        <p className="tabular-nums text-ink-muted">
          {formatCurrencyBRL(price.p25)} – {formatCurrencyBRL(price.p75)}
        </p>
        {price.winners.map((winner, index) => (
          <p
            key={winner.supplier_tax_id ?? index}
            className="flex flex-wrap items-center gap-1.5 text-ink-muted"
          >
            <span className="text-ink">{winner.supplier_name || "—"}</span>
            {winner.supplier_size_name && (
              <Badge tone="neutral">{winner.supplier_size_name}</Badge>
            )}
            <span className="tabular-nums">
              {formatCurrencyBRL(winner.awarded_unit_price)}
            </span>
            <span>{formatDateBR(winner.result_date)}</span>
          </p>
        ))}
      </div>
    </details>
  );
}

/** Mobile line: same three states, no disclosure. */
function AwardedLine({ price }: { price: PriceItem | undefined }) {
  if (!price || price.state === "collecting") {
    return <span className="text-ink-muted">Coletando…</span>;
  }
  if (price.state === "insufficient") {
    return <span className="text-ink-muted">Amostra insuficiente</span>;
  }
  return (
    <span className="tabular-nums text-ink-muted">
      Homologado {formatCurrencyBRL(price.median)} · n={price.n}
    </span>
  );
}

export function ItemsTable({
  items,
  prices,
}: {
  items: ItemRow[];
  prices?: Map<number, PriceItem>;
}) {
  if (items.length === 0) {
    return <p className="text-sm text-ink-muted">Nenhum item encontrado.</p>;
  }

  return (
    <>
      <div className="hidden overflow-x-auto md:block -mx-4 px-4 sm:-mx-6 sm:px-6">
        <Table density="compact">
          <THead bg="surface">
            <TH>Nº</TH>
            <TH>Descrição</TH>
            <TH align="right">Quantidade</TH>
            <TH>Unidade</TH>
            <TH align="right">Valor unitário</TH>
            <TH>Homologado</TH>
            <TH align="right">Valor total</TH>
            <TH>Situação</TH>
            <TH>Benefício</TH>
          </THead>
          <TBody>
            {items.map((item) => (
              <TR key={item.item_number}>
                <TD>{item.item_number}</TD>
                <TD className="max-w-[28rem] whitespace-normal break-words align-top">
                  {item.description || "—"}
                </TD>
                <TD align="right" numeric>
                  {formatQuantity(item.quantity)}
                </TD>
                <TD>{item.unit || "—"}</TD>
                <TD align="right" numeric>
                  {formatCurrencyBRL(item.estimated_unit_price)}
                </TD>
                <TD className="align-top">
                  <AwardedCell price={prices?.get(item.item_number)} />
                </TD>
                <TD align="right" numeric>
                  {formatCurrencyBRL(item.estimated_total)}
                </TD>
                <TD className="text-ink-muted">{item.status_name || "—"}</TD>
                <TD className="text-ink-muted">
                  {item.benefit_type_name || "—"}
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      </div>

      <ul className="flex flex-col gap-2.5 md:hidden">
        {items.map((item) => (
          <li
            key={item.item_number}
            className="flex flex-col gap-2 rounded-lg border border-line px-3 py-3"
          >
            <div className="flex items-start justify-between gap-3">
              <span className="text-xs font-medium text-ink-muted">
                Item {item.item_number}
              </span>
            </div>
            <p className="line-clamp-2 text-sm text-ink">
              {item.description || "—"}
            </p>
            <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 text-sm">
              <span className="text-ink-muted">
                {formatQuantity(item.quantity)} {item.unit || "—"}
              </span>
              <span className="tabular-nums text-ink-muted">
                {formatCurrencyBRL(item.estimated_unit_price)} / un
              </span>
            </div>
            <p className="text-xs">
              <AwardedLine price={prices?.get(item.item_number)} />
            </p>
            <p className="text-sm font-medium tabular-nums text-ink">
              {formatCurrencyBRL(item.estimated_total)}
            </p>
            {(item.status_name || item.benefit_type_name) && (
              <div className="flex flex-wrap gap-1.5 pt-0.5">
                {item.status_name ? (
                  <Badge tone="neutral">{item.status_name}</Badge>
                ) : null}
                {item.benefit_type_name ? (
                  <Badge tone="neutral">{item.benefit_type_name}</Badge>
                ) : null}
              </div>
            )}
          </li>
        ))}
      </ul>
    </>
  );
}
