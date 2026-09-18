import { Sidebar } from "@/components/sidebar";
import { TopBar } from "@/components/ui/top-bar";
import { getSession } from "@/lib/auth";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Sidebar chrome only exists for logged-in users; /login & friends render
  // the bare card. Cookie -> DB lookup happens once here, per request.
  const session = await getSession();

  const sidebarSession = session
    ? {
        name: session.user.name,
        company: session.company.tradeName ?? session.company.legalName,
        role: session.user.role,
        isSuperadmin: session.user.isSuperadmin,
      }
    : null;

  return (
    <div className="flex h-full min-h-screen flex-col md:flex-row">
      <TopBar session={sidebarSession} />
      <Sidebar session={sidebarSession} />
      <main className="relative z-[1] min-w-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-5xl px-4 py-6 sm:px-6 md:px-8 md:py-10 has-[.page-wide]:max-w-screen-2xl">
          {children}
        </div>
      </main>
    </div>
  );
}
