# Respaldos de la base de datos

Respaldos **cifrados** de Postgres, con una sola dependencia: `openssl` (viene con Git Bash) y Docker.
El volcado nunca se escribe sin cifrar en disco: va de `pg_dump` a `openssl` por una tubería.

> **Por qué importa.** El plan gratuito de Supabase **no incluye backups descargables** y pausa el
> proyecto tras una semana sin actividad. Verificá tu plan en *Supabase → Database → Backups*. Si
> no tenés backups propios, un error de borrado o un problema en Supabase puede significar perder
> todos los datos.

## 1. Generar las claves (una sola vez)

```bash
bash backend/scripts/respaldo/generar-claves.sh C:/dev/claves-salux
```

Crea dos archivos:

| Archivo | Para qué | Dónde guardarlo |
|---|---|---|
| `salux-respaldo-publica.pem` | **Cifra** los respaldos. No es secreto. | Junto a los scripts o como secreto de GitHub |
| `salux-respaldo-privada.pem` | **Descifra**. Es lo único que permite leer un respaldo. | Gestor de contraseñas o pendrive. **Fuera del repo y fuera de OneDrive.** |

**Si perdés la clave privada, los respaldos no se pueden recuperar.** Hacé una copia en un segundo lugar.

## 2. Respaldar

```bash
# Tu base de desarrollo (Docker):
bash backend/scripts/respaldo/respaldar.sh local

# Producción (Supabase), desde tu máquina:
export RESPALDO_DATABASE_URL="postgresql://salux_app.REF:CLAVE@aws-1-sa-east-1.pooler.supabase.com:5432/postgres"
bash backend/scripts/respaldo/respaldar.sh supabase
```

- Usá la URL del **Session pooler (puerto 5432)**; `pg_dump` no funciona con el pooler de transacciones (6543).
- Variables opcionales: `RESPALDO_CERTIFICADO` (ruta del certificado público) y `RESPALDO_SALIDA` (carpeta de salida, por defecto `./respaldos`). **Elegí una carpeta fuera de OneDrive.**
- Incluye todo el esquema `public`. **No** incluye el contenido de `Sesion` ni de `RateLimitContador` (tokens y contadores efímeros: no sirven y son sensibles).
- Si algo falla, el script borra el archivo a medias: nunca deja algo que parezca un respaldo válido sin serlo.

## 3. Restaurar (y comprobar que el respaldo sirve)

```bash
bash backend/scripts/respaldo/restaurar.sh respaldos/salux_supabase_20261023-061700.dump.enc C:/dev/claves-salux/salux-respaldo-privada.pem salux_restaurada
docker exec -it salux_db_container psql -U postgres -d salux_restaurada
```

Restaura en una base **nueva** del Postgres local: nunca pisa una existente, y si algo falla borra la que creó.
**Un respaldo que nunca se probó restaurar no es un respaldo.** Probalo una vez ahora y cada tanto.

## 4. Respaldo automático diario (opcional)

El workflow `.github/workflows/respaldo.yml` hace el respaldo cada día a las 03:17 (hora de Argentina) y
guarda el archivo **cifrado** durante 14 días. Viene **apagado**. Para activarlo, alguien con permiso de
administrador en el repositorio tiene que configurar en *Settings → Secrets and variables → Actions*:

| Tipo | Nombre | Valor |
|---|---|---|
| Secret | `RESPALDO_DATABASE_URL` | URL del Session pooler (puerto 5432) de Supabase |
| Secret | `RESPALDO_CERTIFICADO_PUBLICO` | Contenido completo de `salux-respaldo-publica.pem` |
| Variable | `RESPALDO_ACTIVO` | `true` |

Para bajar un respaldo: *Actions → Respaldo de la base → corrida → Artifacts*, y descifrarlo con `restaurar.sh`.

Cosas a tener en cuenta:
- **El repositorio es público**, y los artefactos de un repositorio público los puede descargar cualquier persona con cuenta de GitHub. Por eso están **cifrados**: sin la clave privada son bytes sin sentido. Nunca subas un respaldo sin cifrar.
- Quien administra el repositorio puede configurar y *usar* ese secreto en un workflow aunque no pueda verlo. Asegurate de que sea alguien de confianza, o preferí correr `respaldar.sh supabase` desde tu máquina (por ejemplo, con el Programador de tareas de Windows).
- El workflow solo corre por calendario o a mano, nunca por un pull request: los secretos no están al alcance de código de terceros.
