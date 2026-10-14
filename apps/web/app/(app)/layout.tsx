import { redirect } from "next/navigation"
import type { ReactNode } from "react"
import { AppShell } from "@/components/AppShell"
import { supabaseServer } from "@/lib/supabase/server"

export default async function AppLayout({ children }: { children: ReactNode }) {
  if (process.env.NEXT_PUBLIC_DEMO === "true") return <AppShell user={{ name: "David Demo", avatar: null }}>{children}</AppShell>
  const supabase = await supabaseServer()
  const { data } = await supabase.auth.getClaims()
  const claims = data?.claims as { sub: string; email?: string } | undefined
  if (!claims) redirect("/login")
  const { data: profile } = await supabase.from("profiles").select("name, avatar_url").eq("id", claims.sub).single()
  return <AppShell user={{ name: profile?.name ?? claims.email ?? "", avatar: profile?.avatar_url ?? null }}>{children}</AppShell>
}
