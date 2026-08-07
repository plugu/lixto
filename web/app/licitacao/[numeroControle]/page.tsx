import Link from "next/link";
import { DocumentosList } from "@/components/documentos-list";
import { ItensTable } from "@/components/itens-table";
import { StatusBadge } from "@/components/status-badge";
import {
  fetchDocumentos,
  fetchItens,
  fetchLicitacaoDetail,
  type LicitacaoDetail,
} from "@/lib/detail-queries";
import { formatCurrencyBRL, formatDateBR } from "@/lib/format";
import { computeStatus } from "@/lib/status";

// The route segment carries numero_controle_pncp, which contains a literal
// "/" (e.g. "11285282000137-1-000033/2026"). List links encode it with
// encodeURIComponent, so the segment arrives as "...%2F2026". Depending on
// how Next normalizes the path, `numeroControle` may still contain the
// literal "%2F" or may have already been decoded to "/" — handle both.
function decodeNumeroControle(raw: string): string {
  return /%2F/i.test(raw) ? decodeURIComponent(raw) : raw;
}

function buildPncpUrl(detail: LicitacaoDetail): string | null {
  if (!detail.orgao_cnpj || !detail.ano_compra || !detail.sequencial_compra) {
    return null;
  }
  return `https://pncp.gov.br/app/editais/${detail.orgao_cnpj}/${detail.ano_compra}/${detail.sequencial_compra}`;
}

export default async function LicitacaoDetailPage(
  props: PageProps<"/licitacao/[numeroControle]">,
) {
  const { numeroControle } = await props.params;
  const numeroControlePncp = decodeNumeroControle(numeroControle);

  const detail = await fetchLicitacaoDetail(numeroControlePncp);

  if (!detail) {
    return (
      <div className="flex flex-col gap-6">
        <BackLink />
        <p className="py-16 text-center text-gray-500">
          Licitação não encontrada.
        </p>
      </div>
    );
  }

  const [itens, documentos] = await Promise.all([
    fetchItens(numeroControlePncp),
    fetchDocumentos(numeroControlePncp),
  ]);

  const status = computeStatus(
    detail.data_abertura_proposta,
    detail.data_encerramento_proposta,
  );
  const localizacao = [detail.municipio_nome, detail.uf]
    .filter(Boolean)
    .join("/");
  const orgaoUnidade = [detail.orgao_razao_social, detail.unidade_nome]
    .filter(Boolean)
    .join(" · ");
  const pncpUrl = buildPncpUrl(detail);

  return (
    <div className="flex flex-col gap-8">
      <BackLink />

      <header className="flex flex-col gap-2">
        <StatusBadge status={status} />
        <h1 className="text-lg font-semibold text-gray-900">
          {detail.objeto_compra || "—"}
        </h1>
        <p className="text-sm text-gray-500">
          {orgaoUnidade || "—"}
          {localizacao ? ` · ${localizacao}` : ""}
        </p>
      </header>

      <section>
        <h2 className="mb-3 text-sm font-semibold text-gray-900">
          Dados da licitação
        </h2>
        <dl className="grid grid-cols-1 gap-x-8 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="Modalidade" value={detail.modalidade_nome} />
          <Field label="Modo de disputa" value={detail.modo_disputa_nome} />
          <Field label="Situação PNCP" value={detail.situacao_compra_nome} />
          <Field label="Amparo legal" value={detail.amparo_legal_nome} />
          <Field label="Processo" value={detail.processo} />
          <Field
            label="SRP"
            value={detail.srp === null ? null : detail.srp ? "Sim" : "Não"}
          />
          <Field
            label="Valor estimado"
            value={formatCurrencyBRL(detail.valor_total_estimado)}
          />
          <Field
            label="Valor homologado"
            value={formatCurrencyBRL(detail.valor_total_homologado)}
          />
          <Field
            label="Publicação"
            value={formatDateBR(detail.data_publicacao_pncp, true)}
          />
          <Field
            label="Abertura"
            value={formatDateBR(detail.data_abertura_proposta, true)}
          />
          <Field
            label="Encerramento"
            value={formatDateBR(detail.data_encerramento_proposta, true)}
          />
        </dl>

        <div className="mt-4 flex flex-wrap gap-4">
          {detail.link_sistema_origem && (
            <a
              href={detail.link_sistema_origem}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm text-blue-600 hover:underline"
            >
              Abrir no sistema de origem
            </a>
          )}
          {pncpUrl && (
            <a
              href={pncpUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm text-blue-600 hover:underline"
            >
              Ver no PNCP
            </a>
          )}
        </div>
      </section>

      {detail.informacao_complementar && (
        <section>
          <h2 className="mb-2 text-sm font-semibold text-gray-900">
            Informação complementar
          </h2>
          <p className="whitespace-pre-wrap text-sm text-gray-900">
            {detail.informacao_complementar}
          </p>
        </section>
      )}

      <section>
        <h2 className="mb-3 text-sm font-semibold text-gray-900">Itens</h2>
        <ItensTable itens={itens} />
      </section>

      <section>
        <h2 className="mb-3 text-sm font-semibold text-gray-900">
          Documentos
        </h2>
        <DocumentosList documentos={documentos} />
      </section>
    </div>
  );
}

function BackLink() {
  return (
    <Link href="/" className="text-sm text-blue-600 hover:underline">
      ← Voltar
    </Link>
  );
}

function Field({
  label,
  value,
}: {
  label: string;
  value: string | null | undefined;
}) {
  return (
    <div>
      <dt className="text-xs text-gray-500">{label}</dt>
      <dd className="text-sm text-gray-900">{value || "—"}</dd>
    </div>
  );
}
