// Helpers compartidos entre NuevoTurnoModal y ReprogramarTurnoModal: ambos
// necesitan generar los mismos "chips" de día y la misma grilla de horarios
// a partir de la disponibilidad real de un médico.

export const DIAS_A_MOSTRAR = 14;
export const HORA_INICIO = 8;
export const HORA_FIN = 20;
export const MINUTOS_ANTICIPACION = 60;

// Próximos N días a partir de hoy, para los "chips" de fecha — el año nunca
// se le pide al usuario, se infiere solo de la fecha real del sistema.
export function generarProximosDias(cantidad) {
  const hoy = new Date();
  hoy.setHours(0, 0, 0, 0);
  return Array.from({ length: cantidad }, (_, i) => {
    const dia = new Date(hoy);
    dia.setDate(dia.getDate() + i);
    return dia;
  });
}

// Ausencia = un día calendario absoluto (el médico avisó "no atiendo el
// 3/10"), no un instante. La comparamos siempre en UTC de ambos lados de la
// franja para no depender de la zona horaria del navegador — ver la misma
// convención en el backend (diaCalendarioUTC en turno.controller.js).
function diaCalendarioUTC(fecha) {
  const d = new Date(fecha);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

// El día del chip (`dia`) se genera en hora LOCAL del navegador — es "el día
// que el paciente ve en su calendario", así que se compara por sus propios
// componentes locales, no por los UTC.
function diaCalendarioLocal(fecha) {
  return `${fecha.getFullYear()}-${String(fecha.getMonth() + 1).padStart(2, '0')}-${String(fecha.getDate()).padStart(2, '0')}`;
}

// Horarios dentro de la disponibilidad real del médico para el día elegido
// (si todavía no cargó ninguna franja, usamos el rango 8-20hs de siempre
// como respaldo — mismo criterio de compatibilidad que aplica el backend
// en crearTurno). Filtra los que ya pasaron (con 1hs de margen) si el día
// elegido es hoy, y los días que caen dentro de una ausencia puntual del médico.
export function generarHorariosDelDia(dia, disponibilidadMedico) {
  if (!dia) return [];

  const diaChip = diaCalendarioLocal(dia);
  const enAusencia = (disponibilidadMedico?.ausencias || []).some((a) => {
    const desde = diaCalendarioUTC(a.fechaInicio);
    const hasta = diaCalendarioUTC(a.fechaFin);
    return diaChip >= desde && diaChip <= hasta;
  });
  if (enAusencia) return [];

  const duracion = disponibilidadMedico?.duracionTurnoMinutos || 30;
  const franjas = disponibilidadMedico?.disponibilidades?.length
    ? disponibilidadMedico.disponibilidades.filter((f) => f.diaSemana === dia.getDay())
    : [{ horaInicioMinutos: HORA_INICIO * 60, horaFinMinutos: HORA_FIN * 60 }];

  const minimo = Date.now() + MINUTOS_ANTICIPACION * 60 * 1000;
  const horarios = [];
  for (const franja of franjas) {
    for (let m = franja.horaInicioMinutos; m + duracion <= franja.horaFinMinutos; m += duracion) {
      const slot = new Date(dia);
      slot.setHours(0, m, 0, 0);
      if (slot.getTime() >= minimo) horarios.push(slot);
    }
  }
  return horarios.sort((a, b) => a - b);
}
