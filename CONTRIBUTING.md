# Cómo colaborar en Salux

Gracias por sumarte. Este documento explica cómo trabajamos para que `main` esté siempre en condiciones de desplegarse: **cada cambio entra por un pull request y solo se mergea con el pipeline en verde**.

## Antes de empezar

1. Instalá Node 22+ (usamos 24: `.nvmrc`) y Docker.
2. Seguí la sección *Empezar en local* del [README](README.md).
3. Comprobá que todo anda antes de tocar nada:
   ```bash
   npm run lint && npm test && npm run build      # frontend
   cd backend && npm test                          # backend (necesita la base de Docker encendida)
   ```

## Flujo de trabajo

```
main  ──●──────────●────────────●──►   (siempre desplegable; Vercel publica solo main)
         \        /
          rama ──●──●──  → pull request → pipeline verde → revisión → merge
```

1. **Partí siempre de `main` actualizada** y creá una rama con un prefijo que diga qué es:
   `feat/…` (funcionalidad nueva), `fix/…` (corrección), `docs/…`, `test/…`, `chore/…` (mantenimiento), `refactor/…`.
   Ejemplo: `fix/reprogramar-turno-pasado`.
2. **Commits chicos y con sentido**, en español, con el formato `tipo(área): qué cambió y por qué`:
   ```
   fix(turnos): no se puede reprogramar un turno ya pasado
   feat(admin): confirmar antes de desactivar un médico con turnos
   test(a11y): guardia de contraste en alto contraste
   ```
   Tipos: `feat`, `fix`, `docs`, `test`, `refactor`, `chore`, `perf`. Explicá el **porqué** en el cuerpo del commit cuando no sea obvio.
3. **Abrí el pull request** hacia `main` con la plantilla que se carga sola. Un PR = un tema: si aparecen dos cosas, son dos PR.
4. **Esperá el pipeline.** Si falla, se arregla en la misma rama. No se mergea en rojo.
5. **Revisión.** Al menos una persona del equipo, que no sea quien escribió el cambio, lo revisa. Quien revisa mira: ¿cumple lo que dice?, ¿hay pruebas?, ¿se entiende?, ¿toca datos personales o permisos?
6. **Merge con *merge commit*.** La rama se borra después.

Nunca se hace `git push --force` sobre `main`.

## Qué tiene que tener un cambio para estar "terminado"

- [ ] Hace lo que dice el PR y no más.
- [ ] Tiene **pruebas**: una corrección de un error empieza con una prueba que falla; una regla de negocio nueva se documenta en [`docs/REGLAS-DE-NEGOCIO.md`](docs/REGLAS-DE-NEGOCIO.md).
- [ ] `npm run lint`, `npm test`, `npm run build` y `cd backend && npm test` pasan.
- [ ] Si toca pantallas: `npm run test:a11y` pasa y se probó **con el teclado** (Tab, Enter, Escape). Los textos cumplen contraste en los cuatro temas.
- [ ] No hay secretos, datos reales de pacientes ni archivos `.env` en el cambio.
- [ ] Los mensajes al usuario están en español rioplatense y no revelan detalles internos.

## Convenciones de código

- **Idioma:** código, comentarios, mensajes y documentación en español, como el resto del proyecto. Los comentarios explican el **porqué**, no el qué.
- **Estilo:** lo impone ESLint (`npm run lint`) y `.editorconfig`. No se discute el formato: se corre el lint.
- **Backend:** cada recurso tiene su `routes` → `schemas` (Zod) → `controllers`. Toda entrada se valida con Zod; los ids se leen con `parsearId` (nunca `parseInt`). Los errores se registran con `registrarError` (no loguea datos personales).
- **Fechas:** todo el negocio es hora de Argentina (UTC−3). Usá siempre `backend/src/utils/fechas.js`; nunca `getHours()` o `getDay()` del servidor.
- **Frontend:** los colores salen de los tokens de tema de `Dashboard.jsx` (no clases `dark:` sueltas, que siguen al sistema y no al tema elegido). Un clic en algo que no es un botón se hace con `<button>`.

## Base de datos y migraciones

- Los cambios de esquema se hacen en `backend/prisma/schema.prisma` y se generan con `npm run db:migrate:dev` (nombre en español, descriptivo).
- **Migraciones aditivas**: columnas nuevas nulas o con valor por defecto. Sirven para que el código viejo siga andando con la base ya migrada.
- **Orden de despliegue**: primero la migración en producción, después el merge a `main` (ver [`docs/DESPLIEGUE.md`](docs/DESPLIEGUE.md)). El pipeline avisa en el PR cuando hay migraciones nuevas.
- Nunca se edita una migración que ya está en `main`: se agrega otra.

## Seguridad

- **Jamás** subas contraseñas, tokens, cadenas de conexión ni `.env`. Si se te escapa un secreto, avisá enseguida: se **rota** (no alcanza con borrarlo del historial).
- Las vulnerabilidades no se reportan en un issue público: seguí [`SECURITY.md`](SECURITY.md).
- Los datos de pacientes son sensibles: en pruebas y capturas se usan datos inventados.

## Configuración del repositorio (para quien lo administra)

Para que las reglas de arriba se cumplan solas, en *Settings* del repositorio:

- **Branches → rule para `main`**: exigir pull request, exigir que pase el chequeo **`CI OK`** (resume todo el pipeline), y no permitir *force push* ni borrar la rama.
- **Code security**: activar *Dependency graph*, *Secret scanning*, *Push protection*, *Dependabot alerts* y, si no lo hace el workflow `seguridad.yml`, *private vulnerability reporting*.
- **Variables de Actions**: con el Dependency graph activo, crear la variable `REVISION_DEPENDENCIAS=true` para encender la revisión de dependencias nuevas de cada PR (`seguridad.yml`).
- **General**: activar *Automatically delete head branches*.
- Activar la verificación en dos pasos (2FA) para todas las personas con permiso de escritura.

## Dudas

Abrí un *issue* con la plantilla que corresponda, o preguntá en el pull request.
