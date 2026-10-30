const test = require('node:test');
const assert = require('node:assert/strict');
const { registerSchema, loginSchema, cambiarContrasenaSchema } = require('../../src/schemas/auth.schema');
const { crearTurnoSchema, actualizarEstadoTurnoSchema } = require('../../src/schemas/turno.schema');
const { crearMedicoSchema } = require('../../src/schemas/medico.schema');

const registroValido = {
  email: '  Maria@Correo.COM ', dni: '30123456', contrasena: 'Zorro-Azul-4721', nomYape: '  María Gómez ',
};

test('registro: normaliza email (minúsculas, sin espacios) y nombre', () => {
  const r = registerSchema.parse(registroValido);
  assert.equal(r.email, 'maria@correo.com');
  assert.equal(r.nomYape, 'María Gómez');
});

test('registro: DNI de 7 a 9 dígitos', () => {
  for (const dni of ['123456', '1234567890', '12.345.678', 'abcdefgh']) {
    assert.equal(registerSchema.safeParse({ ...registroValido, dni }).success, false, `DNI "${dni}"`);
  }
  assert.equal(registerSchema.safeParse({ ...registroValido, dni: '1234567' }).success, true);
});

test('registro: contraseña floja o con datos de la cuenta se rechaza y se marca el campo contrasena', () => {
  const floja = registerSchema.safeParse({ ...registroValido, contrasena: 'password123' });
  assert.equal(floja.success, false);
  const conDni = registerSchema.safeParse({ ...registroValido, contrasena: 'Azul30123456x' });
  assert.equal(conDni.success, false);
  assert.ok(conDni.error.issues.some((i) => i.path.join('.') === 'contrasena'));
});

test('login: acepta email o DNI, rechaza cualquier otra cosa', () => {
  assert.equal(loginSchema.safeParse({ identificador: 'ana@correo.com', contrasena: 'x' }).success, true);
  assert.equal(loginSchema.safeParse({ identificador: '30123456', contrasena: 'x' }).success, true);
  assert.equal(loginSchema.safeParse({ identificador: 'no-es-un-mail', contrasena: 'x' }).success, false);
  assert.equal(loginSchema.safeParse({ identificador: '123', contrasena: 'x' }).success, false);
  assert.equal(loginSchema.safeParse({ identificador: 'ana@correo.com', contrasena: '' }).success, false);
});

test('cambio de contraseña: la nueva tiene que cumplir la política', () => {
  assert.equal(cambiarContrasenaSchema.safeParse({ contrasenaActual: 'x', contrasenaNueva: 'corta1' }).success, false);
  assert.equal(cambiarContrasenaSchema.safeParse({ contrasenaActual: 'x', contrasenaNueva: 'Zorro-Azul-4721' }).success, true);
});

test('turno: exige medicoId entero positivo y fecha ISO futura', () => {
  const enMinutoExacto = (ms) => new Date(Math.floor((Date.now() + ms) / 60000) * 60000).toISOString();
  const futura = enMinutoExacto(7 * 24 * 3600 * 1000);
  assert.equal(crearTurnoSchema.safeParse({ medicoId: 1, fechaYhora: futura }).success, true);
  assert.equal(crearTurnoSchema.safeParse({ medicoId: 2147483648, fechaYhora: futura }).success, false, 'fuera del rango de la base');
  assert.equal(crearTurnoSchema.safeParse({ medicoId: 0, fechaYhora: futura }).success, false);
  assert.equal(crearTurnoSchema.safeParse({ medicoId: '1', fechaYhora: futura }).success, false);
  assert.equal(crearTurnoSchema.safeParse({ medicoId: 1, fechaYhora: 'mañana' }).success, false);
});

test('turno: exige minutos exactos y no más de un año vista', () => {
  const base = Math.floor(Date.now() / 60000) * 60000 + 7 * 24 * 3600 * 1000;
  assert.equal(crearTurnoSchema.safeParse({ medicoId: 1, fechaYhora: new Date(base + 1000).toISOString() }).success, false, 'con segundos');
  assert.equal(crearTurnoSchema.safeParse({ medicoId: 1, fechaYhora: new Date(base + 1).toISOString() }).success, false, 'con milésimas');
  assert.equal(crearTurnoSchema.safeParse({ medicoId: 1, fechaYhora: new Date(base + 400 * 24 * 3600 * 1000).toISOString() }).success, false, 'a más de un año');
  assert.equal(crearTurnoSchema.safeParse({ medicoId: 1, fechaYhora: new Date(base + 350 * 24 * 3600 * 1000).toISOString() }).success, true, 'casi un año');
});

test('turno: una fecha pasada se rechaza', () => {
  const pasada = new Date(Date.now() - 3600 * 1000).toISOString();
  const r = crearTurnoSchema.safeParse({ medicoId: 1, fechaYhora: pasada });
  assert.equal(r.success, false);
  assert.match(r.error.issues[0].message, /futura/);
});

test('turno: solo estados válidos', () => {
  for (const estado of ['PENDIENTE', 'CONFIRMADO', 'CANCELADO', 'FINALIZADO']) {
    assert.equal(actualizarEstadoTurnoSchema.safeParse({ estado }).success, true);
  }
  assert.equal(actualizarEstadoTurnoSchema.safeParse({ estado: 'BORRADO' }).success, false);
});

test('médico: consultorio corto, duración dentro de rango y al menos una especialidad', () => {
  const base = {
    email: 'dr@correo.com', dni: '25111222', contrasena: 'Zorro-Azul-4721', nomYape: 'Dr. House',
    matricula: 'MP-1', especialidadesIds: [1],
  };
  assert.equal(crearMedicoSchema.safeParse(base).success, true);
  assert.equal(crearMedicoSchema.safeParse({ ...base, consultorio: 'Consultorio 12' }).success, false);
  assert.equal(crearMedicoSchema.safeParse({ ...base, consultorio: '204' }).success, true);
  assert.equal(crearMedicoSchema.safeParse({ ...base, duracionTurnoMinutos: 2 }).success, false);
  assert.equal(crearMedicoSchema.safeParse({ ...base, duracionTurnoMinutos: 500 }).success, false);
  assert.equal(crearMedicoSchema.safeParse({ ...base, especialidadesIds: [] }).success, false);
});
