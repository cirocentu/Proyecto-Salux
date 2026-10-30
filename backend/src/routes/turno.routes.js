const express = require('express');
const router = express.Router();

const turnoController = require('../controllers/turno.controller');
const { verificarToken, verificarAdmin } = require('../middlewares/auth.middleware');
const validate = require('../middlewares/validate.middleware');
const { crearTurnoSchema, actualizarEstadoTurnoSchema, reprogramarTurnoSchema } = require('../schemas/turno.schema');

// Ruta GET: /api/turnos/mis-turnos (Para que el paciente vea su agenda)
router.get('/mis-turnos', verificarToken, turnoController.obtenerMisTurnos);
// Ruta GET: /api/turnos/agenda-medico (Agenda del médico)
router.get('/agenda-medico', verificarToken, turnoController.obtenerTurnosMedico);
// Ruta GET: /api/turnos (Panel de administración: todos los turnos de todos los pacientes)
router.get('/', verificarToken, verificarAdmin, turnoController.obtenerTodosLosTurnos);
// Ruta POST: /api/turnos (Para sacar un turno)
router.post('/', verificarToken, validate(crearTurnoSchema), turnoController.crearTurno);
// Ruta PATCH: /api/turnos/:id/reprogramar (el paciente mueve su turno a otro horario)
router.patch('/:id/reprogramar', verificarToken, validate(reprogramarTurnoSchema), turnoController.reprogramarTurno);
// Ruta PATCH: /api/turnos/:id/confirmar-asistencia (el paciente confirma que va a ir)
router.patch('/:id/confirmar-asistencia', verificarToken, turnoController.confirmarAsistencia);
// Ruta PATCH: /api/turnos/:id (Para cancelar o confirmar un turno)
router.patch('/:id', verificarToken, validate(actualizarEstadoTurnoSchema), turnoController.actualizarEstadoTurno);
module.exports = router;