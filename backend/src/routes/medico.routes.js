const express = require('express');
const router = express.Router();

const medicoController = require('../controllers/medico.controller');
const { verificarToken, verificarAdmin } = require('../middlewares/auth.middleware');
const validate = require('../middlewares/validate.middleware');
const { crearMedicoSchema, cambiarEstadoMedicoSchema, actualizarMedicoSchema } = require('../schemas/medico.schema');

// Ruta POST: /api/medicos
router.post('/', verificarToken, verificarAdmin, validate(crearMedicoSchema), medicoController.crearMedico);
// Ruta GET: /api/medicos (Para listar a todos los médicos de la cartilla, solo activos)
router.get('/', verificarToken, medicoController.obtenerMedicos);
// Ruta GET: /api/medicos/todos (data table del admin: incluye inactivos)
router.get('/todos', verificarToken, verificarAdmin, medicoController.obtenerTodosLosMedicos);
// Ruta PATCH: /api/medicos/:id/estado (activar/desactivar)
router.patch('/:id/estado', verificarToken, verificarAdmin, validate(cambiarEstadoMedicoSchema), medicoController.cambiarEstadoMedico);
// Ruta PATCH: /api/medicos/:id (editar consultorio/duración de turno)
router.patch('/:id', verificarToken, verificarAdmin, validate(actualizarMedicoSchema), medicoController.actualizarMedico);
module.exports = router;