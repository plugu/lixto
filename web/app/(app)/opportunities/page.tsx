// Company opportunities, by state/score (ticket 93). The digest banner sits
// on top of every tab — it always reflects the last global match run,
// independent of which slice the user is looking at.
import type { Metadata } from "next";
import { DigestBanner } from "@/components/digest-banner";
import { OpportunityCard } from "@/components/opportunity-card";
import { EmptyState } from "@/components/ui/empty-state";
import { PillTabs } from "@/components/ui/pill-tabs";
import { requireSession } from "@/lib/auth";
import { getDigest } from "@/lib/digest-queries";
import {
  ATTENTION_SCORE,
  listOpportunities,
  type OpportunityRow,
} from "@/lib/opportunity-queries";
import {
  OPPORTUNITY_VIEW_DEFAULT,
  parseOpportunityView,
  type OpportunityViewValue,
} from "@/lib/url-state";

export const metadata: Metadata = { title: "Oportunidades" };
export const dynamic = "force-dynamic";

type View = OpportunityViewValue;

const TABS: { value: View; label: string }[] = [
  { value: "attention", label: "Atenção" },
  { value: "all", label: "Todas" },
  { value: "dismissed", label: "Descartadas" },
];

const EMPTY_COPY: Record<View, string> = {
  attention: "Nenhuma oportunidade merece atenção agora.",
  all: "Nenhuma oportunidade encontrada ainda.",
  dismissed: "Nenhuma oportunidade descartada.",
};

const LIST_LIMIT = 50;

async function fetchList(companyId: number, view: View): Promise<OpportunityRow[]> {
  if (view === "dismissed") {
    return listOpportunities(companyId, { states: ["dismissed"], limit: LIST_LIMIT });
  }
  if (view === "attention") {
    return listOpportunities(companyId, {
      states: ["matched", "recommended"],
      minScore: ATTENTION_SCORE,
      limit: LIST_LIMIT,
    });
  }
  return listOpportunities(companyId, { limit: LIST_LIMIT });
}

export default async function OpportunitiesPage({
  searchParams,
}: PageProps<"/opportunities">) {
  const session = await requireSession();
  const resolved = await searchParams;
  const view = parseOpportunityView(resolved.view);

  const [digest, opportunities] = await Promise.all([
    getDigest(session.user.companyId),
    fetchList(session.user.companyId, view),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <h1 className="font-display text-[30px] leading-[34px] text-ink">
        Oportunidades
      </h1>

      <DigestBanner digest={digest} showLink={false} />

      <PillTabs
        param="view"
        options={TABS}
        defaultValue={OPPORTUNITY_VIEW_DEFAULT}
        ariaLabel="Filtrar oportunidades"
      />

      {opportunities.length === 0 ? (
        <EmptyState title={EMPTY_COPY[view]} />
      ) : (
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          {opportunities.map((opportunity) => (
            <OpportunityCard key={opportunity.id} opportunity={opportunity} />
          ))}
        </div>
      )}
    </div>
  );
}
