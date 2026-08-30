import { createClient } from '@supabase/supabase-js';

// ── Client architecture overview ──────────────────────────────────────────
//
//  utils/supabase/client.ts     → Browser Client Components (@supabase/ssr)
//  utils/supabase/server.ts     → Server Components & Route Handlers (@supabase/ssr)
//  utils/supabase/middleware.ts → middleware.ts session refresh (@supabase/ssr)
//  lib/supabase.ts (this file)  → Server-only API routes that need the service role key
//
// The @supabase/ssr helpers use NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY and handle
// cookie-based session management automatically.
// The admin client below bypasses RLS — keep it server-side only.

// ── Public client (uses publishable key — browser-safe) ───────────────────
export const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!
);

// ── Server-only admin client (uses service-role key — NEVER expose to browser)
export const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);
