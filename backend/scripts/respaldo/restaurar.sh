#!/usr/bin/env bash
# Restaura un respaldo cifrado en una base NUEVA del Postgres local (Docker), para revisarlo
# o para probar que el respaldo sirve. Nunca pisa una base existente.
#
# Uso: bash restaurar.sh <archivo.dump.enc> <clave-privada.pem> [nombre_de_la_base_nueva]
#      (por defecto: salux_restaurada)
set -euo pipefail

archivo="${1:-}"
clave="${2:-}"
base="${3:-salux_restaurada}"
contenedor="${CONTENEDOR_DB:-salux_db_container}"

[ -f "$archivo" ] && [ -f "$clave" ] || { echo "Uso: bash restaurar.sh <archivo.dump.enc> <clave-privada.pem> [base_nueva]" >&2; exit 2; }
[[ "$base" =~ ^[a-z_][a-z0-9_]*$ ]] || { echo "Nombre de base inválido (solo minúsculas, números y _)." >&2; exit 2; }
export MSYS_NO_PATHCONV=1

existe=$(docker exec "$contenedor" psql -U postgres -tAc "select 1 from pg_database where datname='$base'")
if [ "$existe" = "1" ]; then
  echo "La base '$base' ya existe: no la piso. Elegí otro nombre o borrala a propósito." >&2
  exit 1
fi

docker exec "$contenedor" psql -U postgres -c "create database $base" >/dev/null
# Si algo falla, se borra la base a medias que creó este script (una base ya existente nunca se toca).
trap 'rc=$?; if [ $rc -ne 0 ]; then docker exec "$contenedor" psql -U postgres -c "drop database if exists $base" >/dev/null 2>&1; echo "La restauración FALLÓ; se borró la base \"$base\" a medias." >&2; fi' EXIT
# --clean --if-exists: el volcado trae "CREATE SCHEMA public" y una base nueva ya lo tiene.
openssl smime -decrypt -binary -inform DER -in "$archivo" -inkey "$clave" \
  | docker exec -i "$contenedor" pg_restore -U postgres -d "$base" --no-owner --clean --if-exists --exit-on-error
echo "Restaurado en la base '$base' del contenedor $contenedor."
echo "Para revisarla:  docker exec -it $contenedor psql -U postgres -d $base"
