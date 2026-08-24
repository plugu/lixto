// Stacked-card reflow of the licitações table row, shown below `md` (ticket
// 43). Same data as the table row — objeto, órgão/localização, status/fit
// badges, valor + encerramento — no columns dropped, no query changes.
import Link from "next/link";
import { FitBadge } from "@/components/fit-badge";
import { StatusBadge } from "@/components/status-badge";
import { formatCurrencyBRL, formatDateBR } from "@/lib/format";
import type { LicitacaoRow } from "@/lib/queries";
import type { StatusLicitacao } from "@/lib/status";

export function LicitacaoCard({
  row,
  status,
}: {
  row: LicitacaoRow;
  status: StatusLicitacao;
}) {
  const localizacao = [row.municipio_nome, row.uf].filter(Boolean).join("/");

  return (
    <Link
      href={`/licitacao/${encodeURIComponent(row.numero_controle_pncp)}`}
      className="flex flex-col gap-2 rounded-[10px] border border-line bg-surface p-3.5 active:bg-surface-raised"
    >
      <p className="line-clamp-2 text-sm font-medium text-ink">
        {row.objeto_compra || "—"}
      </p>
      <p className="truncate text-xs text-ink-muted">
        {row.orgao_razao_social || "—"}
        {localizacao ? ` · ${localizacao}` : ""}
        {row.modalidade_nome ? ` · ${row.modalidade_nome}` : ""}
      </p>
      <div className="flex flex-wrap items-center gap-1.5">
        <StatusBadge status={status} />
        <FitBadge
          verdict={row.deep_verdict ?? row.fit_verdict}
          score={row.fit_score}
        />
      </div>
      <div className="flex items-center justify-between text-xs text-ink-muted">
        <span className="tabular-nums text-ink">
          {formatCurrencyBRL(row.valor_total_estimado)}
        </span>
        <span className="tabular-nums">
          {formatDateBR(row.data_encerramento_proposta)}
        </span>
      </div>
    </Link>
  );
}
