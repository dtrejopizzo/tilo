import { PGlite } from "@electric-sql/pglite"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { expect, it } from "vitest"

// supabase/setup.sql is what gets pasted into the Supabase SQL editor: it must run as one script
it("setup.sql runs on a fresh database", async () => {
  const db = new PGlite()
  await db.exec(`
    create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
    create schema auth;
    create table auth.users (id uuid primary key, email text, raw_user_meta_data jsonb not null default '{}');
    create function auth.uid() returns uuid language sql stable as $$ select null::uuid $$;
    create function auth.role() returns text language sql stable as $$ select null::text $$;
  `)
  await db.exec(readFileSync(join(__dirname, "..", "setup.sql"), "utf8"))
  const { rows } = await db.query<{ n: number }>("select count(*)::int as n from public.exercises")
  expect(rows[0].n).toBeGreaterThan(100)
}, 60_000)
