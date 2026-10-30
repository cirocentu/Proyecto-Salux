const { z } = require('zod');
const { INT32_MAX } = require('../utils/ids');

const UN_ANIO_MS = 365 * 24 * 60 * 60 * 1000;

// Fecha de un turno: ISO válido, a minuto exacto (los horarios que ofrece la app nunca
// traen segundos; aceptarlos dejaría pasar choques por milisegundos), a futuro y no más
// de un año vista (evita reservas absurdas como el año 9999).
const fechaDeTurno = z
  .string()
  .datetime({ message: 'fechaYhora debe ser una fecha ISO válida' })
  .refine((valor) => new Date(valor).getTime() > Date.now(), {
    message: 'El turno debe ser en una fecha futura',
  })
  .refine((valor) => new Date(valor).getTime() % 60000 === 0, {
    message: 'El horario del turno debe ser en minutos exactos (sin segundos)',
  })
  .refine((valor) => new Date(valor).getTime() <= Date.now() + UN_ANIO_MS, {
    message: 'Solo se pueden reservar turnos dentro del próximo año',
  });

const crearTurnoSchema = z.object({
  medicoId: z.number().int().positive('medicoId inválido').max(INT32_MAX, 'medicoId inválido'),
  especialidadId: z.number().int().positive('especialidadId inválido').max(INT32_MAX, 'especialidadId inválido').optional(),
  fechaYhora: fechaDeTurno,
});

const actualizarEstadoTurnoSchema = z.object({
  estado: z.enum(['PENDIENTE', 'CONFIRMADO', 'CANCELADO', 'FINALIZADO'], {
    errorMap: () => ({ message: 'Estado no válido' }),
  }),
});

const reprogramarTurnoSchema = z.object({
  fechaYhora: fechaDeTurno,
});

module.exports = { crearTurnoSchema, actualizarEstadoTurnoSchema, reprogramarTurnoSchema };
