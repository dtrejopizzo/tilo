# Tilo para iPhone

App mínima que manda Apple Health a Tilo sola: iOS la despierta cuando Salud recibe datos nuevos
(HealthKit background delivery) y además cada hora aprox. Trae pasos, distancia, energía activa,
FC en reposo, HRV, sueño, peso y cada entrenamiento con kcal, distancia y FC reales, a `/api/v1/ingest`.

## Instalar en tu iPhone (gratis)

1. Instalá **Xcode** desde el App Store de la Mac y abrilo una vez (acepta componentes).
2. `cd integrations/ios && xcodegen` (si cambiaste `project.yml`; el `.xcodeproj` ya está generado) y abrí `TiloHealth.xcodeproj`.
3. Xcode → Settings → Accounts → **+** → tu Apple ID.
4. En el proyecto → target **TiloHealth** → **Signing & Capabilities** → Team: tu nombre (Personal Team).
   Si el bundle id choca, cambialo por uno tuyo (`com.tunombre.tilohealth`).
5. Conectá el iPhone por cable, elegilo arriba como destino y tocá **▶ Run**.
6. En el iPhone: Ajustes → Privacidad y seguridad → **Modo de desarrollador** → activar (reinicia).
   Después Ajustes → General → **VPN y gestión de dispositivos** → tu Apple ID → **Confiar**.
7. Abrí Tilo → **Iniciar sesión con Tilo** → **Conectar Apple Health** → activá todo.

Con un Apple ID gratis la app vence a los **7 días**: volvé a hacer Run desde Xcode (los datos y la
sesión se mantienen). Con la cuenta de desarrollador de Apple (US$99/año) dura un año y se puede
distribuir por TestFlight.
