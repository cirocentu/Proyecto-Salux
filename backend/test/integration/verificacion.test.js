const test = require('node:test');
const assert = require('node:assert/strict');
const { app, prisma, request, sha256, limpiarBase } = require('../helpers');

// Aparte de auth.test.js: el registro tiene un límite de 10 por IP y cada archivo
// de test corre en su propio proceso (con su propio contador).
test.before(limpiarBase);
test.after(() => prisma.$disconnect());

const datosRegistro = (n) => ({
  email: `nuevo${n}@prueba.test`, dni: `2${String(n).padStart(7, '0')}`, contrasena: 'Zorro-Azul-4721', nomYape: 'Persona Nueva',
});

test.describe('verificación de email', () => {
  test.beforeEach(() => { process.env.REQUIERE_VERIFICACION_EMAIL = 'true'; });

  test('la cuenta nueva queda sin verificar y no puede entrar hasta confirmar', async () => {
    const d = datosRegistro(10);
    const reg = await request(app).post('/api/auth/register').send(d);
    assert.equal(reg.status, 202);
    assert.equal(reg.body.requiereVerificacion, true);

    const u = await prisma.usuario.findUnique({ where: { email: d.email } });
    assert.equal(u.emailVerificado, false);
    assert.ok(u.verificacionToken);

    const antes = await request(app).post('/api/auth/login').send({ identificador: d.email, contrasena: d.contrasena });
    assert.equal(antes.status, 401);

    // El token plano solo viaja por mail: se reemplaza por uno conocido.
    await prisma.usuario.update({ where: { email: d.email }, data: { verificacionToken: sha256('token-conocido') } });
    const ver = await request(app).post('/api/auth/verificar-email').send({ token: 'token-conocido' });
    assert.equal(ver.status, 200);

    const despues = await request(app).post('/api/auth/login').send({ identificador: d.email, contrasena: d.contrasena });
    assert.equal(despues.status, 200);
  });

  test('el token se usa una sola vez', async () => {
    const d = datosRegistro(11);
    await request(app).post('/api/auth/register').send(d);
    await prisma.usuario.update({ where: { email: d.email }, data: { verificacionToken: sha256('un-solo-uso') } });
    assert.equal((await request(app).post('/api/auth/verificar-email').send({ token: 'un-solo-uso' })).status, 200);
    assert.equal((await request(app).post('/api/auth/verificar-email').send({ token: 'un-solo-uso' })).status, 400);
  });

  test('un enlace vencido o inventado se rechaza', async () => {
    const d = datosRegistro(12);
    await request(app).post('/api/auth/register').send(d);
    await prisma.usuario.update({
      where: { email: d.email },
      data: { verificacionToken: sha256('vencido'), verificacionExpira: new Date(Date.now() - 1000) },
    });
    assert.equal((await request(app).post('/api/auth/verificar-email').send({ token: 'vencido' })).status, 400);
    assert.equal((await request(app).post('/api/auth/verificar-email').send({ token: 'inventado' })).status, 400);
  });

  test('registrar un email ya existente responde igual y no revela la cuenta', async () => {
    const d = datosRegistro(13);
    const primera = await request(app).post('/api/auth/register').send(d);
    const repetida = await request(app).post('/api/auth/register').send(d);
    assert.equal(repetida.status, primera.status);
    assert.deepEqual(repetida.body, primera.body);
    assert.equal(await prisma.usuario.count({ where: { email: d.email } }), 1);
  });

  test('"credenciales inválidas" es idéntico para contraseña mala y cuenta sin verificar', async () => {
    const d = datosRegistro(14);
    await request(app).post('/api/auth/register').send(d);
    const sinVerificar = await request(app).post('/api/auth/login').send({ identificador: d.email, contrasena: d.contrasena });
    const claveMala = await request(app).post('/api/auth/login').send({ identificador: d.email, contrasena: 'ClaveIncorrecta9' });
    const inexistente = await request(app).post('/api/auth/login').send({ identificador: 'nadie@prueba.test', contrasena: 'ClaveIncorrecta9' });
    assert.equal(sinVerificar.status, 401);
    assert.deepEqual(sinVerificar.body, claveMala.body);
    assert.deepEqual(sinVerificar.body, inexistente.body);
  });

  test('/api/config informa si la verificación está activa', async () => {
    assert.equal((await request(app).get('/api/config')).body.data.requiereVerificacionEmail, true);
    process.env.REQUIERE_VERIFICACION_EMAIL = 'false';
    assert.equal((await request(app).get('/api/config')).body.data.requiereVerificacionEmail, false);
  });
});
