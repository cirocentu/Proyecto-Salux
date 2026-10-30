const test = require('node:test');
const assert = require('node:assert/strict');
const { seSolapan } = require('../../src/utils/solapamiento');
const { parsearId } = require('../../src/utils/ids');
const { diaCalendarioArgentina } = require('../../src/utils/fechas');

const a = (hhmm) => new Date(`2030-05-06T${hhmm}:00.000Z`);

test.describe('seSolapan', () => {
  test('turnos que se pisan', () => {
    assert.equal(seSolapan(a('10:00'), 30, a('10:15'), 30), true);
    assert.equal(seSolapan(a('10:15'), 30, a('10:00'), 30), true);
    assert.equal(seSolapan(a('10:00'), 30, a('10:00'), 30), true, 'mismo instante');
  });

  test('terminar justo cuando el otro empieza no es pisarse', () => {
    assert.equal(seSolapan(a('10:00'), 30, a('10:30'), 30), false);
    assert.equal(seSolapan(a('10:30'), 30, a('10:00'), 30), false);
  });

  test('cada turno ocupa SU duración (60 vs 15)', () => {
    assert.equal(seSolapan(a('10:45'), 15, a('10:00'), 60), true);
    assert.equal(seSolapan(a('11:00'), 15, a('10:00'), 60), false);
    assert.equal(seSolapan(a('09:50'), 15, a('10:00'), 60), true, 'el nuevo (15) invade al existente (60)');
    assert.equal(seSolapan(a('09:45'), 15, a('10:00'), 60), false);
  });
});

test.describe('parsearId', () => {
  test('acepta enteros positivos dentro del rango de la base', () => {
    assert.equal(parsearId('7'), 7);
    assert.equal(parsearId(42), 42);
    assert.equal(parsearId('2147483647'), 2147483647);
  });

  test('rechaza basura, ceros, decimales, notación científica y números fuera de rango', () => {
    for (const malo of ['12abc', '1e3', '2.5', '-1', '0', '00', '', ' 7', '2147483648', '99999999999', 'NaN', null, undefined, {}, [], true]) {
      assert.equal(parsearId(malo), null, `debería rechazar ${JSON.stringify(malo)}`);
    }
  });
});

test.describe('diaCalendarioArgentina', () => {
  test('22:00 de Argentina sigue siendo el mismo día aunque en UTC sea el siguiente', () => {
    assert.equal(diaCalendarioArgentina('2030-05-07T01:00:00.000Z'), '2030-05-06');
  });
  test('00:30 de Argentina ya es el día nuevo', () => {
    assert.equal(diaCalendarioArgentina('2030-05-07T03:30:00.000Z'), '2030-05-07');
  });
  test('justo la medianoche de Argentina (03:00 UTC) abre el día nuevo', () => {
    assert.equal(diaCalendarioArgentina('2030-05-07T03:00:00.000Z'), '2030-05-07');
    assert.equal(diaCalendarioArgentina('2030-05-07T02:59:59.000Z'), '2030-05-06');
  });
});
