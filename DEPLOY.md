# Deploy de Tilo, paso a paso

Tiempo total: ~45 minutos. Al final tenés Tilo en `https://<tu-dominio>` con login de Google, Strava, Gmail, Calendar y Google Health.

## 0. Qué subir a GitHub

La carpeta **`tiloApp` entera** es el repositorio (Vercel necesita `apps/web` y `packages/core`, que viven juntos). El `.gitignore` ya deja afuera `node_modules`, `.next`, `.env*`, builds y el `.vsix`.

```sh
cd tiloApp
git add -A
git commit -m "Tilo 2.0: Supabase, web nueva, VSCode y MCP"
git push origin main
```

## 1. Supabase (base de datos y login)

1. [supabase.com](https://supabase.com) → **New project**. Región **South America (São Paulo)**. Guardá la contraseña.
2. **SQL Editor → New query** → pegá todo `supabase/setup.sql` → **Run**. Tiene que terminar sin errores.
3. **Project Settings → API**: copiá **Project URL**, **anon public** y **service_role** (secreta).

## 2. Google Cloud (login, Gmail, Calendar, Google Health)

En [console.cloud.google.com](https://console.cloud.google.com), creá un proyecto "Tilo":

1. **APIs & Services → Library**: habilitá **Gmail API**, **Google Calendar API** y **Google Health API**.
2. **OAuth consent screen**: tipo *External*, nombre "Tilo", tu email. En **Scopes** agregá:
   `gmail.readonly`, `calendar.readonly`, `googlehealth.activity_and_fitness.readonly`, `googlehealth.health_metrics_and_measurements.readonly`, `googlehealth.sleep.readonly`.
   Después **Publish app** ("In production"). Google va a mostrar "app no verificada" al conectar: es normal para uso personal (tocás *Avanzado → Ir a Tilo*). En modo *Testing* los permisos vencen cada 7 días, por eso conviene publicarla.
3. **Credentials → Create credentials → OAuth client ID → Web application**:
   - Authorized JavaScript origins: `https://<tu-dominio>` y `http://localhost:3000`
   - Authorized redirect URIs:
     - `https://<tu-proyecto>.supabase.co/auth/v1/callback`
     - `https://<tu-dominio>/api/connect/google/callback`
     - `http://localhost:3000/api/connect/google/callback`
   - Copiá **Client ID** y **Client secret**.

## 3. Login con Google en Supabase

1. **Authentication → Sign In / Providers → Google**: activalo, pegá Client ID y Client secret.
2. Desactivá **Email** (el login es solo con Google).
3. **Authentication → URL Configuration**: Site URL `https://<tu-dominio>`. Redirect URLs: `https://<tu-dominio>/auth/callback` y `http://localhost:3000/auth/callback`.

## 4. Strava

1. [strava.com/settings/api](https://www.strava.com/settings/api) → creá la app: Website `https://<tu-dominio>`, **Authorization Callback Domain** `<tu-dominio>` (sin https).
2. Copiá **Client ID** y **Client Secret**.
3. Si usás Garmin: Garmin Connect → Configuración → Aplicaciones conectadas → Strava.

## 5. Vercel

1. [vercel.com/new](https://vercel.com/new) → importá el repo.
2. **Root Directory: `apps/web`** (Framework: Next.js, lo detecta solo).
3. **Environment Variables** (todas en Production):

| Variable | Valor |
| --- | --- |
| `NEXT_PUBLIC_APP_URL` | `https://<tu-dominio>` (sin barra final) |
| `NEXT_PUBLIC_SUPABASE_URL` | Project URL de Supabase |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | anon public |
| `SUPABASE_SERVICE_ROLE_KEY` | service_role |
| `TOKEN_ENCRYPTION_KEY` | resultado de `openssl rand -base64 32` |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | del paso 2 |
| `STRAVA_CLIENT_ID` / `STRAVA_CLIENT_SECRET` | del paso 4 |
| `STRAVA_WEBHOOK_VERIFY_TOKEN` | cualquier texto secreto (`openssl rand -hex 12`) |
| `GEMINI_API_KEY` | tu key de [aistudio.google.com](https://aistudio.google.com/apikey) (con facturación activa: el tier pago no usa tus datos para entrenar) |
| `CRON_SECRET` | `openssl rand -hex 24` |
| `GOOGLE_HEALTH_WEBHOOK_SECRET` | `Bearer ` + `openssl rand -hex 24` (Google Health en tiempo real, paso 6b) |

   **No** cargues `NEXT_PUBLIC_DEMO` (es solo para la demo local).
4. **Deploy**. Si usás el dominio `*.vercel.app` que te asigna, volvé a los pasos 2, 3 y 4 y reemplazá `<tu-dominio>` por ese, y actualizá `NEXT_PUBLIC_APP_URL` → **Redeploy**.

`vercel.json` ya fija la región `gru1` (São Paulo, junto a Supabase) y el cron diario de sincronización.

## 6. Webhook de Strava (una vez, con la app ya online)

```sh
curl -X POST https://www.strava.com/api/v3/push_subscriptions \
  -F client_id=<STRAVA_CLIENT_ID> -F client_secret=<STRAVA_CLIENT_SECRET> \
  -F callback_url=https://<tu-dominio>/api/webhooks/strava \
  -F verify_token=<STRAVA_WEBHOOK_VERIFY_TOKEN>
```

Responde `{"id": …}` si quedó suscripto. Desde la versión actual **esto lo hace la app sola** (al conectar Strava y cada noche), así que el curl es solo para verificar: `curl "https://www.strava.com/api/v3/push_subscriptions?client_id=…&client_secret=…"` tiene que listar tu dominio.

## 6b. Google Health en tiempo real (una vez)

Sin esto, los datos de Fitbit / Pixel Watch / Health Connect llegan en el sync cada 15 minutos. Con esto, Google avisa a Tilo segundos después de que el teléfono sincroniza.

1. En Google Cloud → tu proyecto "Tilo" → **IAM**: a tu usuario dale el rol **Google Health API Admin** (o usá una cuenta de servicio con ese rol).
2. Anotá el **número de proyecto** (Project number, no el ID) de la pantalla principal de Cloud Console.
3. Con la app ya deployada y `GOOGLE_HEALTH_WEBHOOK_SECRET` cargado en Vercel:

```sh
gcloud auth login
GOOGLE_PROJECT_NUMBER=<número> GOOGLE_ACCESS_TOKEN="$(gcloud auth print-access-token)" npm run health:webhook
```

Google verifica el endpoint en el momento (manda una llamada con el secreto y otra sin) y queda suscripto para **todos** los usuarios que conectaron Google Health, también los futuros. Si cambiás de dominio, corré el comando de nuevo.

## 6c. Sync cada 15 minutos (una vez)

El cron de Vercel corre una vez por día en el plan Hobby. Para que los datos no dependan de abrir la app, elegí **una** de estas dos opciones gratis:

**Opción A: Supabase (recomendada, no necesita nada más).** SQL Editor → New query:

```sql
create extension if not exists pg_cron;
create extension if not exists pg_net;
select vault.create_secret('<CRON_SECRET>', 'tilo_cron_secret');
select cron.schedule('tilo-sync', '*/15 * * * *', $$
  select net.http_get(
    url := 'https://<tu-dominio>/api/cron/sync',
    headers := jsonb_build_object('Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'tilo_cron_secret')),
    timeout_milliseconds := 290000
  );
$$);
```

Se controla con `select * from cron.job;` y los resultados en `select * from cron.job_run_details order by start_time desc limit 10;`. Para frenarlo: `select cron.unschedule('tilo-sync');`.

**Opción B: GitHub Actions.** El repo trae `.github/workflows/sync.yml` (cada 30 minutos). Solo cargá en GitHub → Settings → Secrets and variables → Actions los secretos `TILO_URL` (`https://<tu-dominio>`) y `CRON_SECRET`.

## 7. Primer uso

1. Entrá a `https://<tu-dominio>` → **Continuar con Google**.
2. El asistente pide tus datos (sexo, nacimiento, altura, peso) y qué usás → **Conectar Strava** y **Conectar Fitbit / Pixel Watch** (Google Health) si corresponde.
3. Settings (⚙) → **Conexiones → Conectar Gmail y Calendar**.
4. Settings → Objetivos, Hábitos, Suplementos y Rutinas.
5. Opcional, traer tus datos de Firebase: ver `supabase/README.md` → "Migrar tus datos de Firebase".

## 8. VSCode y tu IA

- **Extensión**: `code --install-extension integrations/vscode/tilo-vscode-0.2.0.vsix` → comando **Tilo: Conectar** → URL + token (Settings → VSCode y MCP → Generar token).
- **Claude / ChatGPT / Copilot**: agregá el conector MCP `https://<tu-dominio>/api/mcp` y entrá con Google.

## Desarrollo local

```sh
npm install
npm run demo   # http://localhost:3000 con datos de ejemplo, sin Supabase ni Google
npm run dev    # contra tu Supabase real (necesita apps/web/.env.local con las variables de arriba)
npm test       # tests del core y de la base (sin Docker)
```
