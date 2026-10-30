const test = require('node:test');
const assert = require('node:assert/strict');
const {
  app, prisma, request, sha256, CLAVE, limpiarBase, crearUsuario, iniciarSesion, conToken,
} = require('../helpers');

test.before(limpiarBase);
test.after(() => prisma.$disconnect());
const datosRegistro = (n) => ({
  email: `nuevo${n}@prueba.test`, dni: `2${String(n).padStart(7, '0')}`, contrasena: 'Zorro-Azul-4721', nomYape: 'Persona Nueva',
});

test.describe('registro', () => {
  test('crea un paciente y puede iniciar sesión', async () => {
    const datos = datosRegistro(1);
    const res = await request(app).post('/api/auth/register').send(datos);
    assert.equal(res.status, 201);

    const login = await request(app).post('/api/auth/login').send({ identificador: datos.email, contrasena: datos.contrasena });
    assert.equal(login.status, 200);
    assert.equal(login.body.usuario.rol, 'paciente');
    assert.ok(login.body.token);
  });

  test('guarda la contraseña hasheada, nunca en texto plano', async () => {
    const datos = datosRegistro(2);
    await request(app).post('/api/auth/register').send(datos);
    const u = await prisma.usuario.findUnique({ where: { email: datos.email } });
    assert.notEqual(u.contrasena, datos.contrasena);
    assert.match(u.contrasena, /^\$2[aby]\$/);
  });

  test('rechaza contraseñas débiles con el detalle del campo', async () => {
    const res = await request(app).post('/api/auth/register').send({ ...datosRegistro(3), contrasena: 'password123' });
    assert.equal(res.status, 400);
    assert.ok(res.body.errores.some((e) => e.campo === 'contrasena'));
  });

  test('rechaza una contraseña que contiene el DNI', async () => {
    const d = datosRegistro(4);
    const res = await request(app).post('/api/auth/register').send({ ...d, contrasena: `Azul${d.dni}x` });
    assert.equal(res.status, 400);
  });

  test('sin verificación activa, email o DNI repetido da 409', async () => {
    const d = datosRegistro(5);
    await request(app).post('/api/auth/register').send(d);
    const mismoMail = await request(app).post('/api/auth/register').send({ ...d, dni: '29999999' });
    const mismoDni = await request(app).post('/api/auth/register').send({ ...d, email: 'otro@prueba.test' });
    assert.equal(mismoMail.status, 409);
    assert.equal(mismoDni.status, 409);
  });
});

test.describe('login', () => {
  test('acepta email o DNI y devuelve el rol correcto', async () => {
    const medico = await crearUsuario({ rol: 'medico' });
    const admin = await crearUsuario({ rol: 'admin' });
    const porMail = await request(app).post('/api/auth/login').send({ identificador: medico.email, contrasena: CLAVE });
    const porDni = await request(app).post('/api/auth/login').send({ identificador: admin.dni, contrasena: CLAVE });
    assert.equal(porMail.body.usuario.rol, 'medico');
    assert.equal(porDni.body.usuario.rol, 'admin');
  });

  test('el email no distingue mayúsculas', async () => {
    const u = await crearUsuario({ email: 'mayus@prueba.test' });
    const res = await request(app).post('/api/auth/login').send({ identificador: 'MAYUS@Prueba.TEST', contrasena: CLAVE });
    assert.equal(res.status, 200);
    assert.equal(res.body.usuario.id, u.idUsuario);
  });

  test('contraseña incorrecta y usuario inexistente dan la misma respuesta', async () => {
    const u = await crearUsuario();
    const a = await request(app).post('/api/auth/login').send({ identificador: u.email, contrasena: 'Equivocada123' });
    const b = await request(app).post('/api/auth/login').send({ identificador: 'fantasma@prueba.test', contrasena: 'Equivocada123' });
    assert.equal(a.status, 401);
    assert.deepEqual(a.body, b.body);
  });

  test('una cuenta desactivada no puede entrar (403)', async () => {
    const u = await crearUsuario({ extra: { activo: false } });
    const res = await request(app).post('/api/auth/login').send({ identificador: u.email, contrasena: CLAVE });
    assert.equal(res.status, 403);
  });

  test('la cookie de refresh es httpOnly, SameSite=Strict y de alcance /api/auth', async () => {
    const u = await crearUsuario();
    const { cookie } = await iniciarSesion(u.email);
    const c = cookie.find((x) => x.startsWith('refreshToken='));
    assert.ok(c, 'falta la cookie refreshToken');
    assert.match(c, /HttpOnly/i);
    assert.match(c, /SameSite=Strict/i);
    assert.match(c, /Path=\/api\/auth/i);
  });

  test('la respuesta nunca incluye la contraseña ni el hash', async () => {
    const u = await crearUsuario();
    const res = await request(app).post('/api/auth/login').send({ identificador: u.email, contrasena: CLAVE });
    assert.ok(!JSON.stringify(res.body).includes('contrasena'));
    assert.ok(!JSON.stringify(res.body).includes('$2'));
  });
});

test.describe('sesiones y tokens', () => {
  test('sin token o con token inválido, las rutas privadas dan 401', async () => {
    assert.equal((await request(app).get('/api/auth/perfil')).status, 401);
    assert.equal((await request(app).get('/api/auth/perfil').set(conToken('esto.no.es.un.jwt'))).status, 401);
  });

  test('un token firmado con otro secreto se rechaza', async () => {
    const jwt = require('jsonwebtoken');
    const u = await crearUsuario();
    const falso = jwt.sign({ id: u.idUsuario, sid: 1, tv: 0 }, 'otro-secreto-cualquiera-de-treinta-y-pico-caracteres', { algorithm: 'HS256' });
    assert.equal((await request(app).get('/api/auth/perfil').set(conToken(falso))).status, 401);
  });

  test('un token con alg "none" se rechaza', async () => {
    const u = await crearUsuario();
    const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
    const sinFirma = `${b64({ alg: 'none', typ: 'JWT' })}.${b64({ id: u.idUsuario, sid: 1, tv: 0 })}.`;
    assert.equal((await request(app).get('/api/auth/perfil').set(conToken(sinFirma))).status, 401);
  });

  test('el perfil devuelve los datos del usuario logueado', async () => {
    const u = await crearUsuario({ nomYape: 'Laura Test' });
    const { token } = await iniciarSesion(u.email);
    const res = await request(app).get('/api/auth/perfil').set(conToken(token));
    assert.equal(res.status, 200);
    assert.equal(res.body.usuario.nombre, 'Laura Test');
    assert.equal(res.body.usuario.rol, 'paciente');
  });

  test('refresh con la cookie entrega un access token nuevo que funciona', async () => {
    const u = await crearUsuario();
    const { cookie } = await iniciarSesion(u.email);
    const res = await request(app).post('/api/auth/refresh').set('Cookie', cookie);
    assert.equal(res.status, 200);
    assert.equal((await request(app).get('/api/auth/perfil').set(conToken(res.body.token))).status, 200);
  });

  test('refresh sin cookie da 401', async () => {
    assert.equal((await request(app).post('/api/auth/refresh')).status, 401);
  });

  test('logout cierra la sesión de verdad: refresh y access token dejan de servir', async () => {
    const u = await crearUsuario();
    const { token, cookie } = await iniciarSesion(u.email);
    assert.equal((await request(app).post('/api/auth/logout').set('Cookie', cookie)).status, 200);
    assert.equal((await request(app).post('/api/auth/refresh').set('Cookie', cookie)).status, 401);
    assert.equal((await request(app).get('/api/auth/perfil').set(conToken(token))).status, 401);
  });

  test('logout-todas cierra todas las sesiones de la cuenta', async () => {
    const u = await crearUsuario();
    const a = await iniciarSesion(u.email);
    const b = await iniciarSesion(u.email);
    assert.equal((await request(app).post('/api/auth/logout-todas').set(conToken(a.token))).status, 200);
    assert.equal((await request(app).get('/api/auth/perfil').set(conToken(b.token))).status, 401);
    assert.equal((await request(app).post('/api/auth/refresh').set('Cookie', b.cookie)).status, 401);
  });

  test('desactivar la cuenta corta el acceso aunque el token siga vigente', async () => {
    const u = await crearUsuario();
    const { token } = await iniciarSesion(u.email);
    await prisma.usuario.update({ where: { idUsuario: u.idUsuario }, data: { activo: false } });
    assert.equal((await request(app).get('/api/auth/perfil').set(conToken(token))).status, 403);
  });

  test('una sesión vencida en la base ya no vale', async () => {
    const u = await crearUsuario();
    const { token } = await iniciarSesion(u.email);
    await prisma.sesion.updateMany({ where: { usuarioId: u.idUsuario }, data: { expiraEn: new Date(Date.now() - 1000) } });
    assert.equal((await request(app).get('/api/auth/perfil').set(conToken(token))).status, 401);
  });
});

test.describe('cambio de contraseña', () => {
  const NUEVA = 'NuevaClave-Verde-5530';

  test('con la actual correcta cambia, cierra las demás sesiones y entrega un token nuevo', async () => {
    const u = await crearUsuario();
    const otra = await iniciarSesion(u.email);
    const esta = await iniciarSesion(u.email);

    const res = await request(app).patch('/api/auth/perfil/contrasena').set(conToken(esta.token))
      .send({ contrasenaActual: CLAVE, contrasenaNueva: NUEVA });
    assert.equal(res.status, 200);
    assert.ok(res.body.token);

    assert.equal((await request(app).get('/api/auth/perfil').set(conToken(otra.token))).status, 401);
    assert.equal((await request(app).get('/api/auth/perfil').set(conToken(esta.token))).status, 401);
    assert.equal((await request(app).get('/api/auth/perfil').set(conToken(res.body.token))).status, 200);

    assert.equal((await request(app).post('/api/auth/login').send({ identificador: u.email, contrasena: CLAVE })).status, 401);
    assert.equal((await request(app).post('/api/auth/login').send({ identificador: u.email, contrasena: NUEVA })).status, 200);
  });

  test('con la actual incorrecta se rechaza', async () => {
    const u = await crearUsuario();
    const { token } = await iniciarSesion(u.email);
    const res = await request(app).patch('/api/auth/perfil/contrasena').set(conToken(token))
      .send({ contrasenaActual: 'EstaNoEs12345', contrasenaNueva: NUEVA });
    assert.equal(res.status, 401);
  });

  test('la nueva no puede ser igual a la actual ni débil', async () => {
    const u = await crearUsuario();
    const { token } = await iniciarSesion(u.email);
    const igual = await request(app).patch('/api/auth/perfil/contrasena').set(conToken(token))
      .send({ contrasenaActual: CLAVE, contrasenaNueva: CLAVE });
    assert.equal(igual.status, 400);
    const debil = await request(app).patch('/api/auth/perfil/contrasena').set(conToken(token))
      .send({ contrasenaActual: CLAVE, contrasenaNueva: 'corta1' });
    assert.equal(debil.status, 400);
  });

  test('la nueva no puede contener el DNI de la cuenta', async () => {
    const u = await crearUsuario();
    const { token } = await iniciarSesion(u.email);
    const res = await request(app).patch('/api/auth/perfil/contrasena').set(conToken(token))
      .send({ contrasenaActual: CLAVE, contrasenaNueva: `Rojo${u.dni}ab` });
    assert.equal(res.status, 400);
  });
});

test.describe('contraseña inicial (cuentas creadas por el admin)', () => {
  test('hasta cambiarla solo puede ver el perfil y cambiar la contraseña', async () => {
    const m = await crearUsuario({ rol: 'medico', extra: { debeCambiarContrasena: true } });
    const { token } = await iniciarSesion(m.email);

    const bloqueada = await request(app).get('/api/turnos/agenda-medico').set(conToken(token));
    assert.equal(bloqueada.status, 403);
    assert.equal(bloqueada.body.codigo, 'CAMBIO_CONTRASENA_REQUERIDO');
    assert.equal((await request(app).get('/api/auth/perfil').set(conToken(token))).status, 200);

    const cambio = await request(app).patch('/api/auth/perfil/contrasena').set(conToken(token))
      .send({ contrasenaActual: CLAVE, contrasenaNueva: 'Definitiva-Roja-7741' });
    assert.equal(cambio.status, 200);
    assert.equal((await request(app).get('/api/turnos/agenda-medico').set(conToken(cambio.body.token))).status, 200);
  });
});

test.describe('recuperar contraseña', () => {
  test('olvidé-contraseña responde igual exista o no el email', async () => {
    const u = await crearUsuario();
    const existe = await request(app).post('/api/auth/olvide-contrasena').send({ email: u.email });
    const noExiste = await request(app).post('/api/auth/olvide-contrasena').send({ email: 'nadie@prueba.test' });
    assert.equal(existe.status, 200);
    assert.deepEqual(existe.body, noExiste.body);
  });

  test('con un token válido cambia la contraseña, cierra sesiones y el token no se reutiliza', async () => {
    const u = await crearUsuario();
    const { token } = await iniciarSesion(u.email);
    await request(app).post('/api/auth/olvide-contrasena').send({ email: u.email });
    await prisma.usuario.update({ where: { idUsuario: u.idUsuario }, data: { resetPasswordToken: sha256('reset-conocido') } });

    const ok = await request(app).post('/api/auth/resetear-contrasena').send({ token: 'reset-conocido', contrasenaNueva: 'Recuperada-Gris-3318' });
    assert.equal(ok.status, 200);
    assert.equal((await request(app).get('/api/auth/perfil').set(conToken(token))).status, 401);
    assert.equal((await request(app).post('/api/auth/login').send({ identificador: u.email, contrasena: 'Recuperada-Gris-3318' })).status, 200);

    const reuso = await request(app).post('/api/auth/resetear-contrasena').send({ token: 'reset-conocido', contrasenaNueva: 'OtraClave-Azul-9921' });
    assert.equal(reuso.status, 400);
  });

  test('un token vencido se rechaza', async () => {
    const u = await crearUsuario();
    await prisma.usuario.update({
      where: { idUsuario: u.idUsuario },
      data: { resetPasswordToken: sha256('reset-viejo'), resetPasswordExpira: new Date(Date.now() - 1000) },
    });
    const res = await request(app).post('/api/auth/resetear-contrasena').send({ token: 'reset-viejo', contrasenaNueva: 'Recuperada-Gris-3318' });
    assert.equal(res.status, 400);
  });

  test('resetear la contraseña también verifica el email', async () => {
    const u = await crearUsuario({ extra: { emailVerificado: false } });
    await prisma.usuario.update({ where: { idUsuario: u.idUsuario }, data: { resetPasswordToken: sha256('reset-verifica'), resetPasswordExpira: new Date(Date.now() + 3600 * 1000) } });
    await request(app).post('/api/auth/resetear-contrasena').send({ token: 'reset-verifica', contrasenaNueva: 'Recuperada-Gris-3318' });
    assert.equal((await prisma.usuario.findUnique({ where: { idUsuario: u.idUsuario } })).emailVerificado, true);
  });
});
