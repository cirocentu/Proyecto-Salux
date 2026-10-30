const test = require('node:test');
const assert = require('node:assert/strict');
const nodemailer = require('nodemailer');

// Se reemplaza el transporte ANTES de cargar utils/email: nunca sale un mail real.
const enviados = [];
let fallar = false;
nodemailer.createTransport = () => ({
  sendMail: async (mensaje) => {
    if (fallar) throw new Error('SMTP caído');
    enviados.push(mensaje);
    return { messageId: 'id-falso' };
  },
});
process.env.SMTP_HOST = 'smtp.falso.test';
process.env.EMAIL_FROM = 'Salux <no-reply@salux.test>';
delete process.env.VERCEL;

const email = require('../../src/utils/email');

test.beforeEach(() => { enviados.length = 0; fallar = false; });

test('el mail de turno creado sale al destinatario con los datos del turno', async () => {
  await email.emailTurnoCreado({
    to: 'ana@correo.com', nombrePaciente: 'Ana', nombreMedico: 'Dr. Pérez',
    fechaTexto: 'lunes 2 de marzo de 2026', horaTexto: '10:00', consultorio: 'Consultorio A',
  });
  assert.equal(enviados.length, 1);
  assert.equal(enviados[0].to, 'ana@correo.com');
  assert.equal(enviados[0].from, 'Salux <no-reply@salux.test>');
  assert.match(enviados[0].html, /Dr\. Pérez/);
  assert.match(enviados[0].html, /10:00/);
});

test('los datos cargados por usuarios se escapan (no se puede inyectar HTML)', async () => {
  await email.emailVerificacionCuenta({
    to: 'x@correo.com',
    nombre: '<script>alert(1)</script><img src=x onerror=1>',
    link: 'https://salux.test/?verificar=abc"onmouseover="mal',
  });
  const html = enviados[0].html;
  assert.ok(!html.includes('<script>'));
  assert.ok(!html.includes('<img'));
  assert.ok(html.includes('&lt;script&gt;'));
  assert.ok(!html.includes('"onmouseover="'));
});

test('si el envío falla, no lanza error (nunca tumba la operación que lo dispara)', async () => {
  fallar = true;
  await assert.doesNotReject(email.emailTurnoCancelado({
    to: 'ana@correo.com', nombrePaciente: 'Ana', nombreMedico: 'Dr. Pérez', fechaTexto: 'hoy', horaTexto: '10:00',
  }));
  assert.equal(enviados.length, 0);
});

test('cada plantilla tiene su asunto', async () => {
  const base = { to: 'a@b.com', nombre: 'A', nombrePaciente: 'A', nombreMedico: 'M', fechaTexto: 'f', horaTexto: 'h', link: 'https://x.test' };
  await email.emailTurnoConfirmado(base);
  await email.emailResetContrasena(base);
  await email.emailRegistroDuplicado(base);
  assert.deepEqual(
    enviados.map((m) => m.subject),
    ['Tu turno fue confirmado', 'Recuperá tu contraseña de Salux', 'Intento de registro en Salux']
  );
});

test('cada mail incluye una versión de texto plano con los datos y el enlace', async () => {
  await email.emailResetContrasena({ to: 'a@b.com', nombre: 'Ana', link: 'https://salux.test/?reset=abc&x=1' });
  const { text, html } = enviados[0];
  assert.ok(html.includes('<a '), 'el HTML conserva el botón');
  assert.ok(!/<[a-z][^>]*>/i.test(text), 'el texto no tiene etiquetas');
  assert.match(text, /Hola Ana,/);
  assert.match(text, /Elegir nueva contraseña: https:\/\/salux\.test\/\?reset=abc&x=1/);
});

test('el texto plano no reintroduce HTML escapado como etiquetas', () => {
  const texto = email.htmlATexto('<p>Hola &lt;b&gt;Ana&lt;/b&gt; &amp; Co</p>');
  assert.equal(texto, 'Hola <b>Ana</b> & Co');
});
