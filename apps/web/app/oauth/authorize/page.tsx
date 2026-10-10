import { redirect } from "next/navigation"
import { getClient } from "@/lib/server/mcpOauth"
import { supabaseServer } from "@/lib/supabase/server"

// Consent screen for MCP clients (Claude, ChatGPT, Copilot…) asking to use Tilo
export default async function Authorize({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const p = await searchParams
  const supabase = await supabaseServer()
  const { data } = await supabase.auth.getUser()
  if (!data.user) {
    const qs = new URLSearchParams(Object.entries(p).filter(([, v]) => v != null) as [string, string][])
    redirect(`/login?next=${encodeURIComponent(`/oauth/authorize?${qs}`)}`)
  }
  const client = p.client_id ? await getClient(p.client_id) : null
  const valid = client && p.redirect_uri && client.redirect_uris.includes(p.redirect_uri) && p.code_challenge && (p.code_challenge_method ?? "S256") === "S256" && p.response_type === "code"
  return (
    <main className="login">
      <div className="login-card">
        <h1 style={{ fontSize: 24 }}>Conectar con Tilo</h1>
        {valid ? (
          <>
            <p><b>{client.client_name ?? "Una app"}</b> quiere leer y registrar en tu Tilo: tu día, tareas, comidas, entrenamientos y stats.</p>
            <p className="hint">Sesión: {data.user.email}. Podés revocarlo cuando quieras en Settings → VSCode y MCP.</p>
            <form method="post" action="/api/oauth/authorize" style={{ display: "flex", gap: 10, justifyContent: "center" }}>
              {(["client_id", "redirect_uri", "state", "code_challenge", "scope"] as const).map((k) => p[k] && <input key={k} type="hidden" name={k} value={p[k]} />)}
              <button className="btn ghost" name="decision" value="deny">Cancelar</button>
              <button className="btn leaf" name="decision" value="allow">Permitir</button>
            </form>
          </>
        ) : (
          <p className="bad">El pedido de autorización es inválido o vino de una app no registrada.</p>
        )}
      </div>
    </main>
  )
}
