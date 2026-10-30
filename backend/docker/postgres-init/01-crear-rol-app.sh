#!/bin/sh
# Se ejecuta UNA sola vez, al crear el volumen de datos de PostgreSQL.
# Crea el rol de la aplicación: dueño de la base de la app y nada más
# (sin superusuario, sin crear roles). El superusuario `postgres` queda solo
# para administrar el servidor.
set -e
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-EOSQL
  CREATE ROLE "$DB_APP_USER" LOGIN PASSWORD '$DB_APP_PASSWORD' NOSUPERUSER NOCREATEROLE CREATEDB;
  ALTER DATABASE "$POSTGRES_DB" OWNER TO "$DB_APP_USER";
  -- Base aparte para los tests automáticos (npm test en backend/): nunca tocan salux_db.
  CREATE DATABASE salux_test OWNER "$DB_APP_USER";
EOSQL
