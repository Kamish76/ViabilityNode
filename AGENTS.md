<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

<!-- BEGIN:supabase-remote-only-rules -->
# Supabase: Remote-Only Workflow (No Docker)

- **Environment Constraint**: The user DOES NOT use Docker.
- **Restricted Commands**: Never run or recommend Supabase CLI commands that require a local Docker daemon (e.g., `supabase start`, `supabase status`, `supabase db pull`, `supabase db push`, `supabase migration *`).
- **Preferred Workflow**: For database schema changes, rely exclusively on the remote-only workflow. Use the Supabase Dashboard SQL Editor, a direct Postgres connection via `DATABASE_URL`, or ORM migrations (like Prisma/Drizzle) that do not require shadow databases.
- **Allowed CLI Commands**: You may still use Docker-independent CLI commands (e.g., `supabase login`, `supabase link`, `supabase gen types`).
<!-- END:supabase-remote-only-rules -->
