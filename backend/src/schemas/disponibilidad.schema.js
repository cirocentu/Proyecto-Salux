const { z } = require('zod');

const crearDisponibilidadSchema = z
  .object({
    diaSemana: z.number().int().min(0, 'Día de la semana inválido').max(6, 'Día de la semana inválido'),
    horaInicioMinutos: z.number().int().min(0).max(1439),
    horaFinMinutos: z.number().int().min(0).max(1439),
  })
  .refine((datos) => datos.horaFinMinutos > datos.horaInicioMinutos, {
    message: 'La hora de fin debe ser posterior a la de inicio',
    path: ['horaFinMinutos'],
  });

// Además del formato, el día tiene que existir ("2027-02-31" tiene formato válido pero no existe).
const fechaSoloDia = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'La fecha debe tener formato AAAA-MM-DD')
  .refine((valor) => {
    const fecha = new Date(`${valor}T00:00:00Z`);
    return !Number.isNaN(fecha.getTime()) && fecha.toISOString().slice(0, 10) === valor;
  }, 'Esa fecha no existe en el calendario');

const crearAusenciaSchema = z
  .object({
    fechaInicio: fechaSoloDia,
    fechaFin: fechaSoloDia,
    motivo: z.preprocess(
      (valor) => (valor === '' || valor == null ? undefined : valor),
      z.string().trim().max(191).optional()
    ),
  })
  .refine((datos) => datos.fechaFin >= datos.fechaInicio, {
    message: 'La fecha de fin no puede ser anterior a la de inicio',
    path: ['fechaFin'],
  });

module.exports = { crearDisponibilidadSchema, crearAusenciaSchema };
