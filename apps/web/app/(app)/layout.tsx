import { redirect } from "next/navigation"
import type { ReactNode } from "react"
import { AppShell } from "@/components/AppShell"
import { supabaseServer } from "@/lib/supabase/server"

export default async function AppLayout({ children }: { children: ReactNode }) {
  if (process.env.NEXT_PUBLIC_DEMO === "true") return <AppShell user={{ name: "David Demo", avatar: null }}>{children}</AppShell>
  const supabase = await supabaseServer()
  const { data } = await supabase.auth.getUser()
  if (!data.user) redirect("/login")
  const { data: profile } = await supabase.from("profiles").select("name, avatar_url").eq("id", data.user.id).single()
  return <AppShell user={{ name: profile?.name ?? data.user.email ?? "", avatar: profile?.avatar_url ?? null }}>{children}</AppShell>
}
