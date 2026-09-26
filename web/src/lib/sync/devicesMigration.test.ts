import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const sql = readFileSync(fileURLToPath(new URL("../../../../supabase/migrations/20260926000200_accounts_devices_and_deletion.sql", import.meta.url)), "utf8");

describe("Accounts v1.1 migration", () => {
  it("keeps the device registry behind row-level security with no client write policy", () => {
    expect(sql).toContain("alter table public.account_devices enable row level security");
    expect(sql).toContain("for select using (auth.uid() = user_id)");
    expect(sql).toContain("for delete using (auth.uid() = user_id)");
    expect(sql).not.toMatch(/for (insert|update|all)/);
  });

  it("refuses anonymous callers and only grants execution to authenticated users", () => {
    for (const fn of ["touch_account_device", "delete_my_cloud_data"]) {
      expect(sql).toContain(`create or replace function public.${fn}(`);
      expect(sql).toMatch(new RegExp(`grant execute on function public\\.${fn}\\([^)]*\\) to authenticated;`));
    }
    expect(sql.match(/auth\.uid\(\) is null then raise exception 'authentication required'/g)).toHaveLength(2);
    expect(sql).not.toContain("to anon");
  });

  it("scopes cloud deletion to the caller and bounds the device list", () => {
    const deletion = sql.slice(sql.indexOf("function public.delete_my_cloud_data"));
    for (const table of ["question_set_shares", "sync_conflicts", "workspace_revisions", "workspaces", "account_devices"]) {
      expect(deletion).toMatch(new RegExp(`delete from ${table} where (owner_user_id|user_id) = auth\\.uid\\(\\)`));
    }
    expect(sql).toContain("offset 20");
  });
});
