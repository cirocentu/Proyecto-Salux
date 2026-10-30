const jwt = require('jsonwebtoken');
const prisma = require('../config/prisma');
const { registrarError } = require('../utils/registrarError');

const RUTAS_PERMITIDAS_SIN_CAMBIO = ['GET /api/auth/perfil', 'PATCH /api/auth/perfil/contrasena'];

const verificarToken = (req, res, next) => {
  // 1. Buscamos el token en la cabecera de la petición
  const authHeader = req.headers['authorization'];
  
  // El estándar es mandarlo como "Bearer eyJhbGciOi..."
  const token = authHeader && authHeader.split(' ')[1]; 

  if (!token) {
    // 401 (no autenticado), no 403: así el frontend lo trata igual que un
    // token vencido e intenta renovar la sesión en vez de mostrar el error.
    return res.status(401).json({ ok: false, message: 'Acceso denegado: Se requiere un token' });
  }

  // 2. Verificamos que el token sea auténtico y no haya expirado
  jwt.verify(token, process.env.JWT_SECRET, { algorithms: ['HS256'] }, async (err, decoded) => {
    if (err) {
      return res.status(401).json({ ok: false, message: 'Token inválido o expirado' });
    }

    try {
      // 3. Re-chequeamos en la base que la cuenta siga activa: un JWT firmado
      // antes de que un admin desactive la cuenta seguiría siendo válido
      // hasta su vencimiento (2h) si no volvemos a mirar la base acá.
      // Además, la sesión (fila en `Sesion`) tiene que seguir existiendo: logout
      // y cambio de contraseña la borran y el token deja de servir al instante.
      const sesion = await prisma.sesion.findUnique({
        where: { idSesion: decoded.sid ?? -1 },
        select: {
          usuarioId: true,
          expiraEn: true,
          usuario: { select: { activo: true, tokenVersion: true, debeCambiarContrasena: true } }
        }
      });

      if (!sesion || sesion.usuarioId !== decoded.id || sesion.expiraEn.getTime() < Date.now()) {
        return res.status(401).json({ ok: false, message: 'La sesión ya no es válida, iniciá sesión de nuevo' });
      }
      const usuario = sesion.usuario;

      if (!usuario.activo) {
        return res.status(403).json({ ok: false, message: 'Tu cuenta está desactivada. Contactá a un administrador.' });
      }

      // 3.1 Tokens anteriores a un cambio/reseteo de contraseña ya no valen
      if ((decoded.tv ?? 0) !== usuario.tokenVersion) {
        return res.status(401).json({ ok: false, message: 'La sesión ya no es válida, iniciá sesión de nuevo' });
      }

      // 3.2 Contraseña inicial (cuentas creadas por el admin): hasta que la
      // cambie, la API solo le deja ver su perfil y cambiarla.
      if (usuario.debeCambiarContrasena) {
        const ruta = `${req.method} ${req.originalUrl.split('?')[0]}`;
        if (!RUTAS_PERMITIDAS_SIN_CAMBIO.includes(ruta)) {
          return res.status(403).json({
            ok: false,
            codigo: 'CAMBIO_CONTRASENA_REQUERIDO',
            message: 'Tenés que cambiar tu contraseña inicial antes de continuar.'
          });
        }
      }

      // 4. Si está todo bien, guardamos los datos del usuario en la request
      req.usuario = decoded;

      // 5. Le decimos a Express que deje pasar la petición al controlador
      next();
    } catch (error) {
      registrarError(error);
      res.status(500).json({ ok: false, error: 'Error interno al verificar la sesión' });
    }
  });
};
const verificarAdmin = async (req, res, next) => {
  try {
    // Como este control se ejecuta DESPUÉS de verificarToken, ya sabemos quién es el usuario
    const usuarioId = req.usuario.id;

    // Vamos a buscar si este ID existe en la tabla exclusiva de Administradores
    const admin = await prisma.administrador.findUnique({
      where: { usuarioId: usuarioId }
    });

    // Si Prisma nos devuelve null, significa que es un paciente o un médico, pero NO un admin.
    if (!admin) {
      return res.status(403).json({ 
        ok: false, 
        message: 'Acceso denegado: Acción exclusiva para Administradores de Salux' 
      });
    }

    // Si llegó hasta acá, es porque es Admin. Le abrimos la puerta con next()
    next();
  } catch (error) {
    registrarError(error);
    res.status(500).json({ ok: false, error: 'Error interno al verificar roles' });
  }
};

// Actualizá la exportación al final del archivo para incluir a los dos
module.exports = {
  verificarToken,
  verificarAdmin
};