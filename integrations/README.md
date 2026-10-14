# Integraciones de Tilo

| Qué | Dónde | Para quién |
| --- | --- | --- |
| **MCP remoto** | `https://<tu-tilo>/api/mcp` | Claude, ChatGPT, Copilot, Gemini y cualquier cliente MCP. Login con OAuth, sin instalar nada. |
| **MCP local** | [`mcp/`](mcp/) | Clientes que solo soportan stdio |
| **Extensión de VSCode** | [`vscode/`](vscode/) | Sidebar "Hoy", stats, settings, pausas activas, foco, TODOs → tareas, `@tilo` en el chat |
| **Strava** | OAuth + webhook | Actividades al instante; Garmin, Coros, Wahoo, Polar y Suunto llegan vía Strava |
| **Google** | OAuth incremental | Gmail (insights), Calendar, Google Health (Fitbit / Pixel Watch, beta) |

El código compartido (tipos, cliente HTTP, cálculos, render de stats y herramientas MCP) vive en [`packages/core`](../packages/core).

---

## MCP: usar Tilo desde tu IA (gratis para vos)

Las herramientas son las mismas en el remoto y el local: `get_today`, `get_month_stats`, `quick_add`, `log_meal`, `add_task`, `update_task`, `check_item`, `log_water`, `log_weight`, `start_workout`, `log_set`, `finish_workout`, `log_checkin`, `start_focus`, `stop_focus`. Prompts: `plan_my_day`, `weekly_review`, `log_my_day`.

Las herramientas están pensadas para que **piense el modelo del usuario** (por ejemplo, `log_meal` recibe calorías y macros estimados por Claude/ChatGPT), así que no consumen la IA de Tilo.

### Remoto (recomendado)

- **Claude** (claude.ai, Desktop): Settings → Connectors → Add custom connector → `https://<tu-tilo>/api/mcp`. Te pide entrar con Google y permitir.
- **Claude Code**: `claude mcp add --transport http tilo https://<tu-tilo>/api/mcp`
- **ChatGPT**: Settings → Connectors → Add → URL del MCP (requiere modo desarrollador en planes que lo soporten).
- **VSCode (Copilot, modo agente)**: *MCP: Add Server* → HTTP → `https://<tu-tilo>/api/mcp`.
- **Gemini CLI**: en `~/.gemini/settings.json`: `{"mcpServers": {"tilo": {"httpUrl": "https://<tu-tilo>/api/mcp"}}}`

El servidor publica `/.well-known/oauth-protected-resource` y `/.well-known/oauth-authorization-server`, registra clientes de forma dinámica (RFC 7591) y usa PKCE. Los accesos se ven y se revocan en Settings → VSCode y MCP.

### Local (stdio)

```sh
npm install && npm run build:mcp      # desde la raíz
claude mcp add tilo --scope user \
  -e TILO_API_URL=https://<tu-tilo> -e TILO_API_TOKEN=tilo_xxx \
  -- node /ruta/a/tiloApp/integrations/mcp/dist/index.js
```

---

## Extensión de VSCode

```sh
npm install                            # desde la raíz
cd integrations/vscode && npm run package
code --install-extension tilo-vscode-0.3.0.vsix
```

Después tocá **Iniciar sesión con Tilo** en el panel de Tilo: se abre el navegador, entrás con Google y vuelve solo a VSCode. Si usás tu propio servidor, **Tilo: Conectar (URL y token)** sigue disponible.

- **Sidebar "Hoy"**:
  - Agua (click suma un vaso), comidas con macros, balance energético con desglose y pasos.
  - Tareas con checkbox (las del código abren el archivo en la línea).
  - Hábitos y suplementos por momento del día.
  - Entrenamiento (rutina, última vez y actividades) y mail importante (→ tarea).
  - ‹ › navega días: clickear un día en Stats lo abre acá para editarlo.
- **Stats** (el perrito en la barra de pestañas): el mismo panel que la web.
- **Status bar**: agua, checklist, tareas, balance, próxima pausa activa, foco y descanso entre series.
- **Comandos**:
  - Registrar algo (⌘⌥T), agua (⌘⌥W), comida, peso, check-in, nueva tarea.
  - Entrenamiento (`80x8x3`) con timer de descanso.
  - Foco/pomodoro, pausa activa y crear tarea desde TODO (también como quick fix sobre `// TODO:`).
- **Pausas activas**: cuenta solo minutos de edición real, respeta horario y días, y se reinicia si te alejás. Puede marcar el hábito "Pausas activas".
- **Recordatorios**: agua si venís atrasado, "¿qué comiste?" a la hora del almuerzo y la cena, resumen del día.
- **Foco automático**: los tramos de 10+ minutos programando se guardan como foco y aparecen en Stats.
- **Tareas que se cierran solas**: una tarea creada desde un TODO guarda su rama; cuando esa rama se mergea (merge normal, o PR de GitHub con squash, que deja la rama remota borrada) la extensión la marca como hecha.
- **IA del editor**: las comidas se estiman con tu Copilot (`vscode.lm`) cuando está disponible.
- **`@tilo` en el chat**: `/hoy`, `/plan`, `/review`, `/log 2 empanadas y 500 de agua`.
- **Tilo Settings**: objetivos (en tu cuenta) y pausas, recordatorios, status bar y foco (en esta máquina).

---

## Datos de salud

Hoy entran por **Strava** (Garmin, Apple Watch, Coros, Polar, Suunto, Wahoo vía Strava) y **Google Health** (Fitbit / Pixel Watch). Si dos fuentes miden lo mismo:
- Para pasos y distancia gana la más completa.
- Para FC, energía y sueño gana el reloj.
- Las sesiones duplicadas (mismo entrenamiento en Strava y en el reloj) se fusionan por solapamiento de horario.

### Strava (y Garmin, Coros, Wahoo, Polar, Suunto)

1. En https://www.strava.com/settings/api: *Authorization Callback Domain* = tu dominio.
2. Suscribí el webhook **una vez** (con la app ya deployada):

```sh
curl -X POST https://www.strava.com/api/v3/push_subscriptions \
  -F client_id=$STRAVA_CLIENT_ID -F client_secret=$STRAVA_CLIENT_SECRET \
  -F callback_url=https://<tu-tilo>/api/webhooks/strava \
  -F verify_token=$STRAVA_WEBHOOK_VERIFY_TOKEN
```

Desde la versión actual la suscripción **la hace la app sola** (al conectar Strava y en el cron diario), así que el curl es solo para verificar. Cada actividad nueva, editada o borrada llega en segundos. El sync cada 15 minutos (ver DEPLOY.md 6c) y la apertura de la app hacen un backfill de seguridad.

**Garmin**: en Garmin Connect → Configuración → Aplicaciones conectadas → Strava. Garmin no da acceso nuevo a su API (programa pausado), así que Strava es la vía oficial.

### Fitbit / Pixel Watch / Health Connect: Google Health API

Se conecta con un click (consentimiento incremental sobre el login de Google) y trae:
- pasos, distancia, energía activa y FC en reposo por día (`dataPoints:dailyRollUp`);
- **sesiones de ejercicio** (`exercise`): lo que grabó el reloj y lo que cualquier app escribió en Health Connect (Strava, Garmin Connect, Samsung Health…), con duración, distancia, kcal y FC media. Si la misma sesión también llega por Strava, se fusionan por horario;
- peso, % grasa, altura y sueño.

**Cómo llega, de más rápido a más lento:**
1. **Webhook** (DEPLOY.md 6b): Google avisa segundos después de que el teléfono sincroniza y Tilo trae solo los días que cambiaron. La web se actualiza sola (Realtime), VSCode en el próximo refresco (5 min o al volver a la ventana).
2. **Sync cada 15 minutos** (DEPLOY.md 6c), por si un aviso se perdió.
3. **Al abrir** la web o VSCode, y mientras están abiertos (cada 10 minutos), si la última sincronización tiene más de 10 minutos.

Lo que no controla Tilo: el teléfono tiene que haber sincronizado con Google (Fitbit / Google Health app abierta o en segundo plano). Si una actividad de Strava no aparece, lo más directo es conectar Strava a Tilo (arriba): es instantáneo y no depende del teléfono.

El token de Google Health se guarda con sus permisos acotados y se reutiliza hasta que vence; cada sync son 4 pedidos de rollups + 5 de sesiones y medidas, en paralelo.

> **Google Fit** no se integra: Google cierra sus APIs a fines de 2026 y no acepta apps nuevas desde mayo de 2024.
>
> **Android (Health Connect)**: ya entra por Google Health (el teléfono sube Health Connect a Google).
>
> **Apple Health** no tiene API web: Apple solo deja salir los datos desde el iPhone. Dos caminos gratis, los dos contra `/api/v1/ingest`:
> 1. **Atajo de iOS (sin apps).** Settings → VSCode y MCP → Generar token. En Atajos: *Buscar muestras de salud* (Pasos, hoy) → *Obtener estadísticas* (suma) → repetir para Distancia, Energía activa, FC en reposo → *Diccionario* `{source: "apple", device: "Apple Watch", daily: [{date, steps, distance_m, active_kcal, resting_hr}]}` → *Obtener contenido de URL* POST `https://<tu-tilo>/api/v1/ingest`, cabecera `Authorization: Bearer tilo_…`, cuerpo JSON. Automatización → *Hora del día*, varias (por ejemplo 9, 13, 18 y 23 h), *Ejecutar inmediatamente* sin preguntar. iOS no tiene disparador "nuevo dato de salud", por eso el horario.
> 2. **Health Auto Export** (App Store): Automations → REST API → la misma URL y cabecera; manda su JSON tal cual y Tilo lo entiende. Las automatizaciones son parte de la versión paga de esa app.

### Formato de `/api/v1/ingest` (para integraciones futuras)

```jsonc
{
  "source": "apple" | "google_health" | "health_connect" | "strava" | "garmin" | "manual",
  "device": "Apple Watch",
  "timezone": "America/Argentina/Buenos_Aires",
  "daily": [{ "date": "2026-10-08", "steps": 8432, "distance_m": 6100, "active_kcal": 520, "resting_kcal": 1700, "resting_hr": 54, "hrv_ms": 61, "sleep_min": 425 }],
  "activities": [{ "external_id": "abc", "type": "run", "name": "Fondo", "start_at": "2026-10-08T10:10:00Z", "end_at": "2026-10-08T10:44:00Z", "distance_m": 6200, "kcal": 410, "kcal_is_net": true, "avg_hr": 151 }],
  "weights": [{ "date": "2026-10-08", "kg": 78.6, "body_fat_pct": 15 }]
}
```

También acepta tal cual el JSON que manda Health Auto Export.
