import Link from "next/link";

export function Sidebar() {
  return (
    <aside className="flex w-[240px] shrink-0 flex-col border-r border-gray-200 bg-gray-50">
      <div className="px-6 py-6">
        <span className="text-lg font-semibold text-gray-900">
          Plataforma Licitante
        </span>
      </div>
      <nav className="flex flex-col gap-1 px-3">
        <Link
          href="/"
          className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-blue-600"
        >
          Licitações
        </Link>
      </nav>
    </aside>
  );
}
