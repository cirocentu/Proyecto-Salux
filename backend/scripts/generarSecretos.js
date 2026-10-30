#!/usr/bin/env node
/**
 * generarSecretos.js
 * Genera valores nuevos y aleatorios para los secretos de PRODUCCIÓN.
 *
 * USO:   npm run secretos
 *
 * Los secretos de producción tienen que ser DISTINTOS de los de tu .env local: el .env
 * vive en tu máquina (y, si la carpeta está en OneDrive, también en la nube). Copiá estos
 * valores directo a Vercel → Settings → Environment Variables (marcalos como Sensitive)
 * y no los guardes en ningún archivo del proyecto.
 *
 * Este script solo escribe en la terminal; no crea archivos.
 */
const crypto = require('crypto');
const { problemasDeContrasena } = require('../src/utils/politicaContrasena');

const hex = (bytes) => crypto.randomBytes(bytes).toString('hex');

// Contraseña legible: solo letras y números (sin símbolos que rompan una URL), con al
// menos una letra y un número, y que cumple la política de la app.
function contrasena(largo = 20) {
  const letras = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz'; // sin I, O, l, o (se confunden)
  const numeros = '23456789';
  const todo = letras + numeros;
  for (;;) {
    const candidata = Array.from({ length: largo }, () => todo[crypto.randomInt(todo.length)]).join('');
    if (/[A-Za-z]/.test(candidata) && /\d/.test(candidata) && problemasDeContrasena(candidata).length === 0) return candidata;
  }
}

function generar() {
  return {
    JWT_SECRET: hex(64),
    JWT_REFRESH_SECRET: hex(64),
    CRON_SECRET: hex(32),
    // Contraseña inicial sugerida para el administrador de producción. Se cambia después
    // desde la app (Perfil → Cambiar contraseña); no hace falta guardarla en ningún .env.
    CONTRASENA_ADMIN_SUGERIDA: contrasena(20),
  };
}

module.exports = { generar, contrasena };

if (require.main === module) {
  console.log('Secretos nuevos para PRODUCCIÓN (Vercel → Settings → Environment Variables, tipo Sensitive):\n');
  for (const [nombre, valor] of Object.entries(generar())) console.log(`${nombre}=${valor}`);
  console.log('\nCambiar JWT_SECRET / JWT_REFRESH_SECRET cierra todas las sesiones abiertas (una sola vez).');
  console.log('Después de cargarlos en Vercel hacé Redeploy. No los pegues en el chat ni los guardes en el repo.');
}
