const express = require('express');
const router = express.Router();

const pacienteController = require('../controllers/paciente.controller');
const { verificarToken } = require('../middlewares/auth.middleware');
const validate = require('../middlewares/validate.middleware');
const { actualizarPerfilSchema } = require('../schemas/paciente.schema');

// Ruta PATCH: /api/pacientes/perfil (Actualiza datos de contacto del paciente logueado)
router.patch('/perfil', verificarToken, validate(actualizarPerfilSchema), pacienteController.actualizarPerfil);

module.exports = router;