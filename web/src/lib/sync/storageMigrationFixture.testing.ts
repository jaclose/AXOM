import type { PGlite } from "@electric-sql/pglite";

/**
 * Supabase installs Storage independently of application migrations. Model only
 * its columns and grants used by our migrations; never run this against a live
 * project. Object policies still come from the actual application SQL.
 */
export async function installStorageMigrationFixture(db: PGlite): Promise<void> {
  await db.exec(`
    create schema storage;
    create table storage.buckets (
      id text primary key,
      name text not null,
      public boolean not null default false,
      file_size_limit bigint,
      allowed_mime_types text[]
    );
    create table storage.objects (
      id uuid primary key default gen_random_uuid(),
      bucket_id text references storage.buckets(id),
      name text not null,
      metadata jsonb,
      unique (bucket_id, name)
    );
    alter table storage.objects enable row level security;
    grant usage on schema storage to anon, authenticated, service_role;
    grant select, insert, update, delete on storage.objects to anon, authenticated;
    grant all on storage.objects, storage.buckets to service_role;
  `);
}
