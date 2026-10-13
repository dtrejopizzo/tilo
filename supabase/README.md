# Base de datos de Tilo (Supabase)

Todo el schema vive en `migrations/`. `setup.sql` es esos mismos archivos concatenados, listo para pegar una sola vez.

## Crear la base (una vez, ~10 minutos)

1. **Proyecto.** En [supabase.com](https://supabase.com) → New project. Región: **South America (São Paulo)**, la misma que Vercel `gru1`. Guardá la contraseña de la base.
2. **Schema.** SQL Editor → New query → pegá todo [`setup.sql`](setup.sql) → Run. Crea tablas, seguridad por usuario (RLS), triggers, funciones `get_day`/`get_range` y la biblioteca de 111 ejercicios.
3. **Login con Google.**
   - En [Google Cloud Console](https://console.cloud.google.com/apis/credentials): Create credentials → OAuth client ID → *Web application*.
     - Authorized redirect URIs:
       - `https://<tu-proyecto>.supabase.co/auth/v1/callback` (login)
       - `https://<tu-dominio>/api/connect/google/callback` (Gmail, Calendar, Health)
       - `http://localhost:3000/api/connect/google/callback` (desarrollo)
   - En Supabase → Authentication → Providers → **Google**: activalo y pegá el Client ID y Client Secret.
   - En Supabase → Authentication → URL Configuration: **Site URL** `https://<tu-dominio>` y en Redirect URLs agregá `https://<tu-dominio>/auth/callback` y `http://localhost:3000/auth/callback`.
   - Desactivá el resto de los providers (Email, etc.): el login es solo con Google.
4. **APIs de Google** (APIs & Services → Library): habilitá **Gmail API**, **Google Calendar API** y **Google Health API**. En *OAuth consent screen* agregá los scopes:
   - `gmail.readonly`, `calendar.readonly`
   - `googlehealth.activity_and_fitness.readonly`, `googlehealth.health_metrics_and_measurements.readonly`, `googlehealth.sleep.readonly`
   - Publicá la app ("In production"). Sin verificar, Google muestra un aviso y permite hasta 100 usuarios; en modo *Testing* los tokens vencen a los 7 días.
5. **Claves.** Supabase → Project Settings → API: copiá *Project URL*, *anon public* y *service_role* a las variables de entorno (ver [`apps/web/.env.example`](../apps/web/.env.example)).

## Migrar tus datos de Firebase (opcional, una vez)

```sh
FIREBASE_SERVICE_ACCOUNT='{"type":"service_account",...}' \
SUPABASE_URL=https://<tu-proyecto>.supabase.co SUPABASE_SERVICE_ROLE_KEY=... \
npm run db:migrate-firebase -- --dry-run     # solo cuenta
npm run db:migrate-firebase                  # migra
```

Copia perfil, objetivos, tareas (con proyectos), hábitos con su historial, comidas, agua, peso y actividades. Las conexiones (Strava, Gmail) se reconectan desde Settings.

## Desarrollo

- `npm run test:db` corre las migraciones sobre un Postgres embebido (PGlite) y prueba RLS, triggers y RPCs. No necesita Docker.
- Al cambiar el schema: agregá un archivo nuevo en `migrations/` (no edites los aplicados) y regenerá `setup.sql` con `npm run db:setup-sql`.
- La biblioteca de ejercicios sale de `packages/core/src/exercises.ts`: después de editarla, `npm run db:seed-exercises`.

## Qué hay en el schema

| Tabla | Para qué |
| --- | --- |
| `profiles`, `goals`, `settings` | Perfil (altura, sexo, nacimiento, % grasa), objetivos y preferencias |
| `tasks`, `projects` | Tareas (manuales, desde código, desde mail o MCP) |
| `habits`, `habit_logs` | Hábitos diarios/semanales con sus días de la semana; `auto_rule` los completa desde actividades |
| `supplements`, `supplement_logs` | Stack de suplementos por momento del día, con stock |
| `meals`, `water_logs`, `caffeine_logs`, `weight_logs` | Nutrición (macros y micros), agua, cafeína, peso y % grasa |
| `exercises`, `routines`, `routine_items`, `workouts`, `workout_sets` | Gimnasio: biblioteca, rutinas por día, series con peso, reps y RPE |
| `activities`, `daily_metrics` | Datos de dispositivos (Apple, Google Health, Health Connect, Strava), deduplicados |
| `energy_days`, `daily_summary` | Cálculos: gasto energético por término y resumen diario (lo mantienen triggers) |
| `email_snapshots`, `email_insights` | Conteos diarios de la bandeja y mails importantes (nunca el contenido) |
| `focus_sessions`, `checkins` | Foco/tiempo programando y check-ins de energía y ánimo |
| `connections`, `connection_secrets` | OAuth de Strava y Google; tokens cifrados y solo accesibles por el servidor |
| `api_tokens`, `oauth_clients`, `oauth_codes` | Tokens personales y OAuth del MCP remoto (solo hashes) |
| `ai_usage`, `subscriptions` | Medición de IA por usuario y plan |
