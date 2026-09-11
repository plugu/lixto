// Shared header for the two halves of "Radar": open tenders that already
// match the company (/opportunities) and future ones predicted from annual
// procurement plans (/radar). One nav item, one title, a route tab per half.
// Both routes keep their URLs (digest links, /radar/[id] deep links), so the
// tabs are plain links rather than a query param.
import Link from "next/link";

export type RadarTab = "open" | "future";

export const RADAR_TABS: {
  value: RadarTab;
  href: string;
  label: string;
  description: string;
}[] = [
  {
    value: "open",
    href: "/opportunities",
    label: "Abertas",
    description: "Licitações publicadas que combinam com o perfil da empresa.",
  },
  {
    value: "future",
    href: "/radar",
    label: "Futuras",
    description:
      "Compras previstas nos planos anuais dos órgãos, antes do edital.",
  },
];

export function RadarHeader({ active }: { active: RadarTab }) {
  const current = RADAR_TABS.find((tab) => tab.value === active);
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h1 className="font-display text-[30px] leading-[34px] text-ink">
          Radar
        </h1>
        {current ? (
          <p className="text-[13px] text-ink-muted">{current.description}</p>
        ) : null}
      </div>
      <nav
        aria-label="Tipo de oportunidade"
        className="flex items-center gap-6 border-b border-line"
      >
        {RADAR_TABS.map((tab) => {
          const isActive = tab.value === active;
          return (
            <Link
              key={tab.value}
              href={tab.href}
              aria-current={isActive ? "page" : undefined}
              className={`-mb-px border-b-2 pb-2 text-[14px] font-medium transition-colors ${
                isActive
                  ? "border-ink text-ink"
                  : "border-transparent text-ink-muted hover:text-ink"
              }`}
            >
              {tab.label}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
