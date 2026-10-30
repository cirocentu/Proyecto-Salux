const MINUTO_MS = 60 * 1000;

// Dos turnos se pisan si cada uno empieza antes de que el otro termine. Terminar
// justo cuando el otro empieza NO es pisarse (10:00-10:30 y 10:30-11:00 conviven).
function seSolapan(inicioA, duracionAMinutos, inicioB, duracionBMinutos) {
  const a = new Date(inicioA).getTime();
  const b = new Date(inicioB).getTime();
  return a < b + duracionBMinutos * MINUTO_MS && b < a + duracionAMinutos * MINUTO_MS;
}

// Un turno dura como máximo lo que permite el alta de médicos (240 min): sirve para
// acotar la búsqueda de turnos vecinos en la base.
const DURACION_MAXIMA_MINUTOS = 240;

module.exports = { seSolapan, DURACION_MAXIMA_MINUTOS, MINUTO_MS };
