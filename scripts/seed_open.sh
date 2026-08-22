#!/usr/bin/env bash
# seed_open.sh — copy only open/future licitacoes (and dependent rows) from
# one Postgres instance to another, so a freshly provisioned DB starts with
# ~14k relevant rows instead of a full 600k+ backfill.
#
# Usage:
#   SRC_URL=postgresql://... DST_URL=postgresql://... scripts/seed_open.sh [--dry-run]
#
# Env:
#   SRC_URL   source Postgres connection URL (required)
#   DST_URL   destination Postgres connection URL (required)
#   PSQL      psql invocation to use (default: "psql"). Override when no local
#             psql binary is available, e.g.:
#               PSQL="docker compose exec -T db psql"
#
# --dry-run prints per-table row counts on SRC (that would be copied) and exits.
set -euo pipefail

PSQL="${PSQL:-psql}"

PREDICATE="data_encerramento_proposta >= now() OR data_abertura_proposta > now()"
DEPENDENT_WHERE="numero_controle_pncp IN (SELECT numero_controle_pncp FROM licitacao WHERE ${PREDICATE})"

# licitacao has a GENERATED ALWAYS ... STORED column ("portal", added by a
# later migration) that SELECT * includes but COPY ... FROM STDIN (without an
# explicit column list) rejects. List real columns explicitly for this table
# so the copy round-trips regardless of generated columns.
LICITACAO_COLUMNS="numero_controle_pncp, ano_compra, sequencial_compra, numero_compra, processo, orgao_cnpj, orgao_razao_social, poder_id, esfera_id, unidade_codigo, unidade_nome, uf, municipio_nome, codigo_ibge, modalidade_id, modalidade_nome, modo_disputa_id, modo_disputa_nome, situacao_compra_id, situacao_compra_nome, tipo_instrumento_convocatorio_codigo, tipo_instrumento_convocatorio_nome, amparo_legal_codigo, amparo_legal_nome, objeto_compra, informacao_complementar, srp, valor_total_estimado, valor_total_homologado, data_abertura_proposta, data_encerramento_proposta, data_publicacao_pncp, data_inclusao, data_atualizacao, data_atualizacao_global, link_sistema_origem, link_processo_eletronico, fontes_orcamentarias, usuario_nome, raw, itens_sincronizados_em, arquivos_sincronizados_em, created_at, updated_at, setor, setor_classificado_em"

DRY_RUN=0
if [[ "${1:-}" == "--dry-run" ]]; then
    DRY_RUN=1
fi

: "${SRC_URL:?SRC_URL env var is required}"
: "${DST_URL:?DST_URL env var is required}"

if [[ "$DRY_RUN" -eq 1 ]]; then
    echo "Row counts on SRC (open/future licitacoes + dependents):"
    $PSQL "$SRC_URL" -tc "SELECT 'licitacao: ' || count(*) FROM licitacao WHERE ${PREDICATE}"
    $PSQL "$SRC_URL" -tc "SELECT 'item: ' || count(*) FROM item WHERE ${DEPENDENT_WHERE}"
    $PSQL "$SRC_URL" -tc "SELECT 'documento: ' || count(*) FROM documento WHERE ${DEPENDENT_WHERE}"
    $PSQL "$SRC_URL" -tc "SELECT 'analise: ' || count(*) FROM analise WHERE ${DEPENDENT_WHERE}"
    $PSQL "$SRC_URL" -tc "SELECT 'sync_state: ' || count(*) FROM sync_state"
    exit 0
fi

migrations_applied=$($PSQL "$DST_URL" -tAc "SELECT count(*) FROM schema_migrations")
if [[ "$migrations_applied" -ne 6 ]]; then
    echo "run \`plic db init\` against DST first" >&2
    exit 2
fi

dst_licitacao_count=$($PSQL "$DST_URL" -tAc "SELECT count(*) FROM licitacao")
if [[ "$dst_licitacao_count" -ne 0 ]]; then
    echo "DST not empty; refusing to seed" >&2
    exit 3
fi

echo "Seeding DST from SRC (open/future licitacoes + dependents)..." >&2

# Build one combined script for DST: a single transaction containing a
# COPY ... FROM STDIN block per table, each block's data streamed live from
# SRC via a separate psql invocation. psql (run with -f -) echoes a "COPY n"
# result line per block, which we parse below for the final report.
output=$(
    {
        echo "BEGIN;"

        echo "COPY licitacao (${LICITACAO_COLUMNS}) FROM STDIN;"
        $PSQL "$SRC_URL" -c "\copy (SELECT ${LICITACAO_COLUMNS} FROM licitacao WHERE ${PREDICATE}) TO STDOUT"
        echo '\.'

        echo "COPY item FROM STDIN;"
        $PSQL "$SRC_URL" -c "\copy (SELECT * FROM item WHERE ${DEPENDENT_WHERE}) TO STDOUT"
        echo '\.'

        echo "COPY documento FROM STDIN;"
        $PSQL "$SRC_URL" -c "\copy (SELECT * FROM documento WHERE ${DEPENDENT_WHERE}) TO STDOUT"
        echo '\.'

        echo "COPY analise FROM STDIN;"
        $PSQL "$SRC_URL" -c "\copy (SELECT * FROM analise WHERE ${DEPENDENT_WHERE}) TO STDOUT"
        echo '\.'

        echo "COPY sync_state FROM STDIN;"
        $PSQL "$SRC_URL" -c "\copy (SELECT * FROM sync_state) TO STDOUT"
        echo '\.'

        echo "COMMIT;"
    } | $PSQL "$DST_URL" -f -
)

echo "$output" >&2

tables=(licitacao item documento analise sync_state)
counts=$(echo "$output" | grep -E '^COPY [0-9]+$' | awk '{print $2}')

echo "Rows copied:"
i=0
while IFS= read -r n; do
    echo "  ${tables[$i]}: ${n}"
    i=$((i + 1))
done <<<"$counts"
