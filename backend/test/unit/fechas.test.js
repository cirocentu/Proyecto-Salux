const test = require('node:test');
const assert = require('node:assert/strict');
const { diaCalendarioUTC, diaSemanaYMinutosArgentina, formatearFechaHora } = require('../../src/utils/fechas');

test('diaCalendarioUTC devuelve AAAA-MM-DD en UTC', () => {
  assert.equal(diaCalendarioUTC('2026-03-05T00:00:00.000Z'), '2026-03-05');
  assert.equal(diaCalendarioUTC('2026-03-05T23:59:59.000Z'), '2026-03-05');
});

test('hora Argentina: 12:00 UTC son las 09:00 (se RESTA el offset)', () => {
  // Lunes 2026-03-02 12:00 UTC = lunes 09:00 en Argentina
  const r = diaSemanaYMinutosArgentina('2026-03-02T12:00:00.000Z');
  assert.equal(r.diaSemana, 1);
  assert.equal(r.minutosDelDia, 9 * 60);
});

test('pasada la medianoche UTC todavía es el día anterior en Argentina', () => {
  // Martes 2026-03-03 01:30 UTC = lunes 22:30 en Argentina
  const r = diaSemanaYMinutosArgentina('2026-03-03T01:30:00.000Z');
  assert.equal(r.diaSemana, 1);
  assert.equal(r.minutosDelDia, 22 * 60 + 30);
});

test('formatearFechaHora muestra la hora de Argentina, no la del proceso', () => {
  // 13:00 UTC = 10:00 en Argentina (el bug original mostraba "1:00 p. m.")
  const { fechaTexto, horaTexto } = formatearFechaHora('2026-03-02T13:00:00.000Z');
  assert.match(horaTexto, /10:00/);
  assert.match(fechaTexto, /2026/);
  assert.match(fechaTexto.toLowerCase(), /marzo/);
});
