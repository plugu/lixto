# STATE — rewrite after every ticket completes; never append. ≤30 lines total.

## Now
- Idle. Cycle 9 (responsive layout, mvp) SHIPPED: tickets 41–46 done, approved as-is at gate 2/2.

## Next
- Nothing queued. Candidate future cycle: Attio restyle + palette widget (tickets 39–40, superseded PRODUCT, still on disk).

## Decisions
- Gate 2/2: approved as-is, incl. global 40px button height (ui/button.tsx md h-9→h-10).
- INFRA (keep for future runs): symlinked node_modules breaks Turbopack in git worktrees — use real APFS clones (`cp -Rc`).
- Card reflow pattern: table `hidden md:block` + cards `md:hidden`, same data array.

## Blockers
- none
