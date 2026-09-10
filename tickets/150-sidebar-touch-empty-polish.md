---
id: 150
status: done
model: sonnet
depends_on: [149]
max_attempts: 3
files:
  - web/components/sidebar.tsx
  - web/components/ui/top-bar.tsx
  - web/components/ui/button.tsx
  - web/components/ui/badge.tsx
  - web/components/ui/empty-state.tsx
  - web/components/opportunity-card.tsx
  - web/components/radar-card.tsx
  - web/components/ui/popover.tsx
---
## Goal
Visual polish that the fluidity work exposes: clear active-route indicator, 44 px touch targets on mobile, reason chips readable on touch, and empty states that stop pushing pagination off-screen.

## Context
Sidebar active item is only a `bg-surface-raised` tint. `Button` sizes are `sm h-[30px]` / `md h-10`; `Badge`/reason chips are `h-6`; chips explain themselves only via `title=` (hover-only). `EmptyState` is `min-h-[40vh]`.

Work:
1. `sidebar.tsx` `NavLink`: active gets a 2 px `bg-accent` bar on the left (`before:` pseudo, `rounded-full`, `h-4`) and `text-ink font-semibold`; collapsed mode shows the bar too. `aria-current="page"` on the active link. Mobile drawer in `top-bar.tsx`: items `h-11`, add `aria-current`.
2. `button.tsx`: keep desktop sizes but add `min-h-11 md:min-h-0` to `sm` and `md` so touch targets are ≥44 px below `md` (`PillTabs` already sized in 143 — leave it). `badge.tsx`: add `size="md"` (`h-7 px-3`) variant; cards use it below `md`.
3. `popover.tsx`: add `hover` prop → on desktop opens on hover/focus with 150 ms delay; cards' `ReasonChip` wrap the chip in `Popover` with the `reason.detail` text (max-w-xs, `text-[13px]`), so touch users tap to read; remove `title=`.
4. `empty-state.tsx`: `min-h-[40vh]` → `py-10`, `min-h-0`; keep centring.
5. Keyboard focus: every interactive element in these files gets the existing `focus-visible:ring-[3px] ring-accent-soft` treatment.

## Checks (run in order — cheapest first)
1. `cd web && npm run lint`
2. `cd web && npm run build`
3. `cd web && npm test`
4. `cd web && ! grep -n 'title={reason.detail}' components/opportunity-card.tsx components/radar-card.tsx`

## Done when
- Active sidebar item has an accent bar; on a 390 px viewport every button/chip is ≥44 px tall; tapping a reason chip shows its detail; empty Radar view shows pagination without scrolling.

## Not included
- New icons, sidebar grouping changes, bottom navigation.
