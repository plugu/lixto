// Platform-wide top-7 portal allowlist. Every list, count, chart and filter
// option considers only procurements published through one of these
// `origin_system` systems. Other rows stay in the DB and keep syncing
// (ingestion is untouched) — they're simply invisible in the UI.
export const ACTIVE_PORTALS: string[] = [
  "Compras.gov.br",
  "ECustomize Consultoria em Software S.A",
  "IPM Sistemas",
  "Betha Sistemas",
  "Governançabrasil Tecnologia e Gestão em Serviços",
  "BLL Compras",
  "Megasoft Informática",
];
