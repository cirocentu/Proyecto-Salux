const { z } = require('zod');

const crearEspecialidadSchema = z.object({
  nombre: z.string().trim().min(1, 'El nombre es obligatorio').max(191),
});

module.exports = { crearEspecialidadSchema };
