#!/usr/bin/env bash
# Genera el par de claves con el que se cifran los respaldos.
#   - El CERTIFICADO PÚBLICO cifra: no es secreto (va como secreto de GitHub o junto al script).
#   - La CLAVE PRIVADA descifra: es lo único que permite leer un respaldo. Guardala en un
#     gestor de contraseñas o en un pendrive, FUERA del repo y FUERA de carpetas sincronizadas
#     (OneDrive). Si la perdés, los respaldos no se pueden recuperar.
#
# Uso: bash generar-claves.sh [carpeta-de-salida]
set -euo pipefail
# Git Bash (Windows) reescribe argumentos que empiezan con "/" como si fueran rutas y
# rompe el "-subj /CN=...". Esto lo evita.
export MSYS_NO_PATHCONV=1

salida="${1:-.}"
mkdir -p "$salida"
privada="$salida/salux-respaldo-privada.pem"
publica="$salida/salux-respaldo-publica.pem"

if [ -e "$privada" ] || [ -e "$publica" ]; then
  echo "Ya existen claves en '$salida'. No las piso: usá otra carpeta o borralas a propósito." >&2
  exit 1
fi

# Autofirmado a 100 años: solo se usa como "sobre" de cifrado, no como identidad.
openssl req -x509 -newkey rsa:4096 -nodes -days 36500 -subj "/CN=salux-respaldo" \
  -keyout "$privada" -out "$publica"
chmod 600 "$privada" 2>/dev/null || true

echo "Listo:"
echo "  clave pública : $publica   (la usa respaldar.sh)"
echo "  clave PRIVADA : $privada   (GUARDALA a salvo y borrala de acá)"
