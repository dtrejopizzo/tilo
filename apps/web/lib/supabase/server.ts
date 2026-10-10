import { createServerClient } from "@supabase/ssr"
import { createClient, type SupabaseClient } from "@supabase/supabase-js"
import { cookies } from "next/headers"
import { env } from "../env"

// Session-aware client for Server Components and route handlers (reads the auth cookies)
export async function supabaseServer() {
  const store = await cookies()
  return createServerClient(env.supabaseUrl(), env.supabaseAnonKey(), {
    cookies: {
      getAll: () => store.getAll(),
      setAll: (list) => {
        try {
          for (const { name, value, options } of list) store.set(name, value, options)
        } catch {
          // Called from a Server Component: the middleware refreshes the session instead
        }
      },
    },
  })
}

let admin: SupabaseClient | null = null

// Service-role client. Bypasses RLS: only use it through userDb() or for server-only tables.
export function supabaseAdmin(): SupabaseClient {
  admin ??= createClient(env.supabaseUrl(), env.supabaseServiceKey(), {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  return admin
}
