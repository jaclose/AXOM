import { toPortableState } from "../lib/backup";
import type { AxomState } from "../lib/types";

const DB_URL = "sqlite:noctyrium.db";

export function isNativeSqliteAvailable(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export async function saveNativeSnapshot(state: AxomState, backupLabel?: string) {
  if (!isNativeSqliteAvailable()) return { ok: false, reason: "Tauri runtime unavailable" };
  const Database = (await import("@tauri-apps/plugin-sql")).default;
  const db = await Database.load(DB_URL);
  const now = new Date().toISOString();
  const payload = toPortableState(state);
  await db.execute(
    `INSERT INTO local_vault_snapshots (
      id, profile_user_id, profile_name, app_version, schema_version, data_json,
      created_at, updated_at, device_label, backup_label
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      crypto.randomUUID(),
      state.profile.userId,
      state.profile.name || "AXOM",
      state.profile.versionLabel,
      state.schemaVersion,
      JSON.stringify(payload),
      now,
      now,
      navigator.platform || "Tauri desktop",
      backupLabel ?? null,
    ],
  );
  return { ok: true };
}

export async function listNativeSnapshots(profileUserId: string) {
  if (!isNativeSqliteAvailable()) return [];
  const Database = (await import("@tauri-apps/plugin-sql")).default;
  const db = await Database.load(DB_URL);
  return db.select<{
    id: string;
    profile_name: string;
    app_version: string;
    schema_version: number;
    created_at: string;
    updated_at: string;
    device_label?: string;
    backup_label?: string;
  }[]>(
    `SELECT id, profile_name, app_version, schema_version, created_at, updated_at, device_label, backup_label
     FROM local_vault_snapshots
     WHERE profile_user_id = ?
     ORDER BY updated_at DESC
     LIMIT 25`,
    [profileUserId],
  );
}
