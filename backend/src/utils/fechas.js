// "Día calendario" como AAAA-MM-DD en UTC — una ausencia (o cualquier "día"
// sin hora asociada) es un concepto absoluto, no un instante, así que no hay
// que derivarlo con las horas locales del proceso de por medio: eso corre la
// fecha un día si el servidor no corre en UTC.
function diaCalendarioUTC(fecha) {
  const d = new Date(fecha);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

// Argentina es UTC-3 todo el año (sin horario de verano desde 2009). Todo el
// sistema —el formulario de disponibilidad del médico, los horarios que
// genera el wizard en el navegador del paciente— asume esa zona horaria fija
// como "la hora real" del negocio.
const OFFSET_ARGENTINA_MINUTOS = 180;

// Día de la semana y minutos desde medianoche de un instante, vistos desde
// Argentina — NO desde la zona horaria del proceso. Usar fecha.getDay() o
// fecha.getHours() acá sería un bug: esos métodos dependen de en qué huso
// corre el servidor (en Docker, UTC), no de dónde vive el usuario, y
// correrían la comparación contra Disponibilidad 3 horas.
function diaSemanaYMinutosArgentina(fecha) {
  // Argentina va "atrás" respecto de UTC, así que para ver un instante UTC
  // con los ojos de Argentina hay que RESTAR el offset (12:00 UTC = 09:00
  // Argentina). Sumar acá fue el bug real: corría el horario +3hs en vez de
  // -3hs y rechazaba turnos que en realidad caían bien dentro de la franja.
  const corrido = new Date(new Date(fecha).getTime() - OFFSET_ARGENTINA_MINUTOS * 60 * 1000);
  return {
    diaSemana: corrido.getUTCDay(),
    minutosDelDia: corrido.getUTCHours() * 60 + corrido.getUTCMinutes(),
  };
}

// Fecha y hora legibles (para los emails) vistas desde Argentina. Hay que
// fijar la zona explícitamente: sin `timeZone`, toLocale*String usa la del
// proceso (UTC en Docker) y un turno de las 10:00 sale como "01:00 p. m.".
function formatearFechaHora(fecha) {
  const f = new Date(fecha);
  const zona = { timeZone: 'America/Argentina/Buenos_Aires' };
  return {
    fechaTexto: f.toLocaleDateString('es-AR', { ...zona, weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }),
    horaTexto: f.toLocaleTimeString('es-AR', { ...zona, hour: '2-digit', minute: '2-digit' }),
  };
}

// Día calendario (AAAA-MM-DD) de un instante visto desde Argentina. Las ausencias se
// cargan como días de Argentina: un turno de las 22:00 de un lunes cae en UTC el martes
// (01:00), y comparar el día UTC lo contaría contra la ausencia del día equivocado.
function diaCalendarioArgentina(fecha) {
  return diaCalendarioUTC(new Date(fecha).getTime() - OFFSET_ARGENTINA_MINUTOS * 60 * 1000);
}

module.exports = { diaCalendarioUTC, diaCalendarioArgentina, diaSemanaYMinutosArgentina, formatearFechaHora, OFFSET_ARGENTINA_MINUTOS };
