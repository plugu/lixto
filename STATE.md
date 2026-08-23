# STATE — rewrite after every ticket completes; never append. ≤30 lines total.

## Now
idle — ticket 38 (prototype: revert layout fonts to system default) done, attempt 1/2. Checks green: grep-absence, eslint (scoped), next build.

## Next
commit ticket-38 changes on main → cycle-8 redesign (tickets 30–37, spec in git at `54c9555`) whenever resumed — note its token sheet must assume system sans, not Hanken/Bricolage.

## Decisions
- execution: sequential (single ticket)
- fonts: no `next/font`; `--font-sans` and `--font-display` both = `ui-sans-serif, system-ui, sans-serif`; `font-display` utility kept, remapped
- repo-wide `npm run lint` still red on pre-existing multi-select.tsx / db.ts errors — lint checks scoped per-file

## Blockers
- none
