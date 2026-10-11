import type { PGlite } from "@electric-sql/pglite";
/** Supabase Storage metadata boundary for database-policy tests only.
 * This is not the Storage HTTP service and does not establish live upload success. */
export async function installStorageTestSchema(db: PGlite): Promise<void> {
  await db.exec(`
    create schema storage;
    grant usage on schema storage to anon, authenticated, service_role;
    create table storage.buckets(id text primary key, name text not null, public boolean not null default false, file_size_limit bigint, allowed_mime_types text[]);
    create table storage.objects(id uuid primary key default gen_random_uuid(), bucket_id text not null references storage.buckets(id), name text not null, metadata jsonb, unique(bucket_id,name));
    alter table storage.objects enable row level security;
    grant select,insert,update,delete on storage.objects to anon,authenticated,service_role;
    grant all on storage.buckets to service_role;
  `);
}
