// Prepara el entorno de los tests ANTES de cargar la app. Todo test que toque la
// base (o importe src/app.js) tiene que cargar esto primero.
//
// Regla de oro: los tests borran datos. Por eso solo corren contra una base
// LOCAL cuyo nombre termina en "_test"; si no se cumple, abortan antes de
// conectarse. Nunca van a tocar salux_db ni Supabase.
const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');

const archivoEnv = path.join(__dirname, '..', '.env');
const delEnv = fs.existsSync(archivoEnv) ? dotenv.parse(fs.readFileSync(archivoEnv)) : {};

function urlDeTest() {
  if (process.env.TEST_DATABASE_URL) return process.env.TEST_DATABASE_URL;
  const usuario = process.env.DB_APP_USER || delEnv.DB_APP_USER;
  const clave = process.env.DB_APP_PASSWORD || delEnv.DB_APP_PASSWORD;
  if (!usuario || !clave) {
    throw new Error('Definí TEST_DATABASE_URL (o DB_APP_USER/DB_APP_PASSWORD en backend/.env) para correr los tests de integración.');
  }
  return `postgresql://${encodeURIComponent(usuario)}:${encodeURIComponent(clave)}@127.0.0.1:5432/salux_test`;
}

function verificarQueEsUnaBaseDeTest(url) {
  let u;
  try {
    u = new URL(url);
  } catch {
    throw new Error('La URL de la base de test no es válida.');
  }
  const local = ['localhost', '127.0.0.1', '[::1]', '::1'].includes(u.hostname);
  const nombre = decodeURIComponent(u.pathname.replace(/^\//, ''));
  if (!local || !nombre.endsWith('_test')) {
    throw new Error(
      `Por seguridad los tests solo corren contra una base local cuyo nombre termine en "_test" ` +
      `(recibido: host "${u.hostname}", base "${nombre}"). No se borró nada.`
    );
  }
}

const url = urlDeTest();
verificarQueEsUnaBaseDeTest(url);

process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = url;
process.env.DIRECT_URL = url;
process.env.JWT_SECRET = 'test-jwt-secret-que-no-sirve-fuera-de-los-tests-0123456789';
process.env.JWT_REFRESH_SECRET = 'test-refresh-secret-distinto-y-solo-para-tests-9876543210';
process.env.CORS_ORIGIN = 'http://localhost:5173';
process.env.REQUIERE_VERIFICACION_EMAIL = 'false';
// Vacíos A PROPÓSITO (no `delete`): así el .env de desarrollo no puede rellenarlos.
// Sin SMTP los emails solo se loguean: los tests nunca mandan mails de verdad.
for (const nombre of ['SMTP_HOST', 'SMTP_USER', 'SMTP_PASS', 'REDIS_URL', 'RATE_LIMIT_STORE', 'CRON_SECRET', 'TRUST_PROXY', 'VERCEL']) {
  process.env[nombre] = '';
}

module.exports = { url };
