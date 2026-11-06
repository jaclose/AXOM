import { neon } from "@neondatabase/serverless";

type SqlClient = ReturnType<typeof neon>;

let sqlClient: SqlClient | null = null;
let schemaReady: Promise<void> | null = null;

export function hasDatabase() {
  return Boolean(process.env.DATABASE_URL);
}

export function getSql() {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is not configured.");
  }
  if (!sqlClient) sqlClient = neon(process.env.DATABASE_URL);
  return sqlClient;
}

export async function getReadySql() {
  const sql = getSql();
  if ((process.env.AXOM_AUTO_MIGRATE ?? process.env.NOCTYRIUM_AUTO_MIGRATE) !== "false") {
    if (!schemaReady) schemaReady = ensureSchema(sql);
    await schemaReady;
  }
  return sql;
}

async function ensureSchema(sql: SqlClient) {
  await sql`CREATE EXTENSION IF NOT EXISTS pgcrypto`;

  await sql`
    CREATE TABLE IF NOT EXISTS users (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      display_name text NOT NULL CHECK (char_length(display_name) BETWEEN 1 AND 80),
      normalized_name text NOT NULL UNIQUE CHECK (char_length(normalized_name) BETWEEN 1 AND 80),
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      last_login_at timestamptz NOT NULL DEFAULT now()
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS user_data_snapshots (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      app_version text NOT NULL DEFAULT 'unknown',
      schema_version integer NOT NULL DEFAULT 13,
      data_json jsonb NOT NULL,
      device_label text,
      backup_label text,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    )
  `;

  await sql`
    CREATE UNIQUE INDEX IF NOT EXISTS user_data_snapshots_current_idx
    ON user_data_snapshots(user_id)
    WHERE backup_label IS NULL
  `;

  await sql`
    CREATE INDEX IF NOT EXISTS user_data_snapshots_backups_idx
    ON user_data_snapshots(user_id, created_at DESC)
    WHERE backup_label IS NOT NULL
  `;

  // PIN auth columns (002_pin_auth.sql) — kept in lockstep with migrations.
  await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS pin_hash text`;
  await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS pin_salt text`;
  await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS pin_iterations integer NOT NULL DEFAULT 210000`;
  await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS failed_login_count integer NOT NULL DEFAULT 0`;
  await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS locked_until timestamptz`;

  await sql`
    CREATE TABLE IF NOT EXISTS user_sessions (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token_hash text NOT NULL UNIQUE,
      device_label text,
      created_at timestamptz NOT NULL DEFAULT now(),
      last_seen_at timestamptz NOT NULL DEFAULT now(),
      expires_at timestamptz NOT NULL
    )
  `;

  await sql`
    CREATE INDEX IF NOT EXISTS user_sessions_user_idx
    ON user_sessions(user_id, expires_at DESC)
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS sync_change_log (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      change_type text NOT NULL,
      entity_type text,
      entity_id text,
      patch_json jsonb,
      created_at timestamptz NOT NULL DEFAULT now(),
      source_device text
    )
  `;

  await sql`
    CREATE INDEX IF NOT EXISTS sync_change_log_user_created_idx
    ON sync_change_log(user_id, created_at DESC)
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS ai_usage_logs (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id uuid REFERENCES users(id) ON DELETE SET NULL,
      feature text NOT NULL,
      input_summary text,
      output_summary text,
      token_estimate integer,
      created_at timestamptz NOT NULL DEFAULT now()
    )
  `;

  await sql`
    CREATE INDEX IF NOT EXISTS ai_usage_logs_user_created_idx
    ON ai_usage_logs(user_id, created_at DESC)
  `;
}
