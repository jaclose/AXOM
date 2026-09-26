# Legacy migrations (not for Supabase)

`001_initial.sql` and `002_pin_auth.sql` belong to the retired name/PIN cloud
backend used by the old Vercel API routes. They create tables **without
row-level security** and must never be applied to the Supabase project.

The accounts schema now lives in `supabase/migrations/` (Supabase CLI and
GitHub integration working directory: the repository root, `.`).
