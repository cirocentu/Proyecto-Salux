// Trabajo que se hace DESPUÉS de responder (mandar un correo, por ejemplo). En
// Vercel la función se congela apenas se envía la respuesta: sin `waitUntil` ese
// trabajo se cortaría a la mitad. Fuera de Vercel el proceso sigue vivo y no hace falta.
let waitUntil = null;
if (process.env.VERCEL) {
  try {
    ({ waitUntil } = require('@vercel/functions'));
  } catch {
    // sin el paquete: se ejecuta igual, pero sin garantía de terminar
  }
}

// Recibe la promesa del trabajo, la mantiene viva y nunca deja que un fallo tire
// abajo la operación que la disparó (solo lo registra).
function segundoPlano(promesa) {
  const protegida = Promise.resolve(promesa).catch((error) => {
    console.error('[segundo plano] La tarea falló:', error?.message);
  });
  if (waitUntil) waitUntil(protegida);
  return protegida;
}

module.exports = { segundoPlano };
