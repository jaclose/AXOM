import { ApiError } from "./http.js";
import { getReadySql, hasDatabase } from "./db.js";
import { createHash, pbkdf2Sync, randomBytes, timingSafeEqual } from "node:crypto";

type DbRow = Record<string, unknown>;

export interface SaveSnapshotInput {
  appVersion: string;
  schemaVersion: number;
  dataJson: Record<string, unknown>;
  deviceLabel?: string;
  backupLabel?: string;
}

export interface PinAccountInput {
  username: string;
  pin: string;
  deviceLabel?: string;
}

const PIN_ITERATIONS = 210_000;
const SESSION_DAYS = 30;

export function normalizeName(name: string) {
  return name.trim().replace(/\s+/g, " ").toLowerCase();
}

export async function loginByName(name: string) {
  ensureDb();
  const displayName = name.trim().replace(/\s+/g, " ");
  const normalizedName = normalizeName(displayName);
  if (!normalizedName) throw new ApiError(400, "Name is required.");
  if (displayName.length > 80) throw new ApiError(400, "Name is too long.");

  const sql = await getReadySql();
  const rows = (await sql`
    INSERT INTO users (display_name, normalized_name, last_login_at, updated_at)
    VALUES (${displayName}, ${normalizedName}, now(), now())
    ON CONFLICT (normalized_name)
    DO UPDATE SET
      display_name = EXCLUDED.display_name,
      last_login_at = now(),
      updated_at = now()
    RETURNING id, display_name, normalized_name, created_at, updated_at, last_login_at
  `) as DbRow[];
  return mapUser(rows[0]);
}

export async function createPinAccount(input: PinAccountInput) {
  ensureDb();
  const displayName = normalizeDisplayName(input.username);
  const normalizedName = normalizeName(displayName);
  validatePin(input.pin);
  const sql = await getReadySql();
  const existing = (await sql`
    SELECT id, pin_hash
    FROM users
    WHERE normalized_name = ${normalizedName}
    LIMIT 1
  `) as DbRow[];
  if (existing[0]?.pin_hash) throw new ApiError(409, "This username already has a PIN. Log in instead.");
  const secret = hashPin(input.pin);
  const rows = (await sql`
    INSERT INTO users (
      display_name, normalized_name, pin_hash, pin_salt, pin_iterations,
      failed_login_count, locked_until, last_login_at, updated_at
    )
    VALUES (
      ${displayName}, ${normalizedName}, ${secret.hash}, ${secret.salt}, ${secret.iterations},
      0, NULL, now(), now()
    )
    ON CONFLICT (normalized_name)
    DO UPDATE SET
      display_name = EXCLUDED.display_name,
      pin_hash = COALESCE(users.pin_hash, EXCLUDED.pin_hash),
      pin_salt = COALESCE(users.pin_salt, EXCLUDED.pin_salt),
      pin_iterations = COALESCE(users.pin_iterations, EXCLUDED.pin_iterations),
      updated_at = now()
    RETURNING id, display_name, normalized_name, created_at, updated_at, last_login_at, failed_login_count, locked_until
  `) as DbRow[];
  const session = await createSession(String(rows[0].id), input.deviceLabel);
  await logChange(String(rows[0].id), "create_pin_account", "user", String(rows[0].id), {
    auth: "pin",
    deviceLabel: input.deviceLabel,
  }, input.deviceLabel);
  return { user: mapUser(rows[0]), session };
}

export async function loginByPin(input: PinAccountInput) {
  ensureDb();
  const displayName = normalizeDisplayName(input.username);
  const normalizedName = normalizeName(displayName);
  validatePin(input.pin);
  const sql = await getReadySql();
  const rows = (await sql`
    SELECT id, display_name, normalized_name, pin_hash, pin_salt, pin_iterations,
      failed_login_count, locked_until, created_at, updated_at, last_login_at
    FROM users
    WHERE normalized_name = ${normalizedName}
    LIMIT 1
  `) as DbRow[];
  const row = rows[0];
  if (!row || !row.pin_hash || !row.pin_salt) throw new ApiError(401, "Invalid username or PIN.");
  if (row.locked_until && new Date(String(row.locked_until)).getTime() > Date.now()) {
    throw new ApiError(423, "Account is temporarily locked after repeated failed attempts.");
  }
  const ok = verifyPin(input.pin, String(row.pin_salt), Number(row.pin_iterations ?? PIN_ITERATIONS), String(row.pin_hash));
  if (!ok) {
    const failed = Number(row.failed_login_count ?? 0) + 1;
    const lockMinutes = failed >= 5 ? Math.min(30, 2 ** Math.min(failed - 5, 4)) : 0;
    const lockedUntil = lockMinutes ? new Date(Date.now() + lockMinutes * 60_000).toISOString() : null;
    await sql`
      UPDATE users
      SET failed_login_count = ${failed},
          locked_until = ${lockedUntil},
          updated_at = now()
      WHERE id = ${String(row.id)}
    `;
    throw new ApiError(failed >= 5 ? 423 : 401, failed >= 5 ? "Too many failed attempts. Try again later." : "Invalid username or PIN.");
  }
  const updated = (await sql`
    UPDATE users
    SET failed_login_count = 0, locked_until = NULL, last_login_at = now(), updated_at = now()
    WHERE id = ${String(row.id)}
    RETURNING id, display_name, normalized_name, created_at, updated_at, last_login_at, failed_login_count, locked_until
  `) as DbRow[];
  const session = await createSession(String(row.id), input.deviceLabel);
  return { user: mapUser(updated[0]), session };
}

export async function logoutSession(token: string) {
  ensureDb();
  if (!token.trim()) return;
  const sql = await getReadySql();
  await sql`DELETE FROM user_sessions WHERE token_hash = ${sessionHash(token)}`;
}

export async function getUser(id: string) {
  ensureDb();
  const sql = await getReadySql();
  const rows = (await sql`
    SELECT id, display_name, normalized_name, pin_hash, locked_until, created_at, updated_at, last_login_at
    FROM users
    WHERE id = ${id}
    LIMIT 1
  `) as DbRow[];
  if (!rows[0]) throw new ApiError(404, "User not found.");
  return mapUser(rows[0]);
}

export async function getLatestSnapshot(userId: string) {
  ensureDb();
  await getUser(userId);
  const sql = await getReadySql();
  const rows = (await sql`
    SELECT id, user_id, app_version, schema_version, data_json, device_label, backup_label, created_at, updated_at
    FROM user_data_snapshots
    WHERE user_id = ${userId} AND backup_label IS NULL
    ORDER BY updated_at DESC
    LIMIT 1
  `) as DbRow[];
  return rows[0] ? mapSnapshot(rows[0]) : null;
}

export async function saveCurrentSnapshot(userId: string, input: SaveSnapshotInput) {
  ensureDb();
  await getUser(userId);
  const sql = await getReadySql();
  const dataJson = JSON.stringify(input.dataJson);
  const rows = (await sql`
    INSERT INTO user_data_snapshots (
      user_id, app_version, schema_version, data_json, device_label, backup_label, updated_at
    )
    VALUES (
      ${userId}, ${input.appVersion}, ${input.schemaVersion}, ${dataJson}::jsonb, ${input.deviceLabel ?? null}, NULL, now()
    )
    ON CONFLICT (user_id) WHERE backup_label IS NULL
    DO UPDATE SET
      app_version = EXCLUDED.app_version,
      schema_version = EXCLUDED.schema_version,
      data_json = EXCLUDED.data_json,
      device_label = EXCLUDED.device_label,
      updated_at = now()
    RETURNING id, user_id, app_version, schema_version, data_json, device_label, backup_label, created_at, updated_at
  `) as DbRow[];
  await logChange(userId, "save_snapshot", "user_data_snapshot", String(rows[0].id), {
    appVersion: input.appVersion,
    schemaVersion: input.schemaVersion,
  }, input.deviceLabel);
  return mapSnapshot(rows[0]);
}

export async function createBackupSnapshot(userId: string, input: SaveSnapshotInput) {
  ensureDb();
  await getUser(userId);
  const sql = await getReadySql();
  const label = input.backupLabel || `Backup ${new Date().toISOString()}`;
  const dataJson = JSON.stringify(input.dataJson);
  const rows = (await sql`
    INSERT INTO user_data_snapshots (
      user_id, app_version, schema_version, data_json, device_label, backup_label
    )
    VALUES (
      ${userId}, ${input.appVersion}, ${input.schemaVersion}, ${dataJson}::jsonb, ${input.deviceLabel ?? null}, ${label}
    )
    RETURNING id, user_id, app_version, schema_version, data_json, device_label, backup_label, created_at, updated_at
  `) as DbRow[];
  await logChange(userId, "create_backup", "user_data_snapshot", String(rows[0].id), {
    backupLabel: label,
    appVersion: input.appVersion,
    schemaVersion: input.schemaVersion,
  }, input.deviceLabel);
  return mapSnapshot(rows[0]);
}

export async function listBackups(userId: string) {
  ensureDb();
  await getUser(userId);
  const sql = await getReadySql();
  const rows = (await sql`
    SELECT id, user_id, app_version, schema_version, device_label, backup_label, created_at, updated_at
    FROM user_data_snapshots
    WHERE user_id = ${userId} AND backup_label IS NOT NULL
    ORDER BY created_at DESC
    LIMIT 50
  `) as DbRow[];
  return rows.map((row) => ({
    id: String(row.id),
    userId: String(row.user_id),
    appVersion: String(row.app_version),
    schemaVersion: Number(row.schema_version),
    deviceLabel: row.device_label ? String(row.device_label) : undefined,
    backupLabel: row.backup_label ? String(row.backup_label) : undefined,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  }));
}

export async function restoreBackup(userId: string, backupId: string) {
  ensureDb();
  await getUser(userId);
  const sql = await getReadySql();
  const backups = (await sql`
    SELECT id, user_id, app_version, schema_version, data_json, device_label, backup_label, created_at, updated_at
    FROM user_data_snapshots
    WHERE user_id = ${userId} AND id = ${backupId} AND backup_label IS NOT NULL
    LIMIT 1
  `) as DbRow[];
  if (!backups[0]) throw new ApiError(404, "Backup not found.");
  const backup = mapSnapshot(backups[0]);
  const current = await saveCurrentSnapshot(userId, {
    appVersion: backup.appVersion,
    schemaVersion: backup.schemaVersion,
    dataJson: backup.dataJson,
    deviceLabel: backup.deviceLabel,
  });
  await logChange(userId, "restore_backup", "user_data_snapshot", backupId, {
    restoredToSnapshotId: current.id,
  }, backup.deviceLabel);
  return { backup, current };
}

export async function logAiUsage(input: {
  feature: string;
  inputSummary?: string;
  outputSummary?: string;
  tokenEstimate?: number;
}) {
  if (!hasDatabase()) return;
  const sql = await getReadySql();
  await sql`
    INSERT INTO ai_usage_logs (feature, input_summary, output_summary, token_estimate)
    VALUES (${input.feature}, ${input.inputSummary ?? null}, ${input.outputSummary ?? null}, ${input.tokenEstimate ?? null})
  `;
}

async function logChange(
  userId: string,
  changeType: string,
  entityType: string,
  entityId: string,
  patch: Record<string, unknown>,
  sourceDevice?: string,
) {
  const sql = await getReadySql();
  const patchJson = JSON.stringify(patch);
  await sql`
    INSERT INTO sync_change_log (user_id, change_type, entity_type, entity_id, patch_json, source_device)
    VALUES (${userId}, ${changeType}, ${entityType}, ${entityId}, ${patchJson}::jsonb, ${sourceDevice ?? null})
  `;
}

function ensureDb() {
  if (!hasDatabase()) {
    throw new ApiError(503, "DATABASE_URL is not configured. Local-first mode still works in the browser.");
  }
}

function normalizeDisplayName(name: string) {
  const displayName = name.trim().replace(/\s+/g, " ");
  if (!displayName) throw new ApiError(400, "Username is required.");
  if (displayName.length > 80) throw new ApiError(400, "Username is too long.");
  return displayName;
}

function validatePin(pin: string) {
  const clean = pin.trim();
  if (!/^\d{4,12}$/.test(clean)) throw new ApiError(400, "PIN must be 4 to 12 digits. Six digits is preferred.");
  if (clean.length < 6) {
    // Legacy compatibility only. Keep accepting 4-5 digits, but make the UI prefer six.
    return;
  }
}

function hashPin(pin: string) {
  const salt = randomBytes(16).toString("base64url");
  return {
    salt,
    iterations: PIN_ITERATIONS,
    hash: pbkdf2Sync(pin, salt, PIN_ITERATIONS, 32, "sha256").toString("base64url"),
  };
}

function verifyPin(pin: string, salt: string, iterations: number, expected: string) {
  const actual = pbkdf2Sync(pin, salt, iterations || PIN_ITERATIONS, 32, "sha256");
  const expectedBuffer = Buffer.from(expected, "base64url");
  return actual.length === expectedBuffer.length && timingSafeEqual(actual, expectedBuffer);
}

async function createSession(userId: string, deviceLabel?: string) {
  const token = randomBytes(32).toString("base64url");
  const tokenHash = sessionHash(token);
  const sql = await getReadySql();
  const rows = (await sql`
    INSERT INTO user_sessions (user_id, token_hash, device_label, expires_at)
    VALUES (${userId}, ${tokenHash}, ${deviceLabel ?? null}, now() + (${`${SESSION_DAYS} days`})::interval)
    RETURNING id, user_id, device_label, created_at, last_seen_at, expires_at
  `) as DbRow[];
  return {
    id: String(rows[0].id),
    userId: String(rows[0].user_id),
    token,
    deviceLabel: rows[0].device_label ? String(rows[0].device_label) : undefined,
    createdAt: iso(rows[0].created_at),
    lastSeenAt: iso(rows[0].last_seen_at),
    expiresAt: iso(rows[0].expires_at),
  };
}

function sessionHash(token: string) {
  return createHash("sha256").update(token).digest("base64url");
}

function mapUser(row: Record<string, unknown>) {
  return {
    id: String(row.id),
    displayName: String(row.display_name),
    normalizedName: String(row.normalized_name),
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
    lastLoginAt: iso(row.last_login_at),
    pinEnabled: Boolean(row.pin_hash),
    lockedUntil: row.locked_until ? iso(row.locked_until) : undefined,
    authNote: "PIN auth is an alpha convenience layer. For production multi-user use, migrate to passkeys, email magic links, OAuth, or verified email recovery.",
  };
}

function mapSnapshot(row: Record<string, unknown>) {
  return {
    id: String(row.id),
    userId: String(row.user_id),
    appVersion: String(row.app_version),
    schemaVersion: Number(row.schema_version),
    dataJson: row.data_json as Record<string, unknown>,
    deviceLabel: row.device_label ? String(row.device_label) : undefined,
    backupLabel: row.backup_label ? String(row.backup_label) : undefined,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}

function iso(value: unknown) {
  if (value instanceof Date) return value.toISOString();
  return new Date(String(value)).toISOString();
}
