const test = require('node:test');
const assert = require('node:assert/strict');
const nodemailer = require('nodemailer');
const { app, prisma, request, limpiarBase, crearUsuario } = require('../helpers');

// Los correos no salen de verdad: se interceptan antes de que email.js arme su transporte.
const enviados = [];
nodemailer.createTransport = () => ({
  sendMail: async (mensaje) => { enviados.push(mensaje); return { messageId: 'id-falso' }; },
});
process.env.SMTP_HOST = 'smtp.simulado.test';
const email = require('../../src/utils/email');

// Cada pedido sale de una IP distinta: el límite por IP (10 cada 15 min) no es lo que se prueba acá,
// sino que el límite por DIRECCIÓN de correo frene a un atacante que cambia de IP.
app.set('trust proxy', 1);
let contadorIp = 0;
const post = (ruta, cuerpo) => {
  contadorIp += 1;
  return request(app).post(ruta).set('X-Forwarded-For', `10.9.${Math.floor(contadorIp / 250)}.${(contadorIp % 250) + 1}`).send(cuerpo);
};
const pedirRecuperacion = (direccion) => post('/api/auth/olvide-contrasena', { email: direccion });

// Los correos se mandan en segundo plano: se espera un momento para ver cuántos salieron.
const asentar = () => new Promise((resolver) => setTimeout(resolver, 200));
const paraDestino = (direccion) => enviados.filter((m) => m.to === direccion);

// Da por terminada la espera mínima de todos los correos (como si hubieran pasado los minutos).
const terminarEspera = () => prisma.$executeRaw`
  UPDATE "RateLimitContador" SET "expiraEn" = NOW() - interval '1 second' WHERE "clave" LIKE '%correo:espera:%'`;

const tokenDeReset = async (idUsuario) => (await prisma.usuario.findUnique({ where: { idUsuario } })).resetPasswordToken;

test.beforeEach(async () => {
  await limpiarBase();
  enviados.length = 0;
  for (const nombre of ['CORREO_ESPERA_MINUTOS', 'CORREOS_POR_DIA_Y_DIRECCION', 'CORREOS_ABUSABLES_POR_DIA']) delete process.env[nombre];
});
test.after(() => prisma.$disconnect());

test.describe('recuperar contraseña', () => {
  test('repetir el pedido no manda más correos ni anula el enlace vigente', async () => {
    const victima = await crearUsuario({ email: 'victima@correo.test' });
    const respuestas = [];
    for (let i = 0; i < 8; i += 1) respuestas.push(await pedirRecuperacion(victima.email));
    const tokenTrasPrimero = await tokenDeReset(victima.idUsuario);
    await asentar();

    assert.ok(respuestas.every((r) => r.status === 200));
    assert.equal(paraDestino(victima.email).length, 1, 'un solo correo, no ocho');
    assert.ok(tokenTrasPrimero, 'el primer pedido sí generó el enlace');
    assert.equal(await tokenDeReset(victima.idUsuario), tokenTrasPrimero, 'el enlace vigente no se pisa');
  });

  test('el enlace que llegó por correo sigue funcionando después de que alguien insiste', async () => {
    const victima = await crearUsuario({ email: 'victima2@correo.test' });
    await pedirRecuperacion(victima.email)
    await asentar();
    const enlace = paraDestino(victima.email)[0].html.match(/\?reset=([a-f0-9]+)/)[1];

    for (let i = 0; i < 5; i += 1) await pedirRecuperacion(victima.email);
    const res = await post('/api/auth/resetear-contrasena', { token: enlace, contrasenaNueva: 'Recuperada-Gris-3318' });
    assert.equal(res.status, 200, 'el enlace original sigue siendo válido');
  });

  test('la respuesta es idéntica exista o no la cuenta, incluso repitiendo', async () => {
    const real = await crearUsuario({ email: 'real@correo.test' });
    for (let i = 0; i < 3; i += 1) {
      const conCuenta = await pedirRecuperacion(real.email);
      const sinCuenta = await pedirRecuperacion('fantasma@correo.test');
      assert.equal(conCuenta.status, sinCuenta.status);
      assert.deepEqual(conCuenta.body, sinCuenta.body);
    }
    await asentar();
    assert.equal(paraDestino('fantasma@correo.test').length, 0);
  });

  test('pasada la espera se puede pedir otro enlace, y el anterior deja de valer', async () => {
    const usuario = await crearUsuario({ email: 'espera@correo.test' });
    await pedirRecuperacion(usuario.email);
    const primero = await tokenDeReset(usuario.idUsuario);
    await terminarEspera();
    await pedirRecuperacion(usuario.email);
    await asentar();

    assert.equal(paraDestino(usuario.email).length, 2);
    assert.notEqual(await tokenDeReset(usuario.idUsuario), primero);
  });

  test('tope diario por dirección: aunque pase la espera, no salen más de N correos al día', async () => {
    process.env.CORREOS_POR_DIA_Y_DIRECCION = '3';
    const usuario = await crearUsuario({ email: 'tope@correo.test' });
    for (let i = 0; i < 6; i += 1) {
      await pedirRecuperacion(usuario.email);
      await terminarEspera();
    }
    await asentar();
    assert.equal(paraDestino(usuario.email).length, 3);
  });

  test('la espera es configurable', async () => {
    process.env.CORREO_ESPERA_MINUTOS = '60';
    const usuario = await crearUsuario({ email: 'config@correo.test' });
    await pedirRecuperacion(usuario.email);
    const [fila] = await prisma.$queryRaw`
      SELECT EXTRACT(EPOCH FROM ("expiraEn" - NOW())) AS segundos FROM "RateLimitContador" WHERE "clave" LIKE 'correo:espera:recuperacion:%'`;
    assert.ok(Number(fila.segundos) > 59 * 60 && Number(fila.segundos) <= 60 * 60);
  });
});

test.describe('no se puede averiguar qué cuentas existen midiendo la respuesta', () => {
  // En vez de medir milisegundos (inestable), se cuentan las operaciones que hace la base:
  // si son las mismas, el tiempo de respuesta no depende de que la cuenta exista.
  let grabando = null;
  prisma.$use(async (params, next) => {
    if (grabando) grabando.push(params.action);
    return next(params);
  });
  const operacionesDe = async (peticion) => {
    grabando = [];
    await peticion();
    const hechas = grabando;
    grabando = null;
    return hechas.map((a) => (a === 'updateMany' ? 'update' : a)); // update y updateMany cuestan lo mismo
  };

  test('recuperar contraseña: cuenta real e inexistente hacen las mismas operaciones', async () => {
    const real = await crearUsuario({ email: 'real.tiempo@correo.test' });
    const conCuenta = await operacionesDe(() => pedirRecuperacion(real.email));
    const sinCuenta = await operacionesDe(() => pedirRecuperacion('nadie.tiempo@correo.test'));
    assert.ok(conCuenta.length >= 4, `operaciones: ${conCuenta.join(', ')}`);
    assert.deepEqual(sinCuenta, conCuenta);
  });

  test('reenviar verificación: cuenta sin verificar e inexistente hacen las mismas operaciones', async () => {
    const real = await crearUsuario({ email: 'sinverificar.tiempo@correo.test', extra: { emailVerificado: false } });
    const conCuenta = await operacionesDe(() => post('/api/auth/reenviar-verificacion', { email: real.email }));
    const sinCuenta = await operacionesDe(() => post('/api/auth/reenviar-verificacion', { email: 'nadie.tiempo@correo.test' }));
    assert.deepEqual(sinCuenta, conCuenta);
  });

  test('también cuando el pedido cae dentro de la espera (el caso más barato para el atacante)', async () => {
    const real = await crearUsuario({ email: 'espera.tiempo@correo.test' });
    await pedirRecuperacion(real.email);
    await pedirRecuperacion('nadie.espera@correo.test');
    const conCuenta = await operacionesDe(() => pedirRecuperacion(real.email));
    const sinCuenta = await operacionesDe(() => pedirRecuperacion('nadie.espera@correo.test'));
    assert.deepEqual(sinCuenta, conCuenta, `real: ${conCuenta.join(',')} / inexistente: ${sinCuenta.join(',')}`);
  });
});

test.describe('presupuesto diario de correos abusables', () => {
  test('al agotarse, dejan de salir esos correos pero los esenciales (turnos) siguen saliendo', async () => {
    process.env.CORREOS_ABUSABLES_POR_DIA = '2';
    const usuarios = [];
    for (let i = 0; i < 4; i += 1) usuarios.push(await crearUsuario({ email: `presupuesto${i}@correo.test` }));
    for (const u of usuarios) await pedirRecuperacion(u.email);
    await asentar();
    assert.equal(enviados.length, 2, 'solo 2 de los 4 pedidos llegan a mandar correo');

    await email.emailTurnoCreado({
      to: 'paciente@correo.test', nombrePaciente: 'Ana', nombreMedico: 'Dr. Pérez', fechaTexto: 'lunes', horaTexto: '10:00', consultorio: 'A',
    });
    assert.equal(paraDestino('paciente@correo.test').length, 1, 'el correo de un turno no depende de ese presupuesto');
  });

  test('los pedidos para direcciones SIN cuenta no gastan el presupuesto real', async () => {
    process.env.CORREOS_ABUSABLES_POR_DIA = '2';
    for (let i = 0; i < 6; i += 1) await pedirRecuperacion(`nadie${i}@correo.test`);
    const a = await crearUsuario({ email: 'a@correo.test' });
    const b = await crearUsuario({ email: 'b@correo.test' });
    await pedirRecuperacion(a.email);
    await pedirRecuperacion(b.email);
    await asentar();
    assert.equal(enviados.length, 2, 'las dos cuentas reales siguen recibiendo su correo');
  });
});

test.describe('verificación de email', () => {
  test('reenviar el enlace varias veces manda un solo correo y no cambia el enlace vigente', async () => {
    const usuario = await crearUsuario({ email: 'sinverificar@correo.test', extra: { emailVerificado: false } });
    for (let i = 0; i < 5; i += 1) {
      const res = await post('/api/auth/reenviar-verificacion', { email: usuario.email });
      assert.equal(res.status, 200);
    }
    const token = (await prisma.usuario.findUnique({ where: { idUsuario: usuario.idUsuario } })).verificacionToken;
    await post('/api/auth/reenviar-verificacion', { email: usuario.email });
    await asentar();

    assert.equal(paraDestino(usuario.email).length, 1);
    assert.equal((await prisma.usuario.findUnique({ where: { idUsuario: usuario.idUsuario } })).verificacionToken, token);
  });

  test('la respuesta de reenviar es la misma para una cuenta inexistente o ya verificada', async () => {
    const verificada = await crearUsuario({ email: 'verificada@correo.test' });
    const a = await post('/api/auth/reenviar-verificacion', { email: verificada.email });
    const b = await post('/api/auth/reenviar-verificacion', { email: 'nadie@correo.test' });
    assert.deepEqual(a.body, b.body);
  });

  test('registrarse con un correo ajeno repetidas veces avisa al dueño una sola vez', async () => {
    process.env.REQUIERE_VERIFICACION_EMAIL = 'true';
    const duenio = await crearUsuario({ email: 'duenio@correo.test' });
    for (let i = 0; i < 4; i += 1) {
      const res = await post('/api/auth/register', {
        email: duenio.email, dni: `3${String(i).padStart(7, '0')}`, contrasena: 'Zorro-Azul-4721', nomYape: 'Intruso Insistente',
      });
      assert.equal(res.status, 202);
    }
    await asentar();
    process.env.REQUIERE_VERIFICACION_EMAIL = 'false';
    assert.equal(paraDestino(duenio.email).filter((m) => /Intento de registro/.test(m.subject)).length, 1);
  });
});

test.describe('privacidad de los contadores', () => {
  test('la base no guarda direcciones de correo, solo huellas', async () => {
    const usuario = await crearUsuario({ email: 'privado@correo.test' });
    await pedirRecuperacion(usuario.email);
    await pedirRecuperacion('otra.persona@correo.test');
    const claves = (await prisma.rateLimitContador.findMany()).map((f) => f.clave);
    assert.ok(claves.some((c) => c.startsWith('correo:espera:recuperacion:')));
    assert.ok(claves.every((c) => !c.includes('@') && !c.includes('correo.test')), `claves: ${claves.join(', ')}`);
  });
});
