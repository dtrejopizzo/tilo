import { GoogleButton } from "./GoogleButton"

const LOGO = <img src="/icon.svg" alt="Tilo" width={120} height={120} style={{ margin: "0 auto" }} />

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; error?: string }> }) {
  const { next, error } = await searchParams
  return (
    <main className="login">
      <div className="login-card">
        {LOGO}
        <h1>Tilo</h1>
        <p>Hábitos, tareas, comidas, entrenamiento y salud. En la web, en VSCode y en tu IA.</p>
        <GoogleButton next={next ?? "/"} />
        {error && <p className="bad">No pudimos iniciar sesión: {error}</p>}
        <p className="hint">Solo pedimos tu nombre y email. Gmail, Calendar y salud se conectan después, si querés.</p>
      </div>
    </main>
  )
}
