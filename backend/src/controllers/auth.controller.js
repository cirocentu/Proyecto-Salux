const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const prisma = require('../config/prisma');
const { emailResetContrasena, emailVerificacionCuenta, emailRegistroDuplicado } = require('../utils/email');
const { problemasDeContrasena } = require('../utils/politicaContrasena');
const { permitirCorreo, avisarOmitido, huella } = require('../utils/limiteCorreos');
const { incrementar, leer, reiniciar } = require('../utils/contadores');
const { segundoPlano } = require('../utils/segundoPlano');
const { registrarError } = require('../utils/registrarError');

const RESET_TOKEN_TTL_MS = 60 * 60 * 1000; // 1 hora
const VERIFICACION_TTL_MS = 24 * 60 * 60 * 1000; // 24 horas

// Tope de contraseñas incorrectas por CUENTA en 15 minutos, sin importar desde qué IP
// lleguen. El límite por IP + cuenta del router frena a una sola máquina, pero una red
// de máquinas (cada una con pocos intentos) podría probar contraseñas sin fin sobre la
// misma cuenta. Con el tope, una cuenta recibe como mucho N intentos por ventana.
// Compromiso: alguien podría bloquear el inicio de sesión de otra persona 15 minutos
// repitiendo intentos; igual puede entrar recuperando la contraseña (ese flujo no se bloquea).
const VENTANA_FALLOS_MS = 15 * 60 * 1000;
const limiteFallosPorCuenta = () => {
  const n = Number(process.env.LOGIN_FALLOS_POR_CUENTA);
  return Number.isFinite(n) && n > 0 ? n : 30;
};

const sha256 = (texto) => crypto.createHash('sha256').update(texto).digest('hex');
const origenFrontend = () => (process.env.CORS_ORIGIN || 'http://localhost:5173').split(',')[0];
// Con REQUIERE_VERIFICACION_EMAIL=true una cuenta nueva no puede iniciar
// sesión hasta confirmar su email (recomendado en producción).
const requiereVerificacionEmail = () => process.env.REQUIERE_VERIFICACION_EMAIL === 'true';

// Hash "señuelo" contra el que comparar cuando el email no existe, para que
// bcrypt.compare tarde lo mismo en ambos casos (ver login más abajo).
const HASH_SENUELO = bcrypt.hashSync('salux-timing-guard', 12);

const ACCESS_TOKEN_TTL = '15m';
const REFRESH_TOKEN_TTL = '7d';
const REFRESH_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const REFRESH_COOKIE_NAME = 'refreshToken';

function derivarRol(usuario) {
  return usuario.admin ? 'admin' : usuario.medico ? 'medico' : 'paciente';
}

// Arma el objeto de perfil que se muestra/edita en la Vista de Perfil —
// incluye los campos propios de cada rol además de los comunes a Usuario.
function serializarPerfil(usuario, rol) {
  const perfil = {
    id: usuario.idUsuario,
    email: usuario.email,
    nombre: usuario.nomYape,
    dni: usuario.dni,
    rol,
    debeCambiarContrasena: usuario.debeCambiarContrasena,
  };

  if (rol === 'paciente' && usuario.paciente) {
    perfil.obraSocial = usuario.paciente.obraSocial || '';
    perfil.telefono = usuario.paciente.telefono || '';
  }

  if (rol === 'medico' && usuario.medico) {
    perfil.matricula = usuario.medico.matricula;
    perfil.consultorio = usuario.medico.consultorio || '';
  }

  return perfil;
}

// Datos del usuario que se devuelven al iniciar/renovar sesión.
function usuarioDeSesion(usuario, rol) {
  return {
    id: usuario.idUsuario,
    email: usuario.email,
    nombre: usuario.nomYape,
    rol,
    debeCambiarContrasena: usuario.debeCambiarContrasena,
  };
}

// Cada inicio de sesión crea una fila en `Sesion`: es lo que permite cerrarla
// de verdad (logout, cambio de contraseña) en vez de esperar a que venza el token.
// Cada refresh token lleva un `jti` aleatorio y la sesión recuerda cuál es el vigente.
// Cada renovación entrega uno nuevo y el anterior deja de valer: si alguien presenta uno
// ya rotado, es que existe una copia (robo) y la sesión se revoca (ver `refresh`).
const nuevoJti = () => crypto.randomBytes(16).toString('hex');
// Dos pestañas pueden renovar a la vez con la misma cookie: al segundo pedido se le
// tolera el token anterior durante unos segundos, sin rotar de nuevo.
const GRACIA_ROTACION_MS = 10 * 1000;
// Sesiones simultáneas por usuario (una por navegador/dispositivo). Al superar el tope se
// cierran las más antiguas: la tabla no crece sin límite ni acumula cookies olvidadas.
const MAX_SESIONES_POR_USUARIO = 10;

async function crearSesion(usuarioId, cliente = prisma) {
  const sesion = await cliente.sesion.create({
    data: { usuarioId, expiraEn: new Date(Date.now() + REFRESH_TOKEN_TTL_MS), jtiActual: nuevoJti(), rotadaEn: new Date() },
  });
  const sobrantes = await cliente.sesion.findMany({
    where: { usuarioId },
    orderBy: [{ creadaEn: 'desc' }, { idSesion: 'desc' }],
    skip: MAX_SESIONES_POR_USUARIO,
    select: { idSesion: true },
  });
  if (sobrantes.length > 0) {
    await cliente.sesion.deleteMany({ where: { idSesion: { in: sobrantes.map((x) => x.idSesion) } } });
  }
  return sesion;
}

// Arma el Access Token (corta duración, va en el body de la respuesta) y el
// Refresh Token (larga duración, va SOLO en una cookie httpOnly) para un
// usuario ya autenticado. Ambos llevan el id de su sesión (`sid`).
function generarTokens(usuario, rol, sesion) {
  const accessToken = jwt.sign(
    { id: usuario.idUsuario, email: usuario.email, rol, tv: usuario.tokenVersion, sid: sesion.idSesion },
    process.env.JWT_SECRET,
    { expiresIn: ACCESS_TOKEN_TTL, algorithm: 'HS256' }
  );

  const refreshToken = jwt.sign(
    { id: usuario.idUsuario, tv: usuario.tokenVersion, sid: sesion.idSesion, jti: sesion.jtiActual },
    process.env.JWT_REFRESH_SECRET,
    { expiresIn: REFRESH_TOKEN_TTL, algorithm: 'HS256' }
  );

  return { accessToken, refreshToken };
}

// El Refresh Token viaja en una cookie httpOnly (inaccesible desde JS, evita
// robo por XSS) y con scope acotado a /api/auth (solo la necesitan refresh/logout).
function setRefreshCookie(res, refreshToken) {
  res.cookie(REFRESH_COOKIE_NAME, refreshToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    path: '/api/auth',
    maxAge: REFRESH_TOKEN_TTL_MS,
  });
}

// Un solo mensaje para TODO fallo de login (usuario inexistente, contraseña
// incorrecta o cuenta sin verificar): si fueran distintos, alguien podría
// averiguar qué cuentas existen. Con verificación activa agrega la pista de
// que una cuenta recién creada hay que activarla por email.
const mensajeCredencialesInvalidas = () =>
  requiereVerificacionEmail()
    ? 'Credenciales inválidas. Si te registraste hace poco, activá tu cuenta con el enlace que te enviamos por email.'
    : 'Credenciales inválidas';

// Genera un enlace de verificación nuevo, SI los límites de correo lo permiten
// (ver utils/limiteCorreos.js). Devuelve los datos del correo o null. Si no se
// permite, el token vigente NO se toca: el enlace que ya se mandó sigue siendo válido.
async function prepararVerificacion(usuario) {
  const control = await permitirCorreo('verificacion', usuario.email);
  if (!control.permitido) {
    avisarOmitido('verificacion', control.motivo);
    await operacionVacia();
    return null;
  }
  const tokenPlano = crypto.randomBytes(32).toString('hex');
  await prisma.usuario.update({
    where: { idUsuario: usuario.idUsuario },
    data: { verificacionToken: sha256(tokenPlano), verificacionExpira: new Date(Date.now() + VERIFICACION_TTL_MS) }
  });
  return { to: usuario.email, nombre: usuario.nomYape, link: `${origenFrontend()}/?verificar=${tokenPlano}` };
}

// Prepara el enlace y manda el correo (el envío en sí queda en segundo plano).
async function enviarVerificacion(usuario) {
  const datos = await prepararVerificacion(usuario);
  if (datos) segundoPlano(emailVerificacionCuenta(datos));
}

// Para una dirección SIN cuenta (o que no corresponde): hace el mismo trabajo que
// uno real, sobre contadores "sombra" y un update que no modifica nada. Así la
// respuesta tarda lo mismo y no sirve para averiguar qué correos están registrados.
async function igualarTiempo(tipo, email) {
  await permitirCorreo(tipo, email, { simulado: true });
  await operacionVacia();
}

// Un update que no modifica nada: cuesta como el que genera un token, para que una
// cuenta real que cae dentro de la espera no responda más rápido que una inexistente.
const operacionVacia = () => prisma.usuario.updateMany({ where: { idUsuario: -1 }, data: { verificacionToken: null } });

// Manda un correo en segundo plano solo si los límites lo permiten.
async function enviarSiPermitido(tipo, email, enviar) {
  const control = await permitirCorreo(tipo, email);
  if (!control.permitido) {
    avisarOmitido(tipo, control.motivo);
    return;
  }
  await enviar();
}

const MENSAJE_REGISTRO_CON_VERIFICACION =
  'Si los datos son válidos, te enviamos un email para activar tu cuenta. Revisá tu bandeja de entrada (y el correo no deseado).';

const register = async (req, res) => {
  try {
    const { email, dni, contrasena, nomYape } = req.body;
    const exigeVerificacion = requiereVerificacionEmail();

    const usuarioExistente = await prisma.usuario.findFirst({
      where: { OR: [{ email }, { dni }] }
    });

    if (exigeVerificacion) {
      // Respuesta idéntica exista o no la cuenta: así el registro no sirve
      // para averiguar qué emails o DNI están registrados.
      if (usuarioExistente) {
        // Mismo costo de CPU que un alta real, para no delatarse por tiempo.
        await bcrypt.hash(contrasena, 12);
        if (usuarioExistente.email === email) {
          segundoPlano(enviarSiPermitido('duplicado', usuarioExistente.email,
            () => emailRegistroDuplicado({ to: usuarioExistente.email, nombre: usuarioExistente.nomYape })));
        }
        return res.status(202).json({ ok: true, requiereVerificacion: true, message: MENSAJE_REGISTRO_CON_VERIFICACION });
      }

      const hashedPassword = await bcrypt.hash(contrasena, 12);
      const tokenPlano = crypto.randomBytes(32).toString('hex');
      await prisma.usuario.create({
        data: {
          email, dni, contrasena: hashedPassword, nomYape,
          emailVerificado: false,
          verificacionToken: sha256(tokenPlano),
          verificacionExpira: new Date(Date.now() + VERIFICACION_TTL_MS),
          paciente: { create: {} }
        }
      });
      segundoPlano(enviarSiPermitido('verificacion', email,
        () => emailVerificacionCuenta({ to: email, nombre: nomYape, link: `${origenFrontend()}/?verificar=${tokenPlano}` })));
      return res.status(202).json({ ok: true, requiereVerificacion: true, message: MENSAJE_REGISTRO_CON_VERIFICACION });
    }

    // Sin verificación (desarrollo/demo): alta directa, con mensaje de conflicto explícito.
    if (usuarioExistente) {
      return res.status(409).json({ ok: false, message: 'El email o DNI ya está registrado' });
    }

    const hashedPassword = await bcrypt.hash(contrasena, 12);
    const nuevoUsuario = await prisma.usuario.create({
      data: {
        email,
        dni,
        contrasena: hashedPassword,
        nomYape,
        // El documento pide que se asigne el rol paciente por defecto
        paciente: {
          create: {} // Crea el registro en la tabla Paciente vacío, asociado a este usuario
        }
      }
    });

    res.status(201).json({
      ok: true,
      message: 'Usuario registrado exitosamente como paciente',
      data: { id: nuevoUsuario.idUsuario, email: nuevoUsuario.email }
    });

  } catch (error) {
    registrarError(error);
    // Carrera entre dos registros simultáneos con el mismo email/dni
    if (error.code === 'P2002') {
      if (requiereVerificacionEmail()) {
        return res.status(202).json({ ok: true, requiereVerificacion: true, message: MENSAJE_REGISTRO_CON_VERIFICACION });
      }
      return res.status(409).json({ ok: false, message: 'El email o DNI ya está registrado' });
    }
    res.status(500).json({ ok: false, error: 'Error interno del servidor' });
  }
};

// Confirma el email con el enlace que llegó por correo.
const verificarEmail = async (req, res) => {
  try {
    const usuario = await prisma.usuario.findUnique({ where: { verificacionToken: sha256(req.body.token) } });
    if (!usuario || !usuario.verificacionExpira || usuario.verificacionExpira.getTime() < Date.now()) {
      return res.status(400).json({ ok: false, message: 'El enlace no es válido o ya venció. Pedí uno nuevo.' });
    }
    await prisma.usuario.update({
      where: { idUsuario: usuario.idUsuario },
      data: { emailVerificado: true, verificacionToken: null, verificacionExpira: null }
    });
    res.json({ ok: true, message: 'Email verificado. Ya podés iniciar sesión.' });
  } catch (error) {
    registrarError(error);
    res.status(500).json({ ok: false, error: 'Error interno del servidor' });
  }
};

// Reenvía el enlace de verificación. Responde siempre lo mismo.
const reenviarVerificacion = async (req, res) => {
  try {
    const usuario = await prisma.usuario.findUnique({ where: { email: req.body.email } });
    if (usuario && usuario.activo && !usuario.emailVerificado) {
      await enviarVerificacion(usuario);
    } else {
      await igualarTiempo('verificacion', req.body.email);
    }
    res.json({
      ok: true,
      message: 'Si la cuenta existe y falta verificarla, te enviamos un nuevo enlace. Si ya pediste uno hace poco, esperá unos minutos antes de pedir otro.'
    });
  } catch (error) {
    registrarError(error);
    res.status(500).json({ ok: false, error: 'Error interno del servidor' });
  }
};

const login = async (req, res) => {
  try {
    const { identificador, contrasena } = req.body;

    // 1. Buscamos si el usuario existe (por DNI o por email, ambos únicos),
    // junto con sus perfiles para saber el rol
    const usuario = await prisma.usuario.findUnique({
      where: /^\d{7,9}$/.test(identificador) ? { dni: identificador } : { email: identificador },
      include: { paciente: true, medico: true, admin: true }
    });

    // 2. Comparamos la contraseña encriptada. Corremos bcrypt.compare SIEMPRE
    // (incluso si el usuario no existe, contra un hash "señuelo") para que el
    // tiempo de respuesta no delate si un email está registrado o no.
    // 1.1 Tope de fallos por cuenta. Si la cuenta existe se cuenta por id (así dar el
    // DNI o el email no duplica los intentos); si no existe, por la huella de lo que
    // se escribió. Hacia afuera el comportamiento es el mismo: no revela si la cuenta existe.
    const claveFallos = usuario ? `login:fallos:u${usuario.idUsuario}` : `login:fallos:${huella(identificador)}`;
    const fallos = await leer(claveFallos);
    if (fallos >= limiteFallosPorCuenta()) {
      return res.status(429).json({
        ok: false,
        message: 'Demasiados intentos fallidos con esta cuenta. Probá de nuevo en unos minutos, o recuperá tu contraseña.'
      });
    }

    const passwordValida = await bcrypt.compare(contrasena, usuario?.contrasena || HASH_SENUELO);
    if (!usuario || !passwordValida) {
      await incrementar(claveFallos, VENTANA_FALLOS_MS);
      return res.status(401).json({ ok: false, message: mensajeCredencialesInvalidas() });
    }
    if (fallos > 0) await reiniciar(claveFallos); // entró bien: arranca de cero

    // 2.1 Bloqueamos el acceso si la cuenta fue desactivada por un administrador
    if (!usuario.activo) {
      return res.status(403).json({ ok: false, message: 'Tu cuenta está desactivada. Contactá a un administrador.' });
    }

    // 2.2 La contraseña es correcta pero el email nunca se confirmó. Hacia
    // afuera es IDÉNTICO a una contraseña incorrecta (mismo código y mensaje):
    // así nadie puede usar el login para saber si una cuenta existe. Para no
    // dejar al usuario legítimo sin salida, se le reenvía el enlace (sin
    // insistir si ya se le mandó uno hace poco).
    if (!usuario.emailVerificado) {
      res.status(401).json({ ok: false, message: mensajeCredencialesInvalidas() });
      const enlaceReciente = usuario.verificacionExpira && usuario.verificacionExpira.getTime() - Date.now() > VERIFICACION_TTL_MS - 60 * 60 * 1000;
      if (!enlaceReciente) {
        segundoPlano(enviarVerificacion(usuario));
      }
      return;
    }

    const rol = derivarRol(usuario);
    const sesion = await crearSesion(usuario.idUsuario);
    const { accessToken, refreshToken } = generarTokens(usuario, rol, sesion);
    setRefreshCookie(res, refreshToken);

    res.json({
      ok: true,
      message: 'Inicio de sesión exitoso',
      token: accessToken,
      usuario: usuarioDeSesion(usuario, rol)
    });

  } catch (error) {
    registrarError(error);
    res.status(500).json({ ok: false, error: 'Error interno del servidor' });
  }
};

// Renueva el Access Token usando el Refresh Token de la cookie httpOnly.
// El frontend guarda el Access Token solo en memoria (nunca en localStorage),
// así que necesita poder pedir uno nuevo cada vez que recarga la página o
// cuando el actual vence (15 min).
const refresh = async (req, res) => {
  try {
    const token = req.cookies?.[REFRESH_COOKIE_NAME];
    if (!token) {
      return res.status(401).json({ ok: false, message: 'No hay una sesión para renovar' });
    }

    let payload;
    try {
      payload = jwt.verify(token, process.env.JWT_REFRESH_SECRET, { algorithms: ['HS256'] });
    } catch {
      res.clearCookie(REFRESH_COOKIE_NAME, { path: '/api/auth' });
      return res.status(401).json({ ok: false, message: 'La sesión venció, iniciá sesión de nuevo' });
    }

    const sesion = await prisma.sesion.findUnique({
      where: { idSesion: payload.sid ?? -1 },
      include: { usuario: { include: { paciente: true, medico: true, admin: true } } }
    });
    const usuario = sesion?.usuario;

    // La sesión tiene que existir (logout/cambio de contraseña la borran), ser
    // de este usuario y no haber vencido; la cuenta, seguir activa y verificada.
    // Tokens anteriores a un cambio de contraseña llevan una versión vieja.
    if (
      !sesion || sesion.usuarioId !== payload.id || sesion.expiraEn.getTime() < Date.now() ||
      !usuario.activo || !usuario.emailVerificado || (payload.tv ?? 0) !== usuario.tokenVersion
    ) {
      res.clearCookie(REFRESH_COOKIE_NAME, { path: '/api/auth' });
      return res.status(401).json({ ok: false, message: 'Sesión inválida' });
    }

    // Rotación con detección de reutilización. Las sesiones anteriores a la rotación
    // (jtiActual nulo) se aceptan una vez y empiezan a rotar.
    const jti = payload.jti ?? null;
    let rotar = true;
    if (sesion.jtiActual !== null && jti !== sesion.jtiActual) {
      const reciente = sesion.rotadaEn && Date.now() - sesion.rotadaEn.getTime() < GRACIA_ROTACION_MS;
      if (jti !== null && jti === sesion.jtiAnterior && reciente) {
        rotar = false; // dos renovaciones casi simultáneas: la segunda no rota
      } else {
        // Se presentó un refresh token que ya había sido reemplazado: alguien tiene una
        // copia. No se sabe quién es el legítimo, así que se revoca la sesión entera.
        await prisma.sesion.deleteMany({ where: { idSesion: sesion.idSesion } });
        console.warn(`[seguridad] Refresh token reutilizado: sesión ${sesion.idSesion} del usuario ${sesion.usuarioId}. Sesión revocada.`);
        res.clearCookie(REFRESH_COOKIE_NAME, { path: '/api/auth' });
        return res.status(401).json({ ok: false, message: 'Sesión inválida' });
      }
    }

    const rol = derivarRol(usuario);
    // Renovación "deslizante": cada uso extiende la sesión otros 7 días.
    const vence = new Date(Date.now() + REFRESH_TOKEN_TTL_MS);
    let sesionVigente = sesion;
    if (rotar) {
      const jtiNuevo = nuevoJti();
      // "Comparar y cambiar": si otra renovación se adelantó entre la lectura y acá,
      // no rotamos de nuevo (count 0) y respondemos solo con un access token.
      const { count } = await prisma.sesion.updateMany({
        where: { idSesion: sesion.idSesion, jtiActual: sesion.jtiActual },
        data: { jtiAnterior: sesion.jtiActual, jtiActual: jtiNuevo, rotadaEn: new Date(), expiraEn: vence }
      });
      if (count === 1) sesionVigente = { ...sesion, jtiActual: jtiNuevo };
      else rotar = false;
    }
    if (!rotar) {
      await prisma.sesion.updateMany({ where: { idSesion: sesion.idSesion }, data: { expiraEn: vence } });
    }
    const { accessToken, refreshToken } = generarTokens(usuario, rol, sesionVigente);
    // Cookie nueva solo si se rotó; si no, el navegador conserva la que ya tiene.
    if (rotar) setRefreshCookie(res, refreshToken);

    res.json({
      ok: true,
      token: accessToken,
      usuario: usuarioDeSesion(usuario, rol)
    });
  } catch (error) {
    registrarError(error);
    res.status(500).json({ ok: false, error: 'Error interno del servidor' });
  }
};

// Cierra la sesión de verdad: borra su fila (el refresh y el access token de
// esa sesión dejan de valer al instante) y limpia la cookie. Si la cookie falta
// o está vencida igual se limpia, sin error.
const logout = async (req, res) => {
  try {
    const token = req.cookies?.[REFRESH_COOKIE_NAME];
    if (token) {
      const payload = jwt.verify(token, process.env.JWT_REFRESH_SECRET, { algorithms: ['HS256'], ignoreExpiration: true });
      if (payload.sid) {
        await prisma.sesion.deleteMany({ where: { idSesion: payload.sid, usuarioId: payload.id } });
      }
    }
  } catch {
    // cookie inválida/manipulada: no hay sesión que cerrar
  }
  res.clearCookie(REFRESH_COOKIE_NAME, { path: '/api/auth' });
  res.json({ ok: true, message: 'Sesión cerrada' });
};

// Cierra la sesión en TODOS los dispositivos (por ejemplo si se perdió el celular).
const logoutTodas = async (req, res) => {
  try {
    await prisma.$transaction([
      prisma.sesion.deleteMany({ where: { usuarioId: req.usuario.id } }),
      prisma.usuario.update({ where: { idUsuario: req.usuario.id }, data: { tokenVersion: { increment: 1 } } }),
    ]);
    res.clearCookie(REFRESH_COOKIE_NAME, { path: '/api/auth' });
    res.json({ ok: true, message: 'Cerraste sesión en todos tus dispositivos' });
  } catch (error) {
    registrarError(error);
    res.status(500).json({ ok: false, error: 'Error interno del servidor' });
  }
};

const obtenerPerfil = async (req, res) => {
  try {
    // Si llegamos hasta acá, es porque el middleware (verificarToken) nos dejó pasar
    const usuario = await prisma.usuario.findUnique({
      where: { idUsuario: req.usuario.id },
      include: { paciente: true, medico: true, admin: true }
    });

    if (!usuario || !usuario.activo) {
      return res.status(401).json({ ok: false, message: 'Usuario no válido' });
    }

    const rol = derivarRol(usuario);

    res.json({
      ok: true,
      usuario: serializarPerfil(usuario, rol)
    });
  } catch (error) {
    registrarError(error);
    res.status(500).json({ ok: false, error: 'Error interno del servidor' });
  }
};

// Actualiza los datos personales comunes a cualquier rol (por ahora, el
// nombre). Los campos propios de un rol —obraSocial/telefono de un
// paciente— se editan en su propio endpoint (ver paciente.controller.js).
const actualizarPerfil = async (req, res) => {
  try {
    const { nomYape } = req.body;

    const usuario = await prisma.usuario.update({
      where: { idUsuario: req.usuario.id },
      data: { nomYape },
      include: { paciente: true, medico: true, admin: true }
    });

    res.json({
      ok: true,
      message: 'Perfil actualizado con éxito',
      usuario: serializarPerfil(usuario, req.usuario.rol)
    });
  } catch (error) {
    registrarError(error);
    res.status(500).json({ ok: false, error: 'Error interno del servidor' });
  }
};

const cambiarContrasena = async (req, res) => {
  try {
    const { contrasenaActual, contrasenaNueva } = req.body;

    const usuario = await prisma.usuario.findUnique({
      where: { idUsuario: req.usuario.id },
      include: { paciente: true, medico: true, admin: true }
    });
    if (!usuario) {
      return res.status(401).json({ ok: false, message: 'Usuario no válido' });
    }

    const passwordValida = await bcrypt.compare(contrasenaActual, usuario.contrasena);
    if (!passwordValida) {
      return res.status(401).json({ ok: false, message: 'La contraseña actual es incorrecta' });
    }

    if (await bcrypt.compare(contrasenaNueva, usuario.contrasena)) {
      return res.status(400).json({ ok: false, message: 'La contraseña nueva tiene que ser distinta de la actual' });
    }
    // Lo que depende de la cuenta (DNI, email, nombre) no lo puede ver el schema.
    const conContexto = problemasDeContrasena(contrasenaNueva, { email: usuario.email, dni: usuario.dni, nombre: usuario.nomYape })
      .filter((m) => /DNI|email|nombre/.test(m));
    if (conContexto.length > 0) {
      return res.status(400).json({ ok: false, message: conContexto[0] });
    }

    const hashNuevo = await bcrypt.hash(contrasenaNueva, 12);
    // Cierra TODAS las sesiones (si alguien tenía la contraseña vieja o un
    // refresh token robado, deja de servirle) y abre una nueva para esta.
    const { actualizado, sesion } = await prisma.$transaction(async (tx) => {
      const actualizado = await tx.usuario.update({
        where: { idUsuario: usuario.idUsuario },
        data: { contrasena: hashNuevo, tokenVersion: { increment: 1 }, debeCambiarContrasena: false }
      });
      await tx.sesion.deleteMany({ where: { usuarioId: usuario.idUsuario } });
      return { actualizado, sesion: await crearSesion(usuario.idUsuario, tx) };
    });

    const rol = derivarRol(usuario);
    const { accessToken, refreshToken } = generarTokens(actualizado, rol, sesion);
    setRefreshCookie(res, refreshToken);

    res.json({
      ok: true,
      message: 'Contraseña actualizada con éxito',
      token: accessToken,
      usuario: usuarioDeSesion(actualizado, rol)
    });
  } catch (error) {
    registrarError(error);
    res.status(500).json({ ok: false, error: 'Error interno del servidor' });
  }
};

// Pide el reset: si el email existe y está activo, genera un token de un
// solo uso (se guarda hasheado, nunca en texto plano) y lo manda por email.
// La respuesta es SIEMPRE la misma exista o no el email — si no, este
// endpoint serviría para averiguar qué emails están registrados.
const olvideContrasena = async (req, res) => {
  try {
    const { email } = req.body;
    const usuario = await prisma.usuario.findUnique({ where: { email } });

    const control = usuario && usuario.activo ? await permitirCorreo('recuperacion', usuario.email) : null;

    if (control?.permitido) {
      const tokenPlano = crypto.randomBytes(32).toString('hex');
      const tokenHasheado = crypto.createHash('sha256').update(tokenPlano).digest('hex');

      await prisma.usuario.update({
        where: { idUsuario: usuario.idUsuario },
        data: {
          resetPasswordToken: tokenHasheado,
          resetPasswordExpira: new Date(Date.now() + RESET_TOKEN_TTL_MS),
        }
      });

      const link = `${origenFrontend()}/?reset=${tokenPlano}`;
      segundoPlano(emailResetContrasena({ to: usuario.email, nombre: usuario.nomYape, link }));
    } else if (control) {
      // Pidió otro enlace demasiado pronto: no se genera un token nuevo, así el
      // enlace que ya recibió sigue siendo válido (y nadie puede anularlo repitiendo el pedido).
      avisarOmitido('recuperacion', control.motivo);
      await operacionVacia();
    } else {
      await igualarTiempo('recuperacion', email);
    }

    res.json({
      ok: true,
      message: 'Si ese email está registrado, te enviamos un enlace para recuperar tu contraseña. Si ya pediste uno hace poco, esperá unos minutos antes de pedir otro.'
    });
  } catch (error) {
    registrarError(error);
    res.status(500).json({ ok: false, error: 'Error interno del servidor' });
  }
};

// Completa el reset: valida el token (hasheado, comparado contra lo
// guardado) y su vencimiento, y si es válido cambia la contraseña.
const resetearContrasena = async (req, res) => {
  try {
    const { token, contrasenaNueva } = req.body;
    const tokenHasheado = crypto.createHash('sha256').update(token).digest('hex');

    const usuario = await prisma.usuario.findUnique({ where: { resetPasswordToken: tokenHasheado } });

    if (!usuario || !usuario.resetPasswordExpira || usuario.resetPasswordExpira.getTime() < Date.now()) {
      return res.status(400).json({ ok: false, message: 'El enlace no es válido o ya venció. Pedí uno nuevo.' });
    }

    const hashNuevo = await bcrypt.hash(contrasenaNueva, 12);
    // Cerrar todas las sesiones; y como el enlace llegó a su casilla, el email
    // queda verificado y ya no hace falta cambiar una contraseña inicial.
    await prisma.$transaction([
      prisma.usuario.update({
        where: { idUsuario: usuario.idUsuario },
        data: {
          contrasena: hashNuevo, resetPasswordToken: null, resetPasswordExpira: null,
          tokenVersion: { increment: 1 }, emailVerificado: true, debeCambiarContrasena: false
        }
      }),
      prisma.sesion.deleteMany({ where: { usuarioId: usuario.idUsuario } }),
    ]);

    res.json({ ok: true, message: 'Contraseña actualizada. Ya podés iniciar sesión.' });
  } catch (error) {
    registrarError(error);
    res.status(500).json({ ok: false, error: 'Error interno del servidor' });
  }
};

module.exports = {
  register,
  login,
  refresh,
  logout,
  logoutTodas,
  verificarEmail,
  reenviarVerificacion,
  obtenerPerfil,
  actualizarPerfil,
  cambiarContrasena,
  olvideContrasena,
  resetearContrasena
};
