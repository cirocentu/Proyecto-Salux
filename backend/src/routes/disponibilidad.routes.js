const express = require('express');
const router = express.Router();

const disponibilidadController = require('../controllers/disponibilidad.controller');
const { verificarToken } = require('../middlewares/auth.middleware');
const validate = require('../middlewares/validate.middleware');
const { crearDisponibilidadSchema, crearAusenciaSchema } = require('../schemas/disponibilidad.schema');

// Rutas del médico logueado sobre sus propias franjas horarias
router.post('/', verificarToken, validate(crearDisponibilidadSchema), disponibilidadController.crearDisponibilidad);
router.get('/mias', verificarToken, disponibilidadController.obtenerMisDisponibilidades);

// Ausencias puntuales del médico logueado (van antes de "/:id" para que no
// choque con la ruta de borrar una franja horaria por id)
router.post('/ausencias', verificarToken, validate(crearAusenciaSchema), disponibilidadController.crearAusencia);
router.get('/ausencias/mias', verificarToken, disponibilidadController.obtenerMisAusencias);
router.delete('/ausencias/:id', verificarToken, disponibilidadController.eliminarAusencia);

router.delete('/:id', verificarToken, disponibilidadController.eliminarDisponibilidad);

// Para el wizard de turnos del paciente: disponibilidad de un médico puntual
router.get('/medico/:medicoId', verificarToken, disponibilidadController.obtenerDisponibilidadDeMedico);

module.exports = router;
