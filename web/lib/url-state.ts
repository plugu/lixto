// Shared literal-value arrays + defaults for every pill-tab group backed by
// `nuqs` (ticket 143). One source of truth for `PillTabs` (client) and the
// server-page `parse*` functions (`parseChartScope` in stats-queries.ts,
// `parseOpportunityView` below, `parseRadarFilters` in
// radar-list-queries.ts) so the set of accepted URL values never drifts
// between the client pill and the server parser.
//
// Relative-import friendly: no imports here, so this file is safe to import
// from both "@/lib/..." (pages) and relative paths (other lib modules whose
// tests run without the tsconfig alias).

export const CHART_SCOPES = ["open", "upcoming", "all"] as const;
export type ChartScopeValue = (typeof CHART_SCOPES)[number];
export const CHART_SCOPE_DEFAULT: ChartScopeValue = "open";

export const OPPORTUNITY_VIEWS = ["attention", "all", "dismissed"] as const;
export type OpportunityViewValue = (typeof OPPORTUNITY_VIEWS)[number];
export const OPPORTUNITY_VIEW_DEFAULT: OpportunityViewValue = "attention";

export const RADAR_VIEWS = ["all", "saved", "ignored"] as const;
export type RadarViewValue = (typeof RADAR_VIEWS)[number];
export const RADAR_VIEW_DEFAULT: RadarViewValue = "all";

/** Parses the opportunities page `?view=` param. Unknown/invalid values
 * (including array-valued, from Next's searchParams) fall back to the
 * default `"attention"` rather than throwing. */
export function parseOpportunityView(
  raw: string | string[] | undefined,
): OpportunityViewValue {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return (OPPORTUNITY_VIEWS as readonly string[]).includes(value ?? "")
    ? (value as OpportunityViewValue)
    : OPPORTUNITY_VIEW_DEFAULT;
}
