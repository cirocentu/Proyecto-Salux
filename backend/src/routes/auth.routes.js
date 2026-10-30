const express = require('express');
const router = express.Router();

// 1. Importamos el controlador y el middleware (el "patovica")
const authController = require('../controllers/auth.controller');
const { verificarToken } = require('../middlewares/auth.middleware');
const validate = require('../middlewares/validate.middleware');
const {
  registerSchema,
  loginSchema,
  actualizarPerfilSchema,
  cambiarContrasenaSchema,
  olvideContrasenaSchema,
  resetearContrasenaSchema,
  verificarEmailSchema,
} = require('../schemas/auth.schema');

// 2. Rutas Públicas (No necesitan token)
router.post('/register', validate(registerSchema), authController.register);
router.post('/login', validate(loginSchema), authController.login);
// Usa el refresh token de la cookie httpOnly, no el Access Token del header
router.post('/refresh', authController.refresh);
router.post('/logout', authController.logout);
router.post('/olvide-contrasena', validate(olvideContrasenaSchema), authController.olvideContrasena);
router.post('/resetear-contrasena', validate(resetearContrasenaSchema), authController.resetearContrasena);
router.post('/verificar-email', validate(verificarEmailSchema), authController.verificarEmail);
router.post('/reenviar-verificacion', validate(olvideContrasenaSchema), authController.reenviarVerificacion);

// 3. Rutas Privadas (Pasan por verificarToken antes de llegar al controlador)
router.post('/logout-todas', verificarToken, authController.logoutTodas);
router.get('/perfil', verificarToken, authController.obtenerPerfil);
router.patch('/perfil', verificarToken, validate(actualizarPerfilSchema), authController.actualizarPerfil);
router.patch('/perfil/contrasena', verificarToken, validate(cambiarContrasenaSchema), authController.cambiarContrasena);

// 4. Exportamos el router para que app.js lo pueda usar
module.exports = router;