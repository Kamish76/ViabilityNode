# ViabilityNode Roadmap Sync Rule

At the start of **any task involving the ViabilityNode project**, you MUST:

1. Read `ROADMAP.md` (at the ViabilityNode project root) in full.
2. Scan the key implementation files listed in the roadmap's "Key Files to Check" table:
   - `src/app/DashboardClient.tsx`
   - `src/app/page.tsx`
   - `supabase/migrations/` (list files and read relevant ones)
   - `src/lib/` (list any utility helpers)
3. For each roadmap item, verify whether it is implemented in the actual code:
   - `[ ]` → confirm it is genuinely missing
   - `[/]` → confirm it is partially present; note what remains
   - `[x]` → confirm the feature is fully working
4. Update `ROADMAP.md` checkboxes to reflect the true current state before doing any new work.
5. When implementing a roadmap feature, always follow the **Implementation Order (Strict Dependencies)** section — never skip ahead of an unmet dependency.
6. After completing any roadmap item, mark it `[x]` in `ROADMAP.md` immediately.
