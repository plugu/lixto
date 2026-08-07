import Link from "next/link";
import { StatusBadge } from "@/components/status-badge";
import { pool } from "@/lib/db";
import { formatCurrencyBRL, formatDateBR } from "@/lib/format";
import { computeStatus } from "@/lib/status";

const PAGE_SIZE = 25;

type LicitacaoRow = {
  numero_controle_pncp: string;
  objeto_compra: string | null;
  orgao_razao_social: string | null;
  municipio_nome: string | null;
  uf: string | null;
  modalidade_nome: string | null;
  valor_total_estimado: string | null;
  data_abertura_proposta: Date | null;
  data_encerramento_proposta: Date | null;
};

// Orders: abertas closing soonest, then futuras (vai abrir) opening soonest,
// then fechadas newest first. Mirrors v_abertas/v_futuras/v_encerradas
// (migrations/001_schema.sql) via status_group, with a sort_val normalized
// so a single ASC ordering works across the three windows (fechadas use a
// negated epoch to get "newest first" out of an ascending sort).
const LIST_QUERY = `
  WITH classified AS (
    SELECT
      numero_controle_pncp,
      objeto_compra,
      orgao_razao_social,
      municipio_nome,
      uf,
      modalidade_nome,
      valor_total_estimado,
      data_abertura_proposta,
      data_encerramento_proposta,
      CASE
        WHEN data_abertura_proposta <= now() AND now() < data_encerramento_proposta THEN 0
        WHEN data_abertura_proposta > now() THEN 1
        ELSE 2
      END AS status_group,
      CASE
        WHEN data_abertura_proposta <= now() AND now() < data_encerramento_proposta
          THEN extract(epoch FROM data_encerramento_proposta)
        WHEN data_abertura_proposta > now()
          THEN extract(epoch FROM data_abertura_proposta)
        ELSE -extract(epoch FROM coalesce(
          data_encerramento_proposta, data_publicacao_pncp, '-infinity'::timestamptz
        ))
      END AS sort_val
    FROM licitacao
  )
  SELECT
    numero_controle_pncp, objeto_compra, orgao_razao_social, municipio_nome, uf,
    modalidade_nome, valor_total_estimado, data_abertura_proposta, data_encerramento_proposta
  FROM classified
  ORDER BY status_group ASC, sort_val ASC NULLS LAST
  LIMIT $1 OFFSET $2
`;

async function fetchLicitacoes(pagina: number) {
  const offset = (pagina - 1) * PAGE_SIZE;
  const [rowsResult, countResult] = await Promise.all([
    pool.query<LicitacaoRow>(LIST_QUERY, [PAGE_SIZE, offset]),
    pool.query<{ count: string }>("SELECT count(*)::text AS count FROM licitacao"),
  ]);

  return {
    rows: rowsResult.rows,
    total: Number(countResult.rows[0]?.count ?? 0),
  };
}

export default async function Home({ searchParams }: PageProps<"/">) {
  const resolvedSearchParams = await searchParams;
  const paginaParam = resolvedSearchParams.pagina;
  const paginaRaw = Array.isArray(paginaParam) ? paginaParam[0] : paginaParam;
  const pagina = Math.max(1, Math.trunc(Number(paginaRaw)) || 1);

  const { rows, total } = await fetchLicitacoes(pagina);
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div>
      <h1 className="mb-4 text-lg font-semibold text-gray-900">Licitações</h1>

      {rows.length === 0 ? (
        <p className="py-16 text-center text-gray-500">
          Nenhuma licitação encontrada.
        </p>
      ) : (
        <div className="border-t border-gray-200">
          {rows.map((row) => {
            const status = computeStatus(
              row.data_abertura_proposta,
              row.data_encerramento_proposta,
            );
            const localizacao = [row.municipio_nome, row.uf]
              .filter(Boolean)
              .join("/");

            return (
              <Link
                key={row.numero_controle_pncp}
                href={`/licitacao/${encodeURIComponent(row.numero_controle_pncp)}`}
                className="flex flex-col gap-2 border-b border-gray-200 py-3 hover:bg-gray-50 sm:flex-row sm:items-center sm:justify-between sm:gap-4"
              >
                <div className="min-w-0 flex-1">
                  <p className="line-clamp-2 text-sm font-medium text-gray-900">
                    {row.objeto_compra || "—"}
                  </p>
                  <p className="mt-0.5 truncate text-xs text-gray-500">
                    {row.orgao_razao_social || "—"}
                    {localizacao ? ` · ${localizacao}` : ""}
                    {row.modalidade_nome ? ` · ${row.modalidade_nome}` : ""}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-4">
                  <StatusBadge status={status} />
                  <span className="w-28 text-right text-sm text-gray-900 tabular-nums">
                    {formatCurrencyBRL(row.valor_total_estimado)}
                  </span>
                  <span className="w-24 text-right text-sm text-gray-500 tabular-nums">
                    {formatDateBR(row.data_encerramento_proposta)}
                  </span>
                </div>
              </Link>
            );
          })}
        </div>
      )}

      <Pagination pagina={pagina} totalPages={totalPages} />
    </div>
  );
}

function Pagination({
  pagina,
  totalPages,
}: {
  pagina: number;
  totalPages: number;
}) {
  if (totalPages <= 1) return null;

  const prev = Math.max(1, pagina - 1);
  const next = Math.min(totalPages, pagina + 1);
  const isFirst = pagina <= 1;
  const isLast = pagina >= totalPages;

  return (
    <div className="mt-6 flex items-center justify-between text-sm text-gray-500">
      <Link
        href={`/?pagina=${prev}`}
        aria-disabled={isFirst}
        className={`rounded-lg border border-gray-200 bg-white px-3 py-1.5 ${
          isFirst ? "pointer-events-none opacity-50" : "hover:bg-gray-50"
        }`}
      >
        Anterior
      </Link>
      <span>
        Página {pagina} de {totalPages}
      </span>
      <Link
        href={`/?pagina=${next}`}
        aria-disabled={isLast}
        className={`rounded-lg border border-gray-200 bg-white px-3 py-1.5 ${
          isLast ? "pointer-events-none opacity-50" : "hover:bg-gray-50"
        }`}
      >
        Próxima
      </Link>
    </div>
  );
}
