# Política de seguridad

Salux maneja datos de salud, que son datos personales sensibles (Ley 25.326). Tomamos en serio cualquier reporte de seguridad.

## Cómo reportar una vulnerabilidad

**No abras un issue público.** Usá el reporte privado de GitHub:

1. Entrá a la pestaña **Security** del repositorio.
2. Elegí **Report a vulnerability**.
3. Contá qué encontraste, cómo reproducirlo y qué impacto creés que tiene. Si hay datos de personas reales, no los incluyas.

Si esa opción no estuviera disponible, escribile directamente a quien administra el repositorio por un canal privado.

Qué esperar: acuse de recibo en pocos días hábiles, una evaluación y, si corresponde, una corrección antes de divulgar el problema. Se agradece el aviso responsable.

## Alcance

Está dentro del alcance todo lo de este repositorio y la aplicación desplegada: autenticación y sesiones, control de acceso entre roles (paciente, médico, administrador), exposición de datos personales, inyecciones, y configuración de la infraestructura descrita en [`docs/DESPLIEGUE.md`](docs/DESPLIEGUE.md).

Fuera de alcance: ataques de denegación de servicio por volumen, ingeniería social contra el equipo y vulnerabilidades de los proveedores (Vercel, Supabase, Brevo), que deben reportarse a ellos.

## Versiones con soporte

Solo la rama `main` y lo que está desplegado a partir de ella.

## Medidas implementadas

El detalle técnico está en [`backend/README.md`](backend/README.md#seguridad) y [`docs/ARQUITECTURA.md`](docs/ARQUITECTURA.md). Resumen:

- Sesiones revocables, tokens de vida corta y rotación del refresh token con detección de reutilización.
- Límites de intentos por IP y por cuenta, y límites de correos por destinatario.
- Validación estricta de toda entrada, contraseñas con política mínima, mensajes que no revelan si una cuenta existe.
- Base de datos con un rol sin privilegios, RLS en Supabase, logs sin datos personales y respaldos cifrados.
- Contenedor sin root, cabeceras de seguridad estrictas (CSP, HSTS, aislamiento de origen) y secretos solo en la plataforma.
- Pipeline con revisión de dependencias, análisis de código (CodeQL) y Dependabot.

## Riesgos conocidos y aceptados

| Tema | Detalle | Por qué se acepta |
|---|---|---|
| `zod` (aviso GHSA-mrhx-c7xc-m3w5) | `npm audit` marca `zod` por un agotamiento de memoria al validar arreglos enormes **en Zod 4**. El proyecto usa Zod 3 (la versión 4 solo aparece dentro de las herramientas de Vercel, fuera del camino de los pedidos) y todos los arreglos que acepta la API tienen tope de tamaño; además el cuerpo de cada pedido está limitado a 10 KB. | La actualización a Zod 4 es un cambio mayor que no corrige nada que nos afecte hoy. Se revisa en la próxima actualización de dependencias. |
