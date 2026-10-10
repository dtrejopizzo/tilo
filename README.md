# Tilo

Hábitos, tareas, comidas, suplementos, entrenamiento, energía y mail, con el detalle de las stats de un developer. En la web, en VSCode y desde tu IA (MCP).

```
apps/web/              Next.js (Vercel, root directory) — Today, Stats, Settings, entrenamiento, conexiones, API v1, MCP remoto
packages/core/         @tilo/core — tipos, cliente, motor de energía, parser, entrenamiento, stats y herramientas MCP
supabase/              schema SQL (migraciones + setup.sql), seed de ejercicios, tests sobre Postgres embebido
integrations/mcp/      MCP local (stdio)
integrations/vscode/   extensión de VSCode
scripts/               generación de seed/setup.sql y migración desde Firebase
```

## Poner en marcha

Guía completa: **[DEPLOY.md](DEPLOY.md)**. Para ver la app sin configurar nada: `npm install && npm run demo`.


1. **Base de datos**: seguí [supabase/README.md](supabase/README.md) (crear proyecto, pegar `setup.sql`, configurar el login con Google).
2. **Variables**: copiá [apps/web/.env.example](apps/web/.env.example) a `apps/web/.env.local` y a Vercel.
3. **Vercel**: Root Directory `apps/web`. `vercel.json` fija la región `gru1` (São Paulo) y el cron diario.
4. **Integraciones**: [integrations/README.md](integrations/README.md) (Strava webhook, Google Health, MCP, VSCode).

```sh
npm install          # todos los workspaces
npm run dev          # http://localhost:3000
npm test             # @tilo/core + base de datos (PGlite, sin Docker)
npm run typecheck
```

## Cómo está pensado

- **Una consulta por pantalla**: `get_day(date)` y `get_range(from, to)` en Postgres traen todo; `daily_summary` se mantiene con triggers, así Stats lee una fila por día.
- **Una sola lógica**: `@tilo/core` calcula energía, checklist, stats y PRs igual en la web, VSCode y el MCP.
- **Energía precisa**: basal (Katch-McArdle o Mifflin con peso de tendencia), movimiento (energía medida o pasos sin contar los de los entrenamientos), ejercicio (kcal del reloj, FC con Keytel o MET, + EPOC) y digestión por macro, calibrado cada semana con tu peso real.
- **IA barata**: la IA de Tilo (Gemini) va con 7 días de prueba y después Pro. Cada usuario puede traer su propia key, y desde Claude/ChatGPT/Copilot (MCP) o VSCode (`vscode.lm`) usa su propio modelo, sin costo para Tilo.
