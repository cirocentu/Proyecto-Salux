// Registro de errores SIN datos personales.
//
// Un error de Prisma trae en su mensaje la consulta que falló con sus valores
// (emails, nombres, DNI...), y los logs de Vercel se conservan y los puede ver cualquiera
// con acceso al proyecto. Acá se deja solo qué falló: nombre, código y la causa
// (la última línea del mensaje, p. ej. "Unique constraint failed on the fields: (`email`)"),
// que nombra los campos pero nunca los valores.

const esDePrisma = (error) =>
  /^PrismaClient/.test(error?.name || '') || (typeof error?.code === 'string' && /^P\d{4}$/.test(error.code));

// El mensaje de Prisma es: encabezado + fragmento de código con los valores + la causa en
// la ÚLTIMA línea. Solo se conserva esa última línea.
function causaDePrisma(mensaje) {
  const lineas = String(mensaje ?? '').split('\n').map((l) => l.trim()).filter(Boolean);
  return (lineas[lineas.length - 1] || 'sin detalle').slice(0, 300);
}

function registrarError(error, contexto = '') {
  const prefijo = `[error]${contexto ? ` ${contexto}` : ''}`;
  const etiqueta = `${error?.name || 'Error'}${error?.code ? ` ${error.code}` : ''}`;

  if (esDePrisma(error)) {
    console.error(`${prefijo} ${etiqueta}: ${causaDePrisma(error.message)}`);
    return;
  }
  // Errores propios o de librerías: el mensaje y las primeras líneas de la pila (rutas, sin datos).
  const mensaje = String(error?.message ?? error).slice(0, 300);
  const pila = String(error?.stack || '').split('\n').slice(1, 5).join('\n');
  console.error(`${prefijo} ${etiqueta}: ${mensaje}${pila ? `\n${pila}` : ''}`);
}

module.exports = { registrarError };
