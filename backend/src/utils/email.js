const nodemailer = require('nodemailer');

// En Vercel la función se congela apenas se envía la respuesta: un mail "en
// segundo plano" se perdería. waitUntil mantiene viva la invocación hasta que
// termine el envío. Fuera de Vercel no hace falta (el proceso sigue corriendo).
let waitUntil = null;
if (process.env.VERCEL) {
  try {
    ({ waitUntil } = require('@vercel/functions'));
  } catch {
    // sin el paquete: se envía igual, pero sin garantía de terminar
  }
}

// El transporter se arma una sola vez, la primera vez que hace falta.
let transporter;
let intentado = false;

function obtenerTransporter() {
  if (intentado) return transporter;
  intentado = true;

  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS } = process.env;
  if (!SMTP_HOST) {
    // Sin SMTP configurado en .env: no es un error — el entorno de
    // desarrollo/demo puede no tener credenciales, y el envío de email
    // nunca debe ser un requisito para que el resto de la app funcione.
    return null;
  }

  transporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port: Number(SMTP_PORT) || 587,
    secure: Number(SMTP_PORT) === 465,
    auth: SMTP_USER ? { user: SMTP_USER, pass: SMTP_PASS } : undefined,
  });
  return transporter;
}

// Los nombres y demás datos los carga un usuario: se escapan antes de armar el
// HTML para que nadie pueda inyectar enlaces o etiquetas en un mail de Salux.
const esc = (valor) =>
  String(valor ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

// Envuelve el contenido en un layout mínimo consistente. `cuerpoHtml` es una
// lista de párrafos/bloques ya armados por cada plantilla específica.
function layoutBase(titulo, cuerpoHtml) {
  return `
    <div style="font-family: -apple-system, Segoe UI, Roboto, Arial, sans-serif; max-width: 480px; margin: 0 auto; color: #1E293B;">
      <div style="background: #2563EB; padding: 20px 24px; border-radius: 12px 12px 0 0;">
        <span style="color: #fff; font-weight: 700; font-size: 18px;">Salux</span>
      </div>
      <div style="background: #F8FAFC; padding: 24px; border: 1px solid #E2E8F0; border-top: none; border-radius: 0 0 12px 12px;">
        <h2 style="margin: 0 0 16px; font-size: 18px; color: #0F172A;">${titulo}</h2>
        ${cuerpoHtml}
        <p style="margin-top: 24px; font-size: 12px; color: #94A3B8;">Este es un mensaje automático de Salux, no hace falta que lo respondas.</p>
      </div>
    </div>
  `;
}

// Versión de texto plano del mismo mensaje. Los filtros de spam desconfían de los
// mails que son solo HTML, y algunos clientes muestran únicamente el texto. Los
// enlaces se conservan como "etiqueta: url".
function htmlATexto(html) {
  return html
    .replace(/<a\s[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, (_, url, etiqueta) => `${etiqueta.replace(/<[^>]+>/g, '').trim()}: ${url}`)
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|h2|div)>/gi, '\n\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&')
    .split('\n').map((linea) => linea.trim()).join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// Envía un email; si SMTP no está configurado, o si el envío falla, solo lo
// registra en consola — nunca debe tirar abajo la operación que lo dispara
// (crear un turno, pedir un reset de contraseña, etc.).
function enviarEmail(datos) {
  const envio = enviarEmailAhora(datos);
  if (waitUntil) waitUntil(envio);
  return envio;
}

async function enviarEmailAhora({ to, subject, html }) {
  const t = obtenerTransporter();
  if (!t) {
    console.log(`[email] SMTP no configurado — se omite el envío a ${to}: "${subject}"`);
    return;
  }
  try {
    const info = await t.sendMail({ from: process.env.EMAIL_FROM || 'Salux <no-reply@salux.local>', to, subject, html, text: htmlATexto(html) });
    console.log(`[email] Enviado a ${to} — "${subject}" (messageId: ${info.messageId})`);
  } catch (error) {
    console.error('[email] No se pudo enviar el correo:', error.message);
  }
}

function emailTurnoCreado({ to, nombrePaciente, nombreMedico, fechaTexto, horaTexto, consultorio }) {
  return enviarEmail({
    to,
    subject: 'Confirmamos tu turno en Salux',
    html: layoutBase('¡Reservaste un turno!', `
      <p>Hola ${esc(nombrePaciente)},</p>
      <p>Tu turno quedó reservado con <strong>${esc(nombreMedico)}</strong>:</p>
      <p style="background:#fff; border:1px solid #E2E8F0; border-radius:8px; padding:12px 16px;">
        📅 ${esc(fechaTexto)}<br>🕑 ${esc(horaTexto)}<br>📍 ${esc(consultorio)}
      </p>
      <p>Todavía está pendiente de que el médico lo confirme. Te avisamos apenas cambie de estado.</p>
    `),
  });
}

function emailTurnoConfirmado({ to, nombrePaciente, nombreMedico, fechaTexto, horaTexto }) {
  return enviarEmail({
    to,
    subject: 'Tu turno fue confirmado',
    html: layoutBase('Turno confirmado ✅', `
      <p>Hola ${esc(nombrePaciente)},</p>
      <p><strong>${esc(nombreMedico)}</strong> confirmó tu turno del ${esc(fechaTexto)} a las ${esc(horaTexto)}.</p>
    `),
  });
}

function emailTurnoCancelado({ to, nombrePaciente, nombreMedico, fechaTexto, horaTexto }) {
  return enviarEmail({
    to,
    subject: 'Tu turno fue cancelado',
    html: layoutBase('Turno cancelado', `
      <p>Hola ${esc(nombrePaciente)},</p>
      <p>Tu turno con <strong>${esc(nombreMedico)}</strong> del ${esc(fechaTexto)} a las ${esc(horaTexto)} fue cancelado.</p>
      <p>Si fue un error, podés reservar uno nuevo desde la app cuando quieras.</p>
    `),
  });
}

function emailResetContrasena({ to, nombre, link }) {
  return enviarEmail({
    to,
    subject: 'Recuperá tu contraseña de Salux',
    html: layoutBase('Recuperar contraseña', `
      <p>Hola ${esc(nombre)},</p>
      <p>Pediste restablecer tu contraseña. Este enlace vale por 1 hora:</p>
      <p><a href="${esc(link)}" style="display:inline-block; background:#2563EB; color:#fff; text-decoration:none; padding:10px 18px; border-radius:8px; font-weight:600;">Elegir nueva contraseña</a></p>
      <p style="font-size:13px; color:#64748B;">Si no fuiste vos, podés ignorar este mensaje — tu contraseña actual sigue funcionando.</p>
    `),
  });
}

function emailVerificacionCuenta({ to, nombre, link }) {
  return enviarEmail({
    to,
    subject: 'Activá tu cuenta de Salux',
    html: layoutBase('Confirmá tu email', `
      <p>Hola ${esc(nombre)},</p>
      <p>Gracias por registrarte en Salux. Confirmá tu email para activar la cuenta (el enlace vale 24 horas):</p>
      <p><a href="${esc(link)}" style="display:inline-block; background:#2563EB; color:#fff; text-decoration:none; padding:10px 18px; border-radius:8px; font-weight:600;">Activar mi cuenta</a></p>
      <p style="font-size:13px; color:#64748B;">Si no fuiste vos, ignorá este mensaje: sin confirmar, la cuenta no se puede usar.</p>
    `),
  });
}

// Alguien intentó registrar un email que ya tiene cuenta. Se le avisa al
// dueño real (el registro, hacia afuera, responde igual para no revelar nada).
function emailRegistroDuplicado({ to, nombre }) {
  return enviarEmail({
    to,
    subject: 'Intento de registro en Salux',
    html: layoutBase('Ya tenés una cuenta', `
      <p>Hola ${esc(nombre)},</p>
      <p>Alguien intentó registrarse en Salux con tu email, pero ya tenés una cuenta.</p>
      <p>Si fuiste vos, iniciá sesión o usá "¿Olvidaste tu contraseña?". Si no, podés ignorar este mensaje: tu cuenta no fue modificada.</p>
    `),
  });
}

module.exports = {
  htmlATexto,
  enviarEmail,
  emailVerificacionCuenta,
  emailRegistroDuplicado,
  emailTurnoCreado,
  emailTurnoConfirmado,
  emailTurnoCancelado,
  emailResetContrasena,
};
