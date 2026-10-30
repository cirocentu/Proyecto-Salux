# Guía de despliegue: Supabase (base de datos) + Vercel (app)

Arquitectura: **un solo proyecto de Vercel** sirve el frontend (Vite) y la API (`/api/*`, una función con Express) bajo el mismo dominio. Eso evita CORS y permite que la cookie de sesión (`SameSite=strict`) funcione. La base es PostgreSQL en Supabase, a la que la app se conecta directo con Prisma (no usa la API REST de Supabase).

```
Navegador ──► Vercel (mismo dominio)
              ├─ /            → frontend estático (dist/)
              └─ /api/*       → función api/index.js (Express + Prisma) ──► Supabase (PostgreSQL)
Vercel Cron ──► /api/cron/mantenimiento (1 vez por día)
```

> Las cuentas, los proyectos y las contraseñas los creás vos en cada plataforma. Guardá todo en un gestor de contraseñas; **nunca** lo pegues en el repositorio.

---

## 1. Supabase

1. Entrá a <https://supabase.com> → **New project**.
   - **Region:** South America (São Paulo) (la más cercana a Argentina; Vercel está configurado en `gru1`, también São Paulo).
   - **Database password:** una larga y aleatoria. Guardala.
2. Cuando el proyecto esté listo, abrí **SQL Editor → New query**, pegá el contenido de [`backend/prisma/supabase-setup.sql`](../backend/prisma/supabase-setup.sql), **cambiá la contraseña** del rol `salux_app` y ejecutalo. Crea el rol propio de la app (sin superusuario).
3. En **Project Settings → Database → Connection string** (botón *Connect*) copiá dos cadenas y reemplazá usuario y contraseña por los del rol `salux_app` (el usuario del pooler es `salux_app.<id-del-proyecto>`):

   | Variable | Cadena | Para qué |
   |---|---|---|
   | `DATABASE_URL` | **Transaction pooler**, puerto `6543`, agregando al final `?pgbouncer=true&connection_limit=1` | La usa la app en Vercel |
   | `DIRECT_URL` | **Session pooler**, puerto `5432` | Solo para correr migraciones desde tu máquina |

   Ejemplo (los valores de `aws-0-…` los copiás del panel):
   ```
   DATABASE_URL="postgresql://salux_app.abcdefgh:LA_CLAVE@aws-0-sa-east-1.pooler.supabase.com:6543/postgres?pgbouncer=true&connection_limit=1"
   DIRECT_URL="postgresql://salux_app.abcdefgh:LA_CLAVE@aws-0-sa-east-1.pooler.supabase.com:5432/postgres"
   ```
   > Usá el *Session pooler* y no la conexión directa (`db.<id>.supabase.co`): esa es solo IPv6 y desde muchas redes domésticas no conecta.

## 2. Crear las tablas y el administrador

Desde tu máquina, en la carpeta `backend/`, definí las dos variables **solo en esa terminal** (no editás tu `.env`, así tu base local sigue intacta). Las variables de la terminal tienen prioridad sobre el `.env`, y cada script imprime a qué base se está conectando: **confirmá que dice `…pooler.supabase.com` antes de seguir**.

PowerShell:
```powershell
cd backend
$env:DATABASE_URL = "postgresql://salux_app.REF:CLAVE@aws-0-REGION.pooler.supabase.com:6543/postgres?pgbouncer=true&connection_limit=1"
$env:DIRECT_URL   = "postgresql://salux_app.REF:CLAVE@aws-0-REGION.pooler.supabase.com:5432/postgres"
npx prisma migrate deploy     # crea las tablas, índices y la seguridad (RLS)
node crearAdmin.js            # crea el administrador (ADMIN_EMAIL / ADMIN_PASSWORD de tu .env)
```

Git Bash:
```bash
cd backend
export DATABASE_URL="postgresql://salux_app.REF:CLAVE@aws-0-REGION.pooler.supabase.com:6543/postgres?pgbouncer=true&connection_limit=1"
export DIRECT_URL="postgresql://salux_app.REF:CLAVE@aws-0-REGION.pooler.supabase.com:5432/postgres"
npx prisma migrate deploy && node crearAdmin.js
```

Para tener médicos y pacientes de demostración (opcional, **no** con datos reales): `node seedDemo.js`.

Al cerrar la terminal las variables desaparecen (no queda nada guardado).

### Actualizar una app ya desplegada (cuando hay migraciones nuevas)

Si una actualización trae migraciones nuevas (carpetas nuevas en `backend/prisma/migrations/`), el orden importa:

1. **Primero la base**: con las dos variables de Supabase en la terminal (ver arriba), `npx prisma migrate deploy` desde `backend/`.
2. **Después el código**: mergear a `main` (Vercel despliega solo).

Las migraciones son **aditivas** (columnas nuevas, nulas): el código viejo sigue funcionando con la base ya migrada, pero el código nuevo **falla** si la base todavía no tiene las columnas. Por eso nunca al revés.

> Después de migrar, en Supabase → **Table Editor** vas a ver las tablas con el aviso "RLS enabled": es correcto y es lo que impide que la API pública de Supabase lea tus datos.

## 3. Vercel

1. <https://vercel.com> → **Add New → Project** → importá el repositorio de GitHub.
2. Configuración: **Framework Preset: Vite**, **Root Directory: `./`** (la raíz), el resto por defecto (`vercel.json` ya define build y rutas).
3. **Environment Variables** (Production). Las marcadas 🔒 son secretos:

   | Variable | Valor |
   |---|---|
   | `DATABASE_URL` 🔒 | la del *Transaction pooler* (paso 1.3) |
   | `DIRECT_URL` 🔒 | la del *Session pooler* (Prisma la pide al generar el cliente) |
   | `JWT_SECRET` 🔒 | 64 bytes aleatorios: `node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"` |
   | `JWT_REFRESH_SECRET` 🔒 | otro distinto, generado igual |
   | `NODE_ENV` | `production` |
   | `TRUST_PROXY` | `1` |
   | `CORS_ORIGIN` | la URL final, `https://TU-PROYECTO.vercel.app` (o tu dominio) |
   | `RATE_LIMIT_STORE` | `db` |
   | `CRON_SECRET` 🔒 | texto aleatorio largo (Vercel lo manda al cron) |
   | `REQUIERE_VERIFICACION_EMAIL` | `true` (necesita SMTP, ver paso 4) |
   | `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS` 🔒, `EMAIL_FROM` | ver paso 4 |

   La URL final solo la sabés después del primer deploy: hacé el primer deploy, copiá la URL, completá `CORS_ORIGIN` y volvé a desplegar (**Deployments → ⋯ → Redeploy**).
4. Probá: abrí la URL, iniciá sesión con el administrador. Si algo falla, **Deployments → Functions/Logs** muestra el motivo; si la configuración es insegura o incompleta, la función se niega a arrancar y el log dice exactamente qué falta.

### Qué hace distinto en Vercel
- **Tarea de mantenimiento** (cancelar turnos pendientes vencidos, limpiar sesiones y contadores): corre por **Vercel Cron una vez por día** (límite del plan gratuito). Si querés que corra cada 10 minutos, activá la extensión `pg_cron` de Supabase (Database → Extensions) y programá `select cron.schedule(...)` con el mismo SQL.
- **Límites de intentos** (login, registro...): se guardan en la tabla `RateLimitContador` de la base (en serverless no hay memoria compartida).
- **Emails**: se envían con `waitUntil` para que no se corten cuando termina la respuesta.

## 4. Emails con Brevo (después de tener la app desplegada)

Brevo necesita un **remitente verificado**, y lo ideal es un **dominio propio** (para que los mails no caigan en spam). Con la app ya desplegada:

1. Creá la cuenta en <https://www.brevo.com> y, en **Senders, domains & dedicated IPs**, verificá tu dominio (te da registros DNS: SPF, DKIM, DMARC) o, como mínimo, un remitente individual.
2. **SMTP & API → SMTP**: generá una clave SMTP. Servidor `smtp-relay.brevo.com`, puerto `587`, usuario = tu login SMTP de Brevo.
3. En Vercel cargá `SMTP_HOST=smtp-relay.brevo.com`, `SMTP_PORT=587`, `SMTP_USER`, `SMTP_PASS` y `EMAIL_FROM="Salux <no-reply@tudominio.com>"` y redesplegá. No hace falta tocar código.

## 5. Antes de usar datos reales
- Cambiá todas las contraseñas de prueba y la del administrador inicial (ver sección 6).
- Los datos de salud son **datos personales sensibles** (Ley 25.326 de Protección de Datos Personales): definí quién accede, para qué, y por cuánto tiempo se guardan.
- Los proyectos gratuitos de Supabase se **pausan por inactividad** y no tienen restauración a un punto en el tiempo: para uso real conviene un plan con backups (y, además, tené respaldos propios: sección 7).
- El plan *Hobby* de Vercel es solo para uso no comercial.

## 6. Secretos: separar desarrollo de producción

**La regla:** los valores de tu `backend/.env` son para tu máquina. Producción tiene que usar valores **distintos**, cargados únicamente en Vercel. Así, si ese archivo se filtra, se sincroniza a una nube o alguien mira tu pantalla, producción no se ve afectada.

### 6.1 Generar secretos nuevos para producción
Desde `backend/`:
```bash
npm run secretos
```
Imprime en la terminal (no crea archivos): `JWT_SECRET`, `JWT_REFRESH_SECRET`, `CRON_SECRET` y una contraseña sugerida para el administrador.

### 6.2 Cargarlos en Vercel
1. Vercel → proyecto → **Settings → Environment Variables**.
2. Para cada uno (`JWT_SECRET`, `JWT_REFRESH_SECRET`, `CRON_SECRET`): editá la variable existente (o creala), pegá el valor nuevo, marcá **Sensitive** y dejá tildado **solo Production**.
3. **Redeploy**. Se cierran todas las sesiones abiertas (una sola vez): es lo esperado.

> `CRON_SECRET` es importante: sin él la tarea diaria de mantenimiento queda deshabilitada y, además, esa tarea es lo que mantiene "despierto" al proyecto gratuito de Supabase (que se pausa tras una semana sin actividad).

### 6.3 Contraseña del administrador de producción
Entrá a la app como administrador → **Perfil → Cambiar contraseña** y poné una nueva (podés usar la sugerida por `npm run secretos`). Guardala en un gestor de contraseñas. **No hace falta** ponerla en ningún `.env`: la de `ADMIN_PASSWORD` solo se usa para crear el administrador la primera vez.

### 6.4 Sacar el proyecto de OneDrive
Si la carpeta del proyecto está dentro de OneDrive (`C:\Users\…\OneDrive\…`), el `.env` se sube a la nube de Microsoft aunque Git lo ignore. Se mueve así:

1. Cerrá el editor y detené Docker: `docker compose down` (sin `-v`; **los datos no se pierden**).
2. Creá una carpeta fuera de OneDrive, por ejemplo `C:\dev`, y cloná el repositorio ahí:
   ```bash
   cd C:\dev
   git clone https://github.com/LucioCanta/Salux-DesarrolloDeSoftware.git salux
   ```
3. Copiá **solo** `backend\.env` de la carpeta vieja a `C:\dev\salux\backend\.env`.
4. En la carpeta nueva: `npm ci` (en la raíz y en `backend/`) y `docker compose up -d --build` desde `backend/`. Como la carpeta se sigue llamando `backend`, Docker reutiliza el mismo volumen de datos.
5. Comprobá que todo anda (la app, el login, `npm test`).
6. Recién entonces borrá la carpeta vieja de OneDrive y vaciá la **papelera de OneDrive** (onedrive.live.com → Papelera).

> OneDrive conserva el **historial de versiones** y la papelera durante semanas. Por eso rotar los secretos de producción (6.1 a 6.3) es obligatorio aunque borres la carpeta: considerá comprometidos los valores que estuvieron ahí.

## 7. Respaldos
Guía completa, con las claves y el paso a paso: [`backend/scripts/respaldo/README.md`](../backend/scripts/respaldo/README.md).

- `bash backend/scripts/respaldo/respaldar.sh supabase` genera un respaldo **cifrado** de producción (necesita `RESPALDO_DATABASE_URL`).
- `restaurar.sh` lo restaura en una base nueva para comprobar que sirve. **Probalo al menos una vez.**
- Hay un workflow de GitHub (`respaldo.yml`) que lo hace cada día; viene apagado hasta que se carguen sus secretos.

## 8. Lista de verificación de las plataformas (se hace en cada sitio)
Cosas que el código no puede configurar por vos:

**Vercel**
- [ ] *Settings → Environment Variables*: los secretos (`DATABASE_URL`, `DIRECT_URL`, `JWT_*`, `SMTP_PASS`, `CRON_SECRET`) están tildados **solo en Production** y como **Sensitive**.
- [ ] Solo la rama `main` se despliega (`vercel.json` ya lo exige; en *Deployments* las demás ramas figuran como omitidas).
- [ ] *Settings → Deployment Protection*: dejala activada para los previews.
- [ ] 2FA activada en tu cuenta.

**Supabase**
- [ ] *Project Settings → Database → SSL Configuration*: **Enforce SSL on incoming connections** activado.
- [ ] *Project Settings → Data API*: la app no usa la API REST de Supabase; podés **deshabilitarla** por completo (defensa extra a las políticas RLS).
- [ ] *Database → Backups*: sabé qué plan tenés y qué respaldos incluye (ver sección 7).
- [ ] 2FA activada en tu cuenta.

**GitHub** (lo configura quien administra el repositorio)
- [ ] *Settings → Branches*: protección de `main` (exigir pull request y que el CI pase, no permitir *force push*).
- [ ] *Settings → Code security*: **Secret scanning** y **Push protection** activados (gratis en repositorios públicos), y **Dependabot alerts**.
- [ ] 2FA activada para todas las personas con acceso de escritura.
