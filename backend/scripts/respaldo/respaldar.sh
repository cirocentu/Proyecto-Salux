#!/usr/bin/env bash
# Respalda la base de datos y deja el archivo CIFRADO. Nunca escribe el volcado sin cifrar
# en disco: va directo de pg_dump a openssl por una tubería.
#
# Uso:
#   bash respaldar.sh local      # la base de desarrollo (contenedor salux_db_container)
#   bash respaldar.sh supabase   # producción (necesita RESPALDO_DATABASE_URL)
#
# Variables:
#   RESPALDO_CERTIFICADO   certificado público (por defecto ./salux-respaldo-publica.pem)
#   RESPALDO_SALIDA        carpeta de salida (por defecto ./respaldos)
#   RESPALDO_DATABASE_URL  solo "supabase": URL del Session pooler (puerto 5432)
#   CONTENEDOR_DB          solo "local": nombre del contenedor (por defecto salux_db_container)
#
# Qué incluye: el esquema public completo. Qué NO incluye: el contenido de "Sesion" (tokens
# de sesión) ni de "RateLimitContador" (contadores efímeros): no sirven de respaldo y son
# datos sensibles.
set -euo pipefail

destino="${1:-}"
cert="${RESPALDO_CERTIFICADO:-salux-respaldo-publica.pem}"
salida="${RESPALDO_SALIDA:-./respaldos}"

if [ "$destino" != "local" ] && [ "$destino" != "supabase" ]; then
  echo "Uso: bash respaldar.sh local|supabase" >&2
  exit 2
fi
[ -f "$cert" ] || { echo "No encuentro el certificado público: $cert (generalo con generar-claves.sh)" >&2; exit 2; }

mkdir -p "$salida"
archivo="$salida/salux_${destino}_$(date -u +%Y%m%d-%H%M%S).dump.enc"
# Si algo falla a mitad de camino, no deja un archivo a medias que parezca un respaldo válido.
trap 'rc=$?; if [ $rc -ne 0 ]; then rm -f "$archivo"; echo "El respaldo FALLÓ (código $rc); no se guardó nada." >&2; fi' EXIT

opciones=(--format=custom --no-owner --no-privileges --schema=public
          --exclude-table-data='public."Sesion"' --exclude-table-data='public."RateLimitContador"')

# MSYS_NO_PATHCONV evita que Git Bash (Windows) reescriba argumentos que parecen rutas.
export MSYS_NO_PATHCONV=1

if [ "$destino" = "local" ]; then
  docker exec "${CONTENEDOR_DB:-salux_db_container}" pg_dump -U postgres -d salux_db "${opciones[@]}"
else
  : "${RESPALDO_DATABASE_URL:?Falta RESPALDO_DATABASE_URL (URL del Session pooler, puerto 5432)}"
  # pg_dump 17 puede respaldar servidores 15, 16 y 17. La URL se pasa por variable de entorno
  # (no por argumento) para que la contraseña no aparezca en la lista de procesos.
  docker run --rm -e RESPALDO_DATABASE_URL postgres:17-alpine \
    sh -c 'pg_dump "$RESPALDO_DATABASE_URL" "$@"' sh "${opciones[@]}"
fi | openssl smime -encrypt -binary -aes-256-cbc -stream -outform DER -out "$archivo" "$cert"

tamano=$(wc -c < "$archivo")
if [ "$tamano" -lt 2048 ]; then
  echo "El respaldo quedó sospechosamente chico ($tamano bytes)." >&2
  exit 1
fi
echo "Respaldo cifrado: $archivo ($tamano bytes)"
