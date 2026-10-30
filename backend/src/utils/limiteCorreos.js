const crypto = require('crypto');
const { incrementar } = require('./contadores');

// Límites sobre los correos que dispara CUALQUIER persona sin estar logueada
// (recuperar contraseña, reenviar la verificación, aviso de registro duplicado).
// Sin esto, repetir el pedido para la dirección de otra persona:
//   - le llena la casilla de correos con nuestra marca,
//   - invalida una y otra vez su enlace de recuperación (el token se pisa), y
//   - gasta la cuota diaria del proveedor de email (300/día en el plan gratis),
//     dejando sin correos a toda la plataforma (turnos, verificaciones...).
//
// Tres barreras, en este orden:
//   1. Espera mínima por dirección y tipo de correo (por defecto 5 minutos).
//      Mientras corre, NO se genera un token nuevo: el enlace vigente sigue válido.
//   2. Tope diario por dirección, sumando todos los tipos.
//   3. Presupuesto diario global de estos correos "abusables", para que ningún abuso
//      consuma la cuota de los correos esenciales (confirmación de turnos), que no
//      pasan por acá.
// Todo se cuenta con claves HASHEADAS: la base no guarda direcciones de correo.

const UN_DIA_MS = 24 * 60 * 60 * 1000;

// factor: multiplica la espera mínima. El aviso de "alguien intentó registrarse con
// tu correo" es el menos urgente: espera 6 veces más.
const TIPOS = {
  recuperacion: { factor: 1 },
  verificacion: { factor: 1 },
  duplicado: { factor: 6 },
};

const numero = (valor, porDefecto) => {
  const n = Number(valor);
  return Number.isFinite(n) && n > 0 ? n : porDefecto;
};

// Se leen en cada llamada (no al cargar el módulo) para que se puedan ajustar sin reiniciar y probar.
function configuracion() {
  return {
    esperaMs: numero(process.env.CORREO_ESPERA_MINUTOS, 5) * 60 * 1000,
    porDia: numero(process.env.CORREOS_POR_DIA_Y_DIRECCION, 6),
    abusablesPorDia: numero(process.env.CORREOS_ABUSABLES_POR_DIA, 100),
  };
}

const huella = (email) => crypto.createHash('sha256').update(String(email).trim().toLowerCase()).digest('hex').slice(0, 32);

// ¿Se puede mandar este correo ahora? Devuelve { permitido, motivo }.
//
// `simulado: true` se usa para direcciones SIN cuenta: ejecuta exactamente las mismas
// operaciones sobre claves "sombra" (sin tocar el presupuesto real). Así la respuesta
// tarda lo mismo exista o no la cuenta, y el endpoint no sirve para averiguar qué
// correos están registrados midiendo tiempos.
async function permitirCorreo(tipo, email, { simulado = false } = {}) {
  const { factor } = TIPOS[tipo] || TIPOS.recuperacion;
  const cfg = configuracion();
  const direccion = huella(email);
  const prefijo = simulado ? 'sombra:' : '';

  const enEspera = (await incrementar(`${prefijo}correo:espera:${tipo}:${direccion}`, cfg.esperaMs * factor)) > 1;
  if (enEspera) return { permitido: false, motivo: 'espera' };

  const delDia = await incrementar(`${prefijo}correo:dia:${direccion}`, UN_DIA_MS);
  if (delDia > cfg.porDia) return { permitido: false, motivo: 'tope-diario' };

  const global = await incrementar(`${prefijo}correo:global:abusables`, UN_DIA_MS);
  if (global > cfg.abusablesPorDia) return { permitido: false, motivo: 'presupuesto' };

  return { permitido: true };
}

// Registra (sin la dirección, para no filtrar datos personales a los logs) que un
// correo se omitió y por qué.
function avisarOmitido(tipo, motivo) {
  const detalle = motivo === 'presupuesto' ? ' — se agotó el presupuesto diario de correos abusables' : '';
  console.warn(`[correos] omitido (${motivo}) tipo=${tipo}${detalle}`);
}

module.exports = { permitirCorreo, avisarOmitido, huella };
