const { z } = require('zod');

const actualizarPerfilSchema = z.object({
  obraSocial: z.string().trim().max(191).optional(),
  telefono: z.string().trim().max(191).optional(),
});

module.exports = { actualizarPerfilSchema };
