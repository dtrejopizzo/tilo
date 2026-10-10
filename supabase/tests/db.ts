// Spins up an in-memory Postgres (PGlite) with a minimal stand-in for Supabase's
// auth schema and roles, then applies every migration in order.
import { PGlite } from "@electric-sql/pglite"
import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"

const MIGRATIONS = join(__dirname, "..", "migrations")

const SUPABASE_STUB = `
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
create schema auth;
create table auth.users (
  id uuid primary key,
  email text,
  raw_user_meta_data jsonb not null default '{}'::jsonb
);
create function auth.uid() returns uuid language sql stable as
  $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
create function auth.role() returns text language sql stable as
  $$ select nullif(current_setting('request.jwt.claim.role', true), '') $$;
grant usage on schema public, auth to anon, authenticated, service_role;
grant execute on all functions in schema auth to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
`

export async function createDb(): Promise<PGlite> {
  const db = new PGlite()
  await db.exec(SUPABASE_STUB)
  for (const file of readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort()) {
    try {
      await db.exec(readFileSync(join(MIGRATIONS, file), "utf8"))
    } catch (error) {
      throw new Error(`${file}: ${(error as Error).message}`)
    }
  }
  return db
}

export async function createUser(db: PGlite, id: string, email: string, name = "Test User") {
  await asAdmin(db)
  await db.query("insert into auth.users (id, email, raw_user_meta_data) values ($1, $2, $3)", [
    id,
    email,
    JSON.stringify({ full_name: name }),
  ])
}

// Act as a signed-in user: role authenticated + JWT sub claim
export async function asUser(db: PGlite, id: string) {
  await db.exec("reset role")
  await db.query("select set_config('request.jwt.claim.sub', $1, false), set_config('request.jwt.claim.role', 'authenticated', false)", [id])
  await db.exec("set role authenticated")
}

export async function asAnon(db: PGlite) {
  await db.exec("reset role")
  await db.query("select set_config('request.jwt.claim.sub', '', false), set_config('request.jwt.claim.role', 'anon', false)")
  await db.exec("set role anon")
}

export async function asService(db: PGlite) {
  await db.exec("reset role")
  await db.query("select set_config('request.jwt.claim.sub', '', false), set_config('request.jwt.claim.role', 'service_role', false)")
  await db.exec("set role service_role")
}

export async function asAdmin(db: PGlite) {
  await db.exec("reset role")
  await db.query("select set_config('request.jwt.claim.sub', '', false), set_config('request.jwt.claim.role', '', false)")
}
