// Punto de entrada del backend en Vercel: toda petición a /api/* llega acá
// (ver "rewrites" en vercel.json) y se la pasa a la app de Express.
// El mismo código corre en Docker/servidor propio con `node backend/src/app.js`.
import entorno from '../backend/src/config/validarEntorno.js';
import app from '../backend/src/app.js';

// En Vercel no se ejecuta el arranque de app.js, así que la configuración se
// valida acá: con una configuración insegura la función falla con un mensaje
// claro en los logs, en vez de funcionar a medias.
const { errores, avisos } = entorno.validarEntorno();
avisos.forEach((aviso) => console.warn(`[config] AVISO: ${aviso}`));
if (errores.length > 0) {
  errores.forEach((error) => console.error(`[config] ERROR: ${error}`));
  throw new Error(`Configuración insegura o incompleta: ${errores.join(' | ')}`);
}

export default app;
