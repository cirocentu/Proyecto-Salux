const test = require('node:test');
const assert = require('node:assert/strict');
const { problemasDeContrasena, MIN, MAX } = require('../../src/utils/politicaContrasena');

test('una contraseña razonable no tiene problemas', () => {
  assert.deepEqual(problemasDeContrasena('Zorro-Azul-4721'), []);
});

test('rechaza las demasiado cortas', () => {
  const p = problemasDeContrasena('Ab1');
  assert.ok(p.some((m) => m.includes(`${MIN} caracteres`)));
});

test('rechaza las que superan el límite de bcrypt', () => {
  const p = problemasDeContrasena(`a1${'x'.repeat(MAX)}`);
  assert.ok(p.some((m) => m.includes(`${MAX} caracteres`)));
});

test('exige combinar letras y números', () => {
  assert.ok(problemasDeContrasena('sololetrasaqui').some((m) => m.includes('letras y números')));
  assert.ok(problemasDeContrasena('4829174650').some((m) => m.includes('letras y números')));
});

test('rechaza contraseñas comunes, incluso con dígitos o símbolos al final', () => {
  for (const clave of ['Password123!', 'contraseña2024', 'Salux12345', 'qwerty1234567']) {
    assert.ok(
      problemasDeContrasena(clave).some((m) => m.includes('común')),
      `debería rechazar "${clave}" por común`
    );
  }
});

test('rechaza un mismo carácter repetido', () => {
  assert.ok(problemasDeContrasena('aaaaaaaaaaaa').some((m) => m.includes('repetido')));
});

test('rechaza contraseñas armadas con los datos de la cuenta', () => {
  const contexto = { email: 'maria.gomez@correo.com', dni: '30123456', nombre: 'María Gómez Pérez' };
  assert.ok(problemasDeContrasena('Clave30123456x', contexto).some((m) => m.includes('DNI')));
  assert.ok(problemasDeContrasena('xx-maria.gomez-9', contexto).some((m) => m.includes('email')));
  assert.ok(problemasDeContrasena('Perez-9182-azul', contexto).some((m) => m.includes('nombre')));
});

test('no inventa problemas de contexto cuando no hay contexto', () => {
  assert.deepEqual(problemasDeContrasena('Zorro-Azul-4721', {}), []);
});

test('tolera valores no string sin romperse', () => {
  assert.ok(problemasDeContrasena(undefined).length > 0);
  assert.ok(problemasDeContrasena(null).length > 0);
});
