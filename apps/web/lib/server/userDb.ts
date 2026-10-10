import { supabaseAdmin } from "../supabase/server"

// The service-role client bypasses RLS, so every query made on a user's behalf goes through
// here: reads, updates and deletes are filtered by user_id, inserts get user_id set.
export function userDb(userId: string) {
  const db = supabaseAdmin()
  return {
    userId,
    select: (table: string, columns = "*") => db.from(table).select(columns).eq("user_id", userId),
    insert: <T extends Record<string, unknown>>(table: string, rows: T | T[]) =>
      db.from(table).insert((Array.isArray(rows) ? rows : [rows]).map((r) => ({ ...r, user_id: userId }))),
    upsert: <T extends Record<string, unknown>>(table: string, rows: T | T[], onConflict: string) =>
      db.from(table).upsert((Array.isArray(rows) ? rows : [rows]).map((r) => ({ ...r, user_id: userId })), { onConflict }),
    update: (table: string, patch: Record<string, unknown>) => db.from(table).update(patch).eq("user_id", userId),
    delete: (table: string) => db.from(table).delete().eq("user_id", userId),
    rpc: <T>(fn: "get_day" | "get_range", args: Record<string, unknown>) =>
      db.rpc(fn, { ...args, p_user: userId }) as unknown as Promise<{ data: T | null; error: { message: string } | null }>,
    profile: () => db.from("profiles").select("*").eq("id", userId).single(),
    updateProfile: (patch: Record<string, unknown>) => db.from("profiles").update(patch).eq("id", userId),
  }
}

export type UserDb = ReturnType<typeof userDb>

// Throws on a Supabase error, returns data otherwise
export function must<T>(res: { data: T | null; error: { message: string } | null }, what: string): T {
  if (res.error) throw new Error(`${what}: ${res.error.message}`)
  return res.data as T
}
