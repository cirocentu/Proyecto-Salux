const express = require('express');
const router = express.Router();
const especialidadController = require('../controllers/especialidad.controller');
const { verificarToken, verificarAdmin } = require('../middlewares/auth.middleware');
const validate = require('../middlewares/validate.middleware');
const { crearEspecialidadSchema } = require('../schemas/especialidad.schema');

// Ruta GET: Cualquiera con token puede VER las especialidades
router.get('/', verificarToken, especialidadController.obtenerEspecialidades);

// Ruta POST: SOLO los administradores pueden CREAR especialidades nuevas
router.post('/', verificarToken, verificarAdmin, validate(crearEspecialidadSchema), especialidadController.crearEspecialidad);

// Ruta DELETE: SOLO los administradores. Es un borrado lógico (activo: false),
// así que no se bloquea aunque tenga médicos asignados.
router.delete('/:id', verificarToken, verificarAdmin, especialidadController.eliminarEspecialidad);

module.exports = router;