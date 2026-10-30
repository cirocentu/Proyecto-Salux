// En los tests (NODE_ENV=test) el .env NO pisa lo que ya definió test/entorno.js:
// si lo hiciera, los tests terminarían apuntando a la base de desarrollo.
require('dotenv').config({ override: process.env.NODE_ENV !== 'test' });

const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const rateLimit = require('express-rate-limit');

const prisma = require('./config/prisma');
const { opcionesDeStore } = require('./config/rateLimitStore');
const { validarEntorno } = require('./config/validarEntorno');
const { registrarError } = require('./utils/registrarError');

const authRoutes = require('./routes/auth.routes');
const especialidadRoutes = require('./routes/especialidad.routes');
const medicoRoutes = require('./routes/medico.routes');
const turnoRoutes = require('./routes/turno.routes');
const pacienteRoutes = require('./routes/paciente.routes');
const disponibilidadRoutes = require('./routes/disponibilidad.routes');
const cronRoutes = require('./routes/cron.routes');
const { iniciarVencimientoDeTurnos } = require('./jobs/vencerTurnosPendientes');

const app = express();
const PORT = process.env.PORT || 3000;
const NODE_ENV = process.env.NODE_ENV || 'development';

// Detrás de un proxy (Render, Railway, Nginx) hay que decirle a Express
// cuántos saltos confiar para que req.ip sea la IP real del cliente. Por
// defecto NO se confía en ninguno: si el servidor está expuesto directo, un
// atacante puede mandar un X-Forwarded-For falso y evadir todos los límites
// por IP. Configurar TRUST_PROXY=1 (o el número de proxies) solo en producción.
const TRUST_PROXY = process.env.TRUST_PROXY;
app.set('trust proxy', TRUST_PROXY && /^\d+$/.test(TRUST_PROXY) ? Number(TRUST_PROXY) : false);

// En producción todo tiene que ir por HTTPS (la cookie de sesión es `Secure`).
// El TLS lo termina el proxy inverso; `req.secure` sale de X-Forwarded-Proto
// gracias a `trust proxy`. El health check queda afuera para los balanceadores.
if (NODE_ENV === 'production' && process.env.FORZAR_HTTPS !== 'false') {
  app.use((req, res, next) => {
    if (req.secure || req.path === '/api/health') return next();
    return res.redirect(308, `https://${req.headers.host}${req.originalUrl}`);
  });
}

app.use(helmet());
app.use(
  cors({
    // Con credentials:true el navegador NO permite origin:"*" — hace falta
    // una lista explícita, porque el refresh token viaja en una cookie.
    // Se recortan los espacios ("https://a.com, https://b.com"): sin eso el segundo origen
    // nunca coincidía y el CORS fallaba en silencio.
    origin: process.env.CORS_ORIGIN ? process.env.CORS_ORIGIN.split(',').map((o) => o.trim()).filter(Boolean) : 'http://localhost:5173',
    credentials: true,
  })
);
app.use(express.json({ limit: '10kb' }));
app.use(cookieParser());

// Límite general para toda la API. Con RATE_LIMIT_STORE=db (Vercel) el contador vive
// en la base: es el único modo de que valga para TODAS las instancias serverless (en
// memoria, cada una contaba por su lado y en la práctica no limitaba nada). Si la base
// falla, deja pasar las peticiones en vez de agravar la caída. El health check queda
// afuera para que un monitor no genere escrituras ni se bloquee solo.
app.use(
  rateLimit({
    windowMs: 15 * 60 * 1000,
    max: Number(process.env.API_LIMITE_PETICIONES) > 0 ? Number(process.env.API_LIMITE_PETICIONES) : 300,
    standardHeaders: true,
    legacyHeaders: false,
    skip: (req) => req.path === '/api/health',
    ...opcionesDeStore('api'),
  })
);

// Límite estricto para login/registro (mitiga fuerza bruta).
// Cada ruta necesita su PROPIA instancia: express-rate-limit cuenta por IP,
// así que reutilizar una sola instancia para dos rutas distintas hace que
// compartan el mismo cupo de intentos en vez de tener uno independiente cada una.
// Cada limiter lleva un `prefijo` propio para su contador en Redis (si hay).
const crearLimiterAuth = (prefijo, opciones = {}) =>
  rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 10,
    standardHeaders: true,
    legacyHeaders: false,
    message: { ok: false, message: 'Demasiados intentos. Probá de nuevo más tarde.' },
    ...opcionesDeStore(prefijo),
    ...opciones,
  });

// Login: solo cuentan los intentos FALLIDOS (entrar bien no gasta cupo) y hay
// dos límites a la vez: uno por IP + cuenta (frena la fuerza bruta sobre un
// usuario sin bloquear al resto de una red compartida, como una facultad) y
// uno más amplio por IP (frena a quien prueba muchas cuentas distintas).
const limiterLoginPorCuenta = crearLimiterAuth('login-cuenta', {
  skipSuccessfulRequests: true,
  keyGenerator: (req) => `${req.ip}|${String(req.body?.identificador || '').trim().toLowerCase()}`,
});
const limiterLoginPorIp = crearLimiterAuth('login-ip', { skipSuccessfulRequests: true, max: 50 });
app.use('/api/auth/login', limiterLoginPorIp, limiterLoginPorCuenta);
app.use('/api/auth/register', crearLimiterAuth('register'));
app.use('/api/auth/olvide-contrasena', crearLimiterAuth('olvide'));
app.use('/api/auth/resetear-contrasena', crearLimiterAuth('resetear'));
app.use('/api/auth/verificar-email', crearLimiterAuth('verificar'));
app.use('/api/auth/reenviar-verificacion', crearLimiterAuth('reenvio'));
// Cambiar contraseña exige la actual: sin límite serviría para adivinarla
// con un access token robado.
app.use('/api/auth/perfil/contrasena', crearLimiterAuth('cambio-contrasena', { skipSuccessfulRequests: true }));

app.use('/api/auth', authRoutes);
app.use('/api/especialidades', especialidadRoutes);
app.use('/api/medicos', medicoRoutes);
app.use('/api/turnos', turnoRoutes);
app.use('/api/pacientes', pacienteRoutes);
app.use('/api/disponibilidad', disponibilidadRoutes);
app.use('/api/cron', cronRoutes);

// Configuración pública que necesita la interfaz (sin datos sensibles).
app.get('/api/config', (req, res) => {
  res.json({ ok: true, data: { requiereVerificacionEmail: process.env.REQUIERE_VERIFICACION_EMAIL === 'true' } });
});

app.get('/api/health', async (req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({ ok: true, message: '¡Servidor funcionando!' });
  } catch (error) {
    res.status(500).json({ ok: false, error: 'No se pudo conectar a la base de datos' });
  }
});

// Cualquier ruta no definida
app.use((req, res) => {
  res.status(404).json({ ok: false, message: 'Ruta no encontrada' });
});

// Manejador de errores centralizado (red de seguridad ante errores no atrapados)
app.use((err, req, res, next) => {
  registrarError(err);
  res.status(err.status || 500).json({
    ok: false,
    error: NODE_ENV === 'production' ? 'Error interno del servidor' : err.message,
  });
});

// Solo se levanta el servidor al ejecutar `node src/app.js` (no al importar la
// app, por ejemplo desde los tests).
if (require.main === module) {
  const { errores, avisos } = validarEntorno();
  avisos.forEach((aviso) => console.warn(`[config] AVISO: ${aviso}`));
  if (errores.length > 0) {
    errores.forEach((error) => console.error(`[config] ERROR: ${error}`));
    console.error('[config] Configuración insegura o incompleta: el servidor no se inicia.');
    process.exit(1);
  }

  const server = app.listen(PORT, () => {
    console.log(`Servidor corriendo en http://localhost:${PORT} [${NODE_ENV}]`);
    iniciarVencimientoDeTurnos();
  });

  const apagarConGracia = (signal) => {
    console.log(`\n${signal} recibido. Cerrando servidor...`);
    server.close(async () => {
      await prisma.$disconnect();
      process.exit(0);
    });
  };

  process.on('SIGINT', () => apagarConGracia('SIGINT'));
  process.on('SIGTERM', () => apagarConGracia('SIGTERM'));
}

module.exports = app;
