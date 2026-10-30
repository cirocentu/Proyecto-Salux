const test = require('node:test');
const assert = require('node:assert/strict');
const { Prisma } = require('@prisma/client');
const { registrarError } = require('../../src/utils/registrarError');

// Captura lo que se escribe con console.error durante `fn`.
function capturar(fn) {
  const original = console.error;
  const lineas = [];
  console.error = (...args) => lineas.push(args.join(' '));
  try { fn(); } finally { console.error = original; }
  return lineas.join('\n');
}

// Así llega un error de Prisma: encabezado, fragmento de código CON los valores y, al final, la causa.
const MENSAJE_PRISMA = [
  '',
  'Invalid `prisma.usuario.create()` invocation in',
  'C:\\app\\backend\\src\\controllers\\auth.controller.js:150:40',
  '',
  '  147 const hash = await bcrypt.hash(contrasena, 12);',
  '→ 150 await prisma.usuario.create({',
  '        data: {',
  '          email: "persona.privada@correo.com",',
  '          dni: "30123456",',
  '          nomYape: "María Pérez Gómez"',
  '        }',
  '      })',
  '',
  'Unique constraint failed on the fields: (`email`)',
].join('\n');

const errorDePrisma = () => new Prisma.PrismaClientKnownRequestError(MENSAJE_PRISMA, { code: 'P2002', clientVersion: 'test', meta: { target: ['email'] } });

test('un error de Prisma se registra sin los valores de la consulta', () => {
  const salida = capturar(() => registrarError(errorDePrisma()));
  assert.ok(!salida.includes('persona.privada'), 'no debe aparecer el email');
  assert.ok(!salida.includes('30123456'), 'no debe aparecer el DNI');
  assert.ok(!salida.includes('María'), 'no debe aparecer el nombre');
  assert.ok(!salida.includes('bcrypt.hash'), 'no debe aparecer código fuente');
});

test('pero sí dice qué falló: tipo, código y causa', () => {
  const salida = capturar(() => registrarError(errorDePrisma()));
  assert.match(salida, /PrismaClientKnownRequestError P2002/);
  assert.match(salida, /Unique constraint failed on the fields: \(`email`\)/);
});

test('el mismo mensaje sin limpiar SÍ contenía los datos (por eso existe esta función)', () => {
  const salida = capturar(() => console.error(errorDePrisma().message));
  assert.ok(salida.includes('persona.privada@correo.com'));
});

test('también limpia los errores de validación de Prisma', () => {
  const error = new Prisma.PrismaClientValidationError('\nInvalid `prisma.usuario.findUnique()` invocation:\n\n{\n  where: {\n    email: "otra.persona@correo.com"\n  }\n}\n\nArgument `where` needs at least one argument.', { clientVersion: 'test' });
  const salida = capturar(() => registrarError(error));
  assert.ok(!salida.includes('otra.persona'));
  assert.match(salida, /Argument `where` needs at least one argument\./);
});

test('un error común conserva su mensaje y las primeras líneas de la pila', () => {
  const salida = capturar(() => registrarError(new TypeError('Cannot read properties of undefined')));
  assert.match(salida, /TypeError: Cannot read properties of undefined/);
  assert.match(salida, /at /);
});

test('admite un contexto y valores que no son Error', () => {
  assert.match(capturar(() => registrarError(new Error('x'), 'turnos')), /\[error\] turnos Error: x/);
  assert.match(capturar(() => registrarError('algo se rompió')), /algo se rompió/);
  assert.doesNotThrow(() => capturar(() => registrarError(undefined)));
});

test('un mensaje larguísimo se recorta', () => {
  const salida = capturar(() => registrarError(new Error('x'.repeat(5000))));
  assert.ok(salida.length < 900);
});
