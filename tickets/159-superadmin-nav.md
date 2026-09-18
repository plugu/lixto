---
id: 159
status: done
model: haiku
depends_on: [157, 158]
max_attempts: 4
files:
  - web/components/sidebar.tsx
  - web/components/ui/top-bar.tsx
  - web/components/ui/command-search.tsx
  - web/app/(app)/layout.tsx
---
## Goal
Superadmins see an "Administração" group with "Empresas" (`/admin/companies`) in the sidebar, the mobile top bar and the ⌘K palette; nobody else does.

## Context
`app/(app)/layout.tsx` builds `sidebarSession { name, company, role }` from `getSession()` and passes it to `TopBar` and `Sidebar`. `components/sidebar.tsx` exports `SidebarSession`, `NAV_ITEMS`, `COMPANY_ITEMS`, `COMPANY_ADMIN_ITEMS` and renders `COMPANY_ADMIN_ITEMS` only when `session.role === "admin"`; `isActive(pathname, href)` decides highlighting. `ui/top-bar.tsx` repeats the role check for the mobile menu; `ui/command-search.tsx:CommandPalette({ role })` adds `COMPANY_ADMIN_ITEMS` for admins. `Session.user.isSuperadmin` exists since 157. Icons come from `components/ui/icons.tsx`; pick an existing one (e.g. `Shield` if present, else `Users`).

Work:
1. `SidebarSession` gains `isSuperadmin: boolean`; layout passes `session.user.isSuperadmin`.
2. `export const SUPERADMIN_ITEMS = [{ href: "/admin/companies", label: "Empresas", icon: ... }] as const`. Sidebar: after the company group, when `session.isSuperadmin`, render a divider/eyebrow "Administração" (same markup as "Empresa") and the items. `isActive`: `/admin/companies` matches itself and `/admin/companies/*`.
3. Top bar: same conditional group in the mobile menu.
4. `CommandPalette` takes `isSuperadmin: boolean` (in addition to `role`) and appends `SUPERADMIN_ITEMS` to its nav commands when true; sidebar passes it.

## Checks (run in order — cheapest first)
1. `cd web && npm run lint`
2. `cd web && npm run build`
3. `cd web && docker compose -f /Users/aazevedo/dev/plataforma-licitante/docker-compose.yml exec -T db psql -U lixto -d lixto -Atc "UPDATE users SET is_superadmin=true WHERE id=(SELECT user_id FROM sessions WHERE token_hash=encode(sha256('devprobe'::bytea),'hex'))" >/dev/null && curl -s -b lixto_session=devprobe localhost:3000/dashboard | grep -q 'Administração' && docker compose -f /Users/aazevedo/dev/plataforma-licitante/docker-compose.yml exec -T db psql -U lixto -d lixto -Atc "UPDATE users SET is_superadmin=false WHERE id=(SELECT user_id FROM sessions WHERE token_hash=encode(sha256('devprobe'::bytea),'hex'))" >/dev/null && ! curl -s -b lixto_session=devprobe localhost:3000/dashboard | grep -q 'Administração'`

## Done when
- The Administração → Empresas entry renders (desktop, mobile, ⌘K) only for a superadmin and is highlighted on `/admin/companies`.

## Not included
- A pending-count badge in the sidebar; any page content.
