const express = require('express');
const crypto = require('crypto');
const router = express.Router();
const { ejecutarMantenimiento } = require('../jobs/vencerTurnosPendientes');

// Vercel Cron llama a esta ruta con "Authorization: Bearer <CRON_SECRET>".
// Sin CRON_SECRET configurado queda deshabilitada: nunca debe ser pública.
function secretoValido(recibido, esperado) {
  const a = Buffer.from(String(recibido || ''));
  const b = Buffer.from(esperado);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

router.get('/mantenimiento', async (req, res) => {
  const secreto = process.env.CRON_SECRET;
  if (!secreto) {
    return res.status(404).json({ ok: false, message: 'Ruta no encontrada' });
  }
  const recibido = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!secretoValido(recibido, `${secreto}`)) {
    return res.status(401).json({ ok: false, message: 'No autorizado' });
  }
  const resultado = await ejecutarMantenimiento();
  res.json({ ok: true, data: resultado });
});

module.exports = router;
