// Platform-wide top-7 portal allowlist (ticket 10). Every list, count, chart
// and filter option considers only licitações published through one of
// these `usuario_nome` systems. Other rows stay in the DB and keep syncing
// (ingestion is untouched) — they're simply invisible in the UI.
export const PORTAIS_ATIVOS: string[] = [
  "Compras.gov.br",
  "ECustomize Consultoria em Software S.A",
  "IPM Sistemas",
  "Betha Sistemas",
  "Governançabrasil Tecnologia e Gestão em Serviços",
  "BLL Compras",
  "Megasoft Informática",
];
