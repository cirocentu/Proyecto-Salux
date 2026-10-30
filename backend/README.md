# Salux Backend

API REST del sistema de gestión de turnos médicos Salux, construida con Express, Prisma y PostgreSQL.

Visión general del proyecto: [README principal](../README.md) · reglas de los turnos: [`docs/REGLAS-DE-NEGOCIO.md`](../docs/REGLAS-DE-NEGOCIO.md) · arquitectura: [`docs/ARQUITECTURA.md`](../docs/ARQUITECTURA.md).

## Requisitos

- Node.js 22 o superior (la imagen de Docker usa 24)
- PostgreSQL 14+ (local en Docker o gestionado: Supabase, Neon, etc.)
- Docker + Docker Compose (opcional, para levantar todo con un comando)

## Configuración

1. Copiá `.env.example` a `.env` y completá los valores reales:

```bash
cp .env.example .env
```

2. Generá secretos fuertes para JWT:

```bash
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
```

3. Instalá dependencias (esto también genera el cliente de Prisma vía `postinstall`):

```bash
npm install
```

4. Aplicá las migraciones a la base de datos:

```bash
npm run db:migrate
```

5. (Opcional) Creá el usuario administrador inicial usando las variables `ADMIN_*` del `.env`:

```bash
npm run db:seed
```

## Desarrollo local

```bash
npm run dev
```

El servidor levanta en `http://localhost:3000` (o el puerto definido en `PORT`).

## Con Docker Compose

Levanta la base de datos PostgreSQL y el backend juntos, aplicando migraciones automáticamente:

```bash
docker compose up --build
```

Levanta tres servicios: PostgreSQL, Redis (contadores de los límites de intentos, sin puerto publicado) y el backend.

Cómo está endurecido (y por qué no conviene aflojarlo):

- **El backend no lee todo el `.env`.** Recibe solo las variables que usa, listadas en el bloque `environment` de `docker-compose.yml`. No le llegan `ADMIN_PASSWORD`, `POSTGRES_PASSWORD` ni las cuentas de prueba: si alguien lograra ejecutar código dentro del contenedor, no se llevaría esas credenciales. **Si agregás una variable nueva que el servidor necesite, sumala a ese bloque** (y a la lista del test `test/unit/infraestructura.test.js`).
- **Los puertos solo escuchan en `127.0.0.1`**: nadie en tu red puede llegar a la API ni a la base.
- **Contenedor del backend**: usuario sin privilegios, sistema de archivos de solo lectura, sin capacidades del kernel, con límites de procesos y memoria, y con `HEALTHCHECK`.
- **La imagen** usa Node 24 (LTS), arranca en `NODE_ENV=production` y solo contiene `src/`, `prisma/` y las dependencias de producción: sin tests, sin `crearAdmin.js`/`seedDemo.js` ni archivos sueltos. El compose de desarrollo usa `NODE_ENV=development` a propósito.
- Los scripts `crearAdmin.js`, `seedDemo.js` y `verificarEmailManual.js` se corren **desde tu máquina**, no dentro del contenedor.
- Respaldos cifrados de la base: `scripts/respaldo/` (ver su README).

### Rol de base de datos de la app

La app no se conecta con el superusuario `postgres`: usa el rol `salux_app`, dueño de `salux_db` y nada más. En una instalación nueva, `docker-compose` lo crea solo (script `docker/postgres-init/01-crear-rol-app.sh`) a partir de `DB_APP_USER` / `DB_APP_PASSWORD`. Si ya tenés un volumen de datos creado, el script no vuelve a correr; creá el rol a mano una vez:

```bash
docker exec -it salux_db_container psql -U postgres -d salux_db
```
```sql
CREATE ROLE salux_app LOGIN PASSWORD 'LA_CONTRASEÑA_DE_DB_APP_PASSWORD' NOSUPERUSER NOCREATEROLE CREATEDB;
ALTER DATABASE salux_db OWNER TO salux_app;
```

### Recrear el entorno desde cero

Para empezar de nuevo (o si venís de la versión con MySQL, que ya no se usa):

```bash
cd backend
docker compose down -v          # borra los contenedores Y los datos locales
docker compose up -d --build    # crea la base, el rol de la app, salux_test y aplica las migraciones
node crearAdmin.js              # administrador (usa ADMIN_* de tu .env)
node seedDemo.js                # opcional: especialidades, un médico y un paciente de prueba
```

- Los scripts imprimen a qué base se conectan: tiene que decir `localhost`.
- En Windows, los scripts `.sh` necesitan finales de línea LF; el repo lo fuerza con `.gitattributes`.
  Si ves `/bin/sh^M: bad interpreter`, hacé `git pull`, borrá `backend/docker/postgres-init/01-crear-rol-app.sh`,
  restauralo con `git checkout -- backend/docker/postgres-init/01-crear-rol-app.sh` y repetí los pasos.
- Los volúmenes viejos de MySQL (`backend_mysql_data`, etc.) ya no se usan; podés borrarlos con `docker volume rm`.

### Datos de demostración

La base arranca vacía. Para cargar el administrador y datos de prueba:

```bash
node crearAdmin.js   # administrador (ADMIN_* del .env)
node seedDemo.js     # especialidades + médico y paciente de prueba (PRUEBA_* del .env)
```

## Tests

Corren con el runner nativo de Node (`node --test`) y `supertest`; no hace falta instalar nada más.

```bash
cd backend
npm run test:unit          # sin base de datos (política de contraseñas, fechas, esquemas, emails, validación de entorno)
npm run test:integration   # la API completa contra PostgreSQL (auth, roles, turnos, especialidades, cron)
npm test                   # ambos
```

Los de integración usan una base **aparte**, `salux_test`, para no tocar tus datos. En una instalación nueva
del Postgres de Docker se crea sola. Si tu volumen es anterior a este cambio, creala una vez:

```bash
docker exec salux_db_container psql -U postgres -c "create database salux_test owner salux_app"
```

`npm run test:integration` aplica las migraciones a esa base y borra su contenido en cada archivo de test.
**Por seguridad se niegan a correr** si la base no es local o su nombre no termina en `_test`
(nunca van a tocar `salux_db` ni Supabase). Para usar otra base local: `TEST_DATABASE_URL=postgresql://...`.

Los emails no se envían en los tests (sin SMTP solo se registran en consola).

## Variables de entorno

| Variable | Descripción |
|---|---|
| `DATABASE_URL` | Cadena de conexión PostgreSQL de la app. Tiene que usar el rol `salux_app`, nunca el superusuario |
| `DIRECT_URL` | Conexión para migraciones de Prisma (en local, igual que `DATABASE_URL`) |
| `POSTGRES_PASSWORD` | Password del superusuario `postgres` (solo para administrar el servidor y el healthcheck) |
| `DB_APP_USER` / `DB_APP_PASSWORD` | Rol de la app, dueño de `salux_db` y nada más |
| `REDIS_PASSWORD` | Password del Redis de docker-compose (límites de intentos compartidos) |
| `REDIS_URL` | Opcional fuera de Docker. Sin él (y sin `RATE_LIMIT_STORE=db`) los límites de intentos quedan en memoria |
| `RATE_LIMIT_STORE` | `db` guarda los contadores de límites en la base (necesario en Vercel) |
| `CRON_SECRET` | Habilita `/api/cron/mantenimiento` (tarea periódica en Vercel) |
| `JWT_SECRET` / `JWT_REFRESH_SECRET` | Secretos para firmar tokens JWT (mínimo 32 caracteres, distintos entre sí) |
| `PORT` | Puerto donde escucha el servidor (default `3000`) |
| `NODE_ENV` | `development` o `production` |
| `TRUST_PROXY` | Cantidad de proxies delante del servidor. Vacío si se expone directo (obligatorio en producción) |
| `CORS_ORIGIN` | Origen(es) del frontend permitidos, separados por coma (https en producción) |
| `REQUIERE_VERIFICACION_EMAIL` | `true`: las cuentas nuevas deben confirmar su email y el registro no revela cuentas existentes |
| `FORZAR_HTTPS` | En producción redirige HTTP a HTTPS (default `true`) |
| `SMTP_*`, `EMAIL_FROM` | Envío de emails (reseteo, verificación, turnos) |
| `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `ADMIN_NOMBRE`, `ADMIN_DNI` | Usados solo por `crearAdmin.js` |

## Endpoints principales

- `POST /api/auth/register` — Registro de paciente
- `POST /api/auth/login` — Login con `identificador` (email o DNI) y `contrasena` (devuelve JWT)
- `GET /api/auth/perfil` — Perfil del usuario autenticado
- `GET /api/especialidades` — Listar especialidades
- `POST /api/especialidades` — Crear especialidad (solo admin)
- `GET /api/medicos` — Listar médicos
- `POST /api/medicos` — Registrar médico (solo admin)
- `PATCH /api/pacientes/perfil` — Actualizar perfil del paciente logueado
- `POST /api/turnos` — Reservar turno
- `GET /api/turnos/mis-turnos` — Turnos del paciente logueado
- `GET /api/turnos/agenda-medico` — Agenda del médico logueado
- `PATCH /api/turnos/:id` — Cambiar estado de un turno (paciente dueño, médico dueño o admin)
- `GET /api/health` — Estado del servidor y conexión a la base de datos

## Seguridad

- **Sesiones:** cada inicio de sesión es una fila en la tabla `Sesion`. Cerrar sesión, cambiar o resetear la contraseña las borra y los tokens dejan de valer al instante. `POST /api/auth/logout-todas` cierra todas.
- **Contraseñas:** mínimo 10 caracteres, con letras y números, sin contraseñas comunes ni datos de la cuenta (nombre, email, DNI) — ver `src/utils/politicaContrasena.js`.
- **Cuentas creadas por el admin** (médicos): arrancan con una contraseña inicial y la API solo les deja ver su perfil y cambiarla hasta que lo hagan.
- **Verificación de email** (`REQUIERE_VERIFICACION_EMAIL=true`): una cuenta nueva no puede ingresar hasta confirmar su email, y el registro responde igual exista o no el email/DNI.
  Todo fallo de login (cuenta inexistente, contraseña incorrecta o cuenta sin verificar) devuelve el mismo mensaje, para que el login tampoco revele qué cuentas existen. Para probar con emails inventados (que nunca recibirían el enlace) usá `node verificarEmailManual.js correo@ejemplo.com`.
- **Límites de intentos:** login (por IP+cuenta y por IP, solo cuentan los fallidos), registro, reseteo, verificación y cambio de contraseña. Con Redis o `RATE_LIMIT_STORE=db` se comparten entre instancias y sobreviven a un reinicio. El límite general de la API (300 por 15 min, `API_LIMITE_PETICIONES`) también vive en la base en Vercel.
- **Fuerza bruta distribuida:** además del límite por IP, cada cuenta admite como máximo 30 contraseñas incorrectas cada 15 min **desde cualquier IP** (`LOGIN_FALLOS_POR_CUENTA`); superado, el login responde 429 aun con la clave correcta. Recuperar la contraseña sigue disponible. Cuenta existente o no, la respuesta es la misma.
- **Correos que dispara cualquiera** (recuperar contraseña, reenviar verificación, aviso de registro duplicado) tienen límites por dirección — espera mínima de 5 min (`CORREO_ESPERA_MINUTOS`), tope de 6 por día (`CORREOS_POR_DIA_Y_DIRECCION`) y un presupuesto diario global (`CORREOS_ABUSABLES_POR_DIA`, 100) — para que nadie pueda llenar una casilla, anular el enlace de otra persona repitiendo el pedido ni agotar la cuota del proveedor de email. Los correos de turnos no pasan por estos límites. Ver `src/utils/limiteCorreos.js`.
- **Rotación del refresh token:** cada renovación entrega un token nuevo y el anterior deja de valer. Si alguien presenta uno ya reemplazado (señal de que se copió la cookie) la sesión se revoca entera. Hay 10 s de tolerancia para dos pestañas que renuevan a la vez. Máximo 10 sesiones simultáneas por usuario.
- **Logs sin datos personales:** los errores se registran con `registrarError` (`src/utils/registrarError.js`), que descarta los valores que Prisma incluye en sus mensajes (emails, nombres, DNI).
- Al arrancar se valida la configuración (`src/config/validarEntorno.js`): en producción el servidor **no inicia** con secretos débiles, `root` como usuario de base, `CORS_ORIGIN` sin https o sin `TRUST_PROXY`.

## Despliegue en producción

> Para publicar en **Vercel + Supabase** seguí la guía paso a paso: [`docs/DESPLIEGUE.md`](../docs/DESPLIEGUE.md). Lo de abajo es el resumen genérico para otro hosting.

1. Configurá las variables de entorno en la plataforma elegida (Render, Railway, Fly.io, etc.), incluyendo `DATABASE_URL` apuntando a tu PostgreSQL gestionado y `CORS_ORIGIN` con el dominio real del frontend.
2. Comando de build: `npm install` (ejecuta `prisma generate` automáticamente).
3. Antes de arrancar, corré las migraciones: `npm run db:migrate`.
4. Comando de arranque: `npm start`.
5. Asegurate de que `NODE_ENV=production`: los errores no exponen detalles internos, la cookie de sesión pasa a `Secure` y el servidor redirige HTTP a HTTPS.

### Checklist de producción

- [ ] HTTPS terminado en un proxy inverso (Nginx, Render, Railway...) y `TRUST_PROXY` con la cantidad de proxies (normalmente `1`).
- [ ] `CORS_ORIGIN` con el dominio real del frontend, en `https://`.
- [ ] `DATABASE_URL` con un usuario limitado a la base de la app (no `root`) y una contraseña fuerte.
- [ ] `JWT_SECRET` y `JWT_REFRESH_SECRET` distintos y de al menos 32 caracteres aleatorios.
- [ ] `REQUIERE_VERIFICACION_EMAIL=true` con SMTP funcionando (idealmente un servicio transaccional).
- [ ] `REDIS_URL` configurado si hay más de una instancia del backend.
- [ ] Cambiar las contraseñas de prueba y la del administrador inicial.
- [ ] Backups de la base de datos y su restauración probada.
