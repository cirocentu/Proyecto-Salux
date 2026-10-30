# Imagen del backend. Dos etapas: la primera instala las dependencias; la segunda
# copia solo lo necesario para correr (sin caché de npm, sin tests, sin scripts de
# desarrollo, sin motores de Prisma que esta imagen no usa).

# Node 24 es la versión LTS vigente. (Node 20 terminó su soporte en abril de 2026 y ya
# no recibe parches de seguridad.) Alpine usa musl: Prisma necesita OpenSSL, que esta
# imagen no trae por defecto.
FROM node:24-alpine AS dependencias
RUN apk add --no-cache openssl
WORKDIR /app

COPY package*.json ./
COPY prisma ./prisma

# `npm ci` ejecuta `prisma generate` (postinstall). Después se borran:
#  - la caché de npm (~70 MB que la imagen final no necesita);
#  - los motores de Prisma para RHEL/Vercel (se generan por el binaryTargets del schema,
#    pero esta imagen es Alpine y nunca los carga).
RUN npm ci --omit=dev \
    && npm cache clean --force \
    && find node_modules -name '*rhel-openssl*' -delete

FROM node:24-alpine
RUN apk add --no-cache openssl
WORKDIR /app

# Solo se copia lo que la app necesita (lista explícita, no `COPY . .`): así los tests,
# los scripts que crean cuentas (crearAdmin, seedDemo), el compose y cualquier archivo
# suelto que alguien deje en la carpeta no terminan dentro de la imagen.
COPY --from=dependencias /app/node_modules ./node_modules
COPY package*.json ./
COPY prisma ./prisma
COPY src ./src

# Por defecto, producción: cookies `Secure`, errores genéricos y validación estricta de la
# configuración. El docker-compose de desarrollo lo cambia a propósito (ver NODE_ENV allí).
ENV NODE_ENV=production

# No correr como root: si alguien lograra ejecutar código en la app, no tendría
# control del contenedor. La imagen oficial de Node trae el usuario `node`.
USER node

EXPOSE 3000

# Docker marca el contenedor como "unhealthy" si la API deja de responder (y los
# orquestadores pueden reiniciarlo). /api/health consulta también la base de datos.
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD wget -q -O /dev/null "http://127.0.0.1:${PORT:-3000}/api/health" || exit 1

CMD ["node", "src/app.js"]
