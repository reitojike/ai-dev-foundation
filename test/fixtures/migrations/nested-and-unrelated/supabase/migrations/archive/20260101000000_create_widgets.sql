-- Same version prefix as the top-level migration on purpose: this file lives
-- in a nested subdirectory that Supabase's own migration loader does not
-- recurse into, so it must not be treated as a colliding migration.
create table widgets (
  id uuid primary key default gen_random_uuid()
);
