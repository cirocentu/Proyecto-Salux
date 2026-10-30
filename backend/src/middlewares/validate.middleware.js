// Middleware genérico: valida req.body contra un schema de Zod.
// Si falla, corta la request con 400 y el detalle de los errores.
const validate = (schema) => (req, res, next) => {
  const resultado = schema.safeParse(req.body);

  if (!resultado.success) {
    return res.status(400).json({
      ok: false,
      message: 'Datos inválidos',
      errores: resultado.error.issues.map((issue) => ({
        campo: issue.path.join('.'),
        mensaje: issue.message,
      })),
    });
  }

  req.body = resultado.data;
  next();
};

module.exports = validate;
