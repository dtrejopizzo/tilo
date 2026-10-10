import { createServerClient } from "@supabase/ssr"
import { NextResponse, type NextRequest } from "next/server"

// Refreshes the Supabase session cookie on every page request and sends signed-out
// visitors to /login. API routes authenticate themselves (session, JWT or tilo_ token).
export async function proxy(request: NextRequest) {
  if (process.env.NEXT_PUBLIC_DEMO === "true") return NextResponse.next() // demo: no accounts
  let response = NextResponse.next({ request })
  const supabase = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (list) => {
        for (const { name, value } of list) request.cookies.set(name, value)
        response = NextResponse.next({ request })
        for (const { name, value, options } of list) response.cookies.set(name, value, options)
      },
    },
  })
  const { data } = await supabase.auth.getUser()
  const path = request.nextUrl.pathname
  const isPublic = path.startsWith("/login") || path.startsWith("/auth")
  if (!data.user && !isPublic) {
    const url = new URL("/login", request.url)
    url.searchParams.set("next", path + request.nextUrl.search)
    return NextResponse.redirect(url)
  }
  return response
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|api|\\.well-known|manifest.webmanifest|icon|apple-icon|.*\\.(?:png|svg|ico|jpg)$).*)"],
}
