import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import type { Page, Request } from "@playwright/test";
import { QUIET_NUDGES } from "../fixtures";

/** PostgreSQL RLS and application SQL are real. Auth and REST are synthetic
 * test transport, not evidence of GoTrue, PostgREST or deployed acceptance. */
export const PLATFORM_FIXTURE_URL = "https://platform-fixture.invalid";
export const PLATFORM_USERS = [
  { id: "11111111-1111-4111-8111-111111111111", name: "Fixture Atlas", handle: "fixture_atlas" },
  { id: "22222222-2222-4222-8222-222222222222", name: "Fixture Briar", handle: "fixture_briar" },
] as const;
const cors = { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "*" };
const rpcNames = new Set(["axom_operator_role", "axom_operator_overview", "axom_operator_accounts", "axom_operator_review_queue",
  "axom_operator_reports", "axom_operator_set_role", "axom_operator_set_ai", "axom_operator_resolve_report", "consume_ai_quota"]);
const tables = new Set(["social_profiles", "social_connections", "social_posts", "social_reactions", "social_post_reports", "axom_operator_audit"]);
const identifier = (value: string) => {
  if (!/^[a-z_]+$/.test(value)) throw new Error("Unexpected fixture identifier");
  return `"${value}"`;
};

export async function createPlatformDatabase() {
  // PGlite's default DATE parser creates a Date, while PostgREST sends YYYY-MM-DD.
  // Preserve SQL date text so date-window logic sees the production wire shape.
  const db = new PGlite({ extensions: { pgcrypto }, parsers: { 1082: value => value } });
  await db.exec(`
    create schema extensions;
    create extension pgcrypto with schema extensions;
    create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
    grant usage on schema public to anon, authenticated, service_role;
    alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
    alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
    alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
    create schema auth;
    create table auth.users(id uuid primary key default gen_random_uuid(),email text,raw_user_meta_data jsonb default '{}'::jsonb,
      created_at timestamptz not null default now(),last_sign_in_at timestamptz);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    grant usage on schema auth to anon, authenticated, service_role;
    grant execute on function auth.uid() to anon, authenticated, service_role;
    create schema storage;
    create table storage.buckets(id text primary key,name text not null,public boolean not null default false,file_size_limit bigint,allowed_mime_types text[]);
    create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text references storage.buckets(id),name text not null,metadata jsonb,unique(bucket_id,name));
    alter table storage.objects enable row level security;
    grant usage on schema storage to anon, authenticated, service_role;
    grant select,insert,update,delete on storage.objects to anon, authenticated, service_role;
    grant all on storage.buckets to service_role;
    set search_path = "$user", public, extensions;
  `);
  const directory = fileURLToPath(new URL("../../../supabase/migrations/", import.meta.url));
  for (const file of readdirSync(directory).filter(file => file.endsWith(".sql")).sort()) {
    await db.exec(readFileSync(directory + file, "utf8"));
  }
  for (const user of PLATFORM_USERS) {
    await db.query("insert into auth.users(id,email,raw_user_meta_data) values($1,$2,$3)",
      [user.id, `${user.handle}@example.test`, JSON.stringify({ display_name: user.name })]);
  }
  // Synthetic owner assignment is intentionally isolated from the production bootstrap.
  await db.query("insert into public.axom_operator_roles(user_id,role) values($1,'owner')", [PLATFORM_USERS[0].id]);

  // Browser contexts share one connection. Serialize each authenticated transaction
  // so a concurrent request can never inherit another fixture account's role.
  let queue = Promise.resolve();
  const asUser = async <T = Record<string, unknown>>(userId: string, sql: string, params: unknown[] = []): Promise<T[]> => {
    const result = queue.then(() => db.transaction(async tx => {
      await tx.query("select set_config('request.jwt.claim.sub',$1,true)", [userId]);
      await tx.exec("set local role authenticated");
      return (await tx.query<T>(sql, params)).rows;
    }));
    queue = result.then(() => undefined, () => undefined);
    return result;
  };
  const rpc = async (userId: string, name: string, args: Record<string, unknown> = {}) => {
    if (!rpcNames.has(name)) throw new Error(`Unexpected fixture RPC: ${name}`);
    const keys = Object.keys(args);
    const signature = keys.map((key, index) => `${identifier(key)} => $${index + 1}`).join(",");
    if (["axom_operator_accounts", "axom_operator_review_queue", "axom_operator_reports"].includes(name)) {
      return asUser(userId, `select * from public.${identifier(name)}(${signature})`, keys.map(key => args[key]));
    }
    return (await asUser<{ value: unknown }>(userId, `select public.${identifier(name)}(${signature}) as value`, keys.map(key => args[key])))[0].value;
  };
  const tableRequest = async (userId: string, table: string, request: Request) => {
    if (!tables.has(table)) throw new Error(`Unexpected fixture table: ${table}`);
    const url = new URL(request.url());
    const values: unknown[] = [];
    const bind = (value: unknown) => { values.push(value); return `$${values.length}`; };
    const fields = url.searchParams.get("select") ?? "*";
    const selection = fields === "*" ? "*" : fields.split(",").map(identifier).join(",");
    const predicates: string[] = [];
    for (const [column, value] of url.searchParams.entries()) {
      if (["select", "order", "limit", "on_conflict"].includes(column)) continue;
      if (value.startsWith("eq.")) predicates.push(`${identifier(column)} = ${bind(value.slice(3))}`);
      else if (value.startsWith("in.(") && value.endsWith(")")) {
        const members = value.slice(4, -1).split(",");
        if (members.length > 2000) throw new Error("Oversized fixture filter");
        predicates.push(`${identifier(column)} in (${members.map(bind).join(",")})`);
      } else throw new Error(`Unexpected fixture filter: ${value}`);
    }
    const where = predicates.length ? ` where ${predicates.join(" and ")}` : "";
    let sql: string;
    if (request.method() === "GET") {
      const order = (url.searchParams.get("order") ?? "").split(",").filter(Boolean).map(entry => {
        const [column, direction] = entry.split(".");
        return `${identifier(column)} ${direction === "desc" ? "desc" : "asc"}`;
      });
      const limit = Math.min(2000, Math.max(1, Number(url.searchParams.get("limit") ?? 2000)));
      if (!Number.isInteger(limit)) throw new Error("Invalid fixture limit");
      sql = `select ${selection} from public.${identifier(table)}${where}${order.length ? ` order by ${order.join(",")}` : ""} limit ${limit}`;
    } else if (request.method() === "DELETE") {
      sql = `delete from public.${identifier(table)}${where} returning ${selection}`;
    } else {
      const body = request.postDataJSON() as Record<string, unknown>;
      const keys = Object.keys(body);
      if (request.method() === "PATCH") {
        sql = `update public.${identifier(table)} set ${keys.map(key => `${identifier(key)}=${bind(body[key])}`).join(",")}${where} returning ${selection}`;
      } else if (request.method() === "POST") {
        sql = `insert into public.${identifier(table)}(${keys.map(identifier).join(",")}) values(${keys.map(key => bind(body[key])).join(",")})`;
        if (request.headers().prefer?.includes("resolution=merge-duplicates")) {
          const conflict = url.searchParams.get("on_conflict") ?? "user_id";
          sql += ` on conflict(${identifier(conflict)}) do update set ${keys.filter(key => key !== conflict).map(key => `${identifier(key)}=excluded.${identifier(key)}`).join(",")}`;
        }
        sql += ` returning ${selection}`;
      } else throw new Error(`Unexpected fixture method: ${request.method()}`);
    }
    return asUser(userId, sql, values);
  };

  const attach = async (page: Page, index: 0 | 1) => {
    const person = PLATFORM_USERS[index];
    const unexpected: string[] = [];
    await page.addInitScript(({ url, person, nudges }) => {
      Object.assign(window, { __AXOM_E2E_ACCOUNT__: { url, key: "synthetic-public-fixture-key" } });
      const user = { id: person.id, aud: "authenticated", role: "authenticated", email: `${person.handle}@example.test`,
        email_confirmed_at: "2026-01-01T00:00:00Z", created_at: "2026-01-01T00:00:00Z", user_metadata: { display_name: person.name }, app_metadata: {} };
      localStorage.setItem("sb-platform-fixture-auth-token", JSON.stringify({ access_token: `fixture-${person.id}`, refresh_token: `fixture-refresh-${person.id}`,
        token_type: "bearer", expires_in: 86400, expires_at: Math.floor(Date.now() / 1000) + 86400, user }));
      for (const [key, value] of Object.entries(nudges)) localStorage.setItem(key, value);
    }, { url: PLATFORM_FIXTURE_URL, person, nudges: QUIET_NUDGES });
    await page.route(`${PLATFORM_FIXTURE_URL}/**`, async route => {
      const request = route.request();
      const url = new URL(request.url());
      const json = (status: number, value: unknown) => route.fulfill({ status, headers: { ...cors, "content-type": "application/json" }, body: JSON.stringify(value) });
      if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors });
      if (request.headers().authorization !== `Bearer fixture-${person.id}`) return json(401, { message: "Fixture session required" });
      const name = url.pathname.replace("/rest/v1/rpc/", "");
      const table = url.pathname.replace("/rest/v1/", "");
      try {
        if (rpcNames.has(name)) return json(200, await rpc(person.id, name, request.postDataJSON() as Record<string, unknown>));
        if (tables.has(table)) {
          const rows = await tableRequest(person.id, table, request);
          if (request.method() === "GET" || request.headers().prefer?.includes("return=representation")) return json(200, rows);
          return route.fulfill({ status: 204, headers: cors });
        }
      } catch (error) {
        return json(403, { code: error && typeof error === "object" && "code" in error ? error.code : "42501", message: error instanceof Error ? error.message : "SQL fixture rejected request" });
      }
      if (url.pathname === "/rest/v1/account_profiles") return json(200, { display_name: person.name });
      if (["/rest/v1/workspace_revisions", "/rest/v1/account_devices"].includes(url.pathname)) return json(200, []);
      if (url.pathname === "/rest/v1/rpc/touch_account_device") return json(200, null);
      if (url.pathname === "/functions/v1/communications" && url.searchParams.get("action") === "settings") {
        return json(200, { preferences: [], identity: { accent: "gold", theme: "dark" }, history: [], privacy: [], admin: false,
          deliveryMode: "disabled", deletionEnabled: false, hasProtectedCopy: false });
      }
      if (url.pathname === "/auth/v1/user") return json(200, { id: person.id, aud: "authenticated", role: "authenticated", email: `${person.handle}@example.test`, user_metadata: { display_name: person.name }, app_metadata: {} });
      unexpected.push(`${request.method()} ${url.pathname}${url.search}`);
      return json(404, { message: "Request is outside this local fixture" });
    });
    return unexpected;
  };
  return { db, rpc, asUser, attach, close: async () => { await queue; await db.close(); } };
}
