const test = require('node:test');
const assert = require('node:assert/strict');
const { validarEntorno } = require('../../src/config/validarEntorno');

const secreto = (letra) => letra.repeat(40);

const entornoValido = () => ({
  NODE_ENV: 'production',
  JWT_SECRET: secreto('a'),
  JWT_REFRESH_SECRET: secreto('b'),
  DATABASE_URL: 'postgresql://salux_app.proyecto:clave@aws-1-sa-east-1.pooler.supabase.com:6543/postgres',
  CORS_ORIGIN: 'https://salux.vercel.app',
  TRUST_PROXY: '1',
  REQUIERE_VERIFICACION_EMAIL: 'true',
  SMTP_HOST: 'smtp-relay.brevo.com',
  RATE_LIMIT_STORE: 'db',
});

test('una configuración de producción correcta no tiene errores ni avisos', () => {
  const { errores, avisos } = validarEntorno(entornoValido());
  assert.deepEqual(errores, []);
  assert.deepEqual(avisos, []);
});

test('faltan los secretos JWT', () => {
  const { errores } = validarEntorno({ DATABASE_URL: 'x' });
  assert.ok(errores.some((e) => e.includes('JWT_SECRET')));
  assert.ok(errores.some((e) => e.includes('JWT_REFRESH_SECRET')));
});

test('rechaza secretos cortos o de ejemplo', () => {
  const corto = validarEntorno({ ...entornoValido(), JWT_SECRET: 'corto' });
  assert.ok(corto.errores.some((e) => e.includes('JWT_SECRET')));
  const ejemplo = validarEntorno({ ...entornoValido(), JWT_SECRET: `GENERA_UN_STRING_${'x'.repeat(40)}` });
  assert.ok(ejemplo.errores.some((e) => e.includes('JWT_SECRET')));
});

test('el secreto de acceso y el de refresh tienen que ser distintos', () => {
  const { errores } = validarEntorno({ ...entornoValido(), JWT_REFRESH_SECRET: secreto('a') });
  assert.ok(errores.some((e) => e.includes('distintos')));
});

test('en producción exige DATABASE_URL de PostgreSQL', () => {
  const { errores } = validarEntorno({ ...entornoValido(), DATABASE_URL: 'mysql://u:p@host/db' });
  assert.ok(errores.some((e) => e.includes('PostgreSQL')));
});

test('en producción CORS_ORIGIN es obligatorio y debe ser https', () => {
  assert.ok(validarEntorno({ ...entornoValido(), CORS_ORIGIN: '' }).errores.some((e) => e.includes('CORS_ORIGIN')));
  assert.ok(validarEntorno({ ...entornoValido(), CORS_ORIGIN: 'http://salux.com' }).errores.some((e) => e.includes('https')));
});

test('en producción exige TRUST_PROXY numérico', () => {
  assert.ok(validarEntorno({ ...entornoValido(), TRUST_PROXY: '' }).errores.some((e) => e.includes('TRUST_PROXY')));
  assert.ok(validarEntorno({ ...entornoValido(), TRUST_PROXY: 'true' }).errores.some((e) => e.includes('TRUST_PROXY')));
});

test('avisa (sin bloquear) si no se verifica el email, falta SMTP o el límite es por instancia', () => {
  const { errores, avisos } = validarEntorno({
    ...entornoValido(), REQUIERE_VERIFICACION_EMAIL: 'false', SMTP_HOST: '', RATE_LIMIT_STORE: '',
  });
  assert.deepEqual(errores, []);
  assert.equal(avisos.length, 3);
});

test('avisa si la app usa el superusuario postgres', () => {
  const { avisos } = validarEntorno({ ...entornoValido(), DATABASE_URL: 'postgresql://postgres:clave@host:5432/postgres' });
  assert.ok(avisos.some((a) => a.includes('superusuario')));
});

test('en Vercel avisa si falta CRON_SECRET', () => {
  const { avisos } = validarEntorno({ ...entornoValido(), VERCEL: '1' });
  assert.ok(avisos.some((a) => a.includes('CRON_SECRET')));
});

test('en desarrollo no exige las reglas de producción', () => {
  const { errores } = validarEntorno({
    NODE_ENV: 'development', JWT_SECRET: secreto('a'), JWT_REFRESH_SECRET: secreto('b'),
    DATABASE_URL: 'postgresql://u:p@localhost:5432/db',
  });
  assert.deepEqual(errores, []);
});
