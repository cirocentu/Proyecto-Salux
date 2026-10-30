const test = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');
const {
  app, prisma, request, CLAVE, limpiarBase, crearUsuario, iniciarSesion, conToken,
} = require('../helpers');

test.beforeEach(limpiarBase);
test.after(() => prisma.$disconnect());

const valorDeCookie = (cookies) => (cookies || []).find((c) => c.startsWith('refreshToken='))?.split(';')[0].slice('refreshToken='.length);
const refrescar = (valor) => request(app).post('/api/auth/refresh').set('Cookie', `refreshToken=${valor}`);
const jtiDe = (valor) => jwt.decode(valor).jti;
const sesionDe = (usuarioId) => prisma.sesion.findFirst({ where: { usuarioId }, orderBy: { idSesion: 'desc' } });

// Como si la última rotación hubiera sido hace un minuto (fuera de la tolerancia de unos segundos).
const envejecerRotacion = (usuarioId) =>
  prisma.sesion.updateMany({ where: { usuarioId }, data: { rotadaEn: new Date(Date.now() - 60 * 1000) } });

test.describe('rotación del refresh token', () => {
  test('cada renovación entrega un refresh token nuevo, y el login ya trae jti', async () => {
    const u = await crearUsuario();
    const { cookie } = await iniciarSesion(u.email);
    const c0 = valorDeCookie(cookie);
    assert.ok(jtiDe(c0), 'el refresh token del login lleva jti');

    const r1 = await refrescar(c0);
    const c1 = valorDeCookie(r1.headers['set-cookie']);
    assert.equal(r1.status, 200);
    assert.ok(c1);
    assert.notEqual(c1, c0);
    assert.notEqual(jtiDe(c1), jtiDe(c0));

    const sesion = await sesionDe(u.idUsuario);
    assert.equal(sesion.jtiActual, jtiDe(c1));
    assert.equal(sesion.jtiAnterior, jtiDe(c0));
  });

  test('la cadena de renovaciones sigue funcionando una tras otra', async () => {
    const u = await crearUsuario();
    let cookie = valorDeCookie((await iniciarSesion(u.email)).cookie);
    for (let i = 0; i < 4; i += 1) {
      const res = await refrescar(cookie);
      assert.equal(res.status, 200, `renovación ${i + 1}`);
      assert.equal((await request(app).get('/api/auth/perfil').set(conToken(res.body.token))).status, 200);
      cookie = valorDeCookie(res.headers['set-cookie']);
      await envejecerRotacion(u.idUsuario);
    }
  });

  test('presentar un token ya rotado revoca la sesión: también muere el token nuevo y el access token', async () => {
    const u = await crearUsuario();
    const { cookie, token } = await iniciarSesion(u.email);
    const robada = valorDeCookie(cookie); // la copia que tiene el atacante
    const legitima = valorDeCookie((await refrescar(robada)).headers['set-cookie']); // el usuario renueva
    await envejecerRotacion(u.idUsuario);

    const intento = await refrescar(robada); // el atacante usa la copia vieja
    assert.equal(intento.status, 401);
    assert.match((intento.headers['set-cookie'] || []).join(';'), /refreshToken=;/, 'se limpia la cookie');
    assert.equal(await prisma.sesion.count({ where: { usuarioId: u.idUsuario } }), 0, 'la sesión se borró');

    assert.equal((await refrescar(legitima)).status, 401, 'el token legítimo más reciente ya no sirve');
    assert.equal((await request(app).get('/api/auth/perfil').set(conToken(token))).status, 401, 'tampoco el access token');
  });

  test('la revocación afecta solo a esa sesión: los otros dispositivos siguen entrando', async () => {
    const u = await crearUsuario();
    const celular = await iniciarSesion(u.email);
    const notebook = await iniciarSesion(u.email);
    const copia = valorDeCookie(celular.cookie);
    await refrescar(copia);
    await envejecerRotacion(u.idUsuario);
    assert.equal((await refrescar(copia)).status, 401);

    assert.equal((await refrescar(valorDeCookie(notebook.cookie))).status, 200);
  });

  test('dos renovaciones simultáneas (dos pestañas) no cierran la sesión', async () => {
    const u = await crearUsuario();
    const c0 = valorDeCookie((await iniciarSesion(u.email)).cookie);

    const [a, b] = await Promise.all([refrescar(c0), refrescar(c0)]);
    assert.equal(a.status, 200);
    assert.equal(b.status, 200);
    const cookies = [valorDeCookie(a.headers['set-cookie']), valorDeCookie(b.headers['set-cookie'])].filter(Boolean);
    assert.equal(cookies.length, 1, 'solo una de las dos rota; la otra deja la cookie como está');

    assert.equal((await refrescar(cookies[0])).status, 200, 'la cookie nueva funciona');
    assert.equal(await prisma.sesion.count({ where: { usuarioId: u.idUsuario } }), 1);
  });

  test('repetir el token anterior segundos después de rotar se tolera, sin rotar de nuevo', async () => {
    const u = await crearUsuario();
    const c0 = valorDeCookie((await iniciarSesion(u.email)).cookie);
    const c1 = valorDeCookie((await refrescar(c0)).headers['set-cookie']);

    const repetido = await refrescar(c0); // dentro de la tolerancia
    assert.equal(repetido.status, 200);
    assert.equal(valorDeCookie(repetido.headers['set-cookie']), undefined, 'no entrega una cookie nueva');
    assert.equal((await sesionDe(u.idUsuario)).jtiActual, jtiDe(c1), 'el token vigente sigue siendo el de la primera rotación');
    assert.equal((await refrescar(c1)).status, 200);
  });

  test('pasada la tolerancia, el token anterior ya delata un robo', async () => {
    const u = await crearUsuario();
    const c0 = valorDeCookie((await iniciarSesion(u.email)).cookie);
    await refrescar(c0);
    await envejecerRotacion(u.idUsuario);
    assert.equal((await refrescar(c0)).status, 401);
  });

  test('un token sin jti, cuando la sesión ya rota, se trata como reutilización', async () => {
    const u = await crearUsuario();
    await iniciarSesion(u.email);
    const sesion = await sesionDe(u.idUsuario);
    const sinJti = jwt.sign({ id: u.idUsuario, tv: 0, sid: sesion.idSesion }, process.env.JWT_REFRESH_SECRET, { expiresIn: '7d', algorithm: 'HS256' });

    assert.equal((await refrescar(sinJti)).status, 401);
    assert.equal(await prisma.sesion.count({ where: { usuarioId: u.idUsuario } }), 0);
  });

  test('un jti inventado se rechaza y revoca la sesión', async () => {
    const u = await crearUsuario();
    await iniciarSesion(u.email);
    const sesion = await sesionDe(u.idUsuario);
    const falso = jwt.sign({ id: u.idUsuario, tv: 0, sid: sesion.idSesion, jti: 'inventado' }, process.env.JWT_REFRESH_SECRET, { expiresIn: '7d', algorithm: 'HS256' });
    assert.equal((await refrescar(falso)).status, 401);
    assert.equal(await prisma.sesion.count({ where: { usuarioId: u.idUsuario } }), 0);
  });
});

test.describe('sesiones anteriores a la rotación (compatibilidad con el despliegue)', () => {
  test('una sesión sin jti sigue renovando y pasa a rotar', async () => {
    const u = await crearUsuario();
    const sesion = await prisma.sesion.create({ data: { usuarioId: u.idUsuario, expiraEn: new Date(Date.now() + 86400000) } });
    assert.equal(sesion.jtiActual, null);
    const viejo = jwt.sign({ id: u.idUsuario, tv: 0, sid: sesion.idSesion }, process.env.JWT_REFRESH_SECRET, { expiresIn: '7d', algorithm: 'HS256' });

    const res = await refrescar(viejo);
    assert.equal(res.status, 200);
    const nuevo = valorDeCookie(res.headers['set-cookie']);
    assert.ok(jtiDe(nuevo));
    assert.equal((await sesionDe(u.idUsuario)).jtiActual, jtiDe(nuevo));
    assert.equal((await refrescar(nuevo)).status, 200);
  });
});

test.describe('vencimiento y cierre de sesión', () => {
  test('cada renovación extiende la sesión (vencimiento deslizante)', async () => {
    const u = await crearUsuario();
    const c0 = valorDeCookie((await iniciarSesion(u.email)).cookie);
    await prisma.sesion.updateMany({ where: { usuarioId: u.idUsuario }, data: { expiraEn: new Date(Date.now() + 3600 * 1000) } });
    await refrescar(c0);
    const dias = ((await sesionDe(u.idUsuario)).expiraEn.getTime() - Date.now()) / 86400000;
    assert.ok(dias > 6.9 && dias <= 7, `quedan ${dias.toFixed(2)} días`);
  });

  test('cerrar sesión con la cookie ya rotada funciona', async () => {
    const u = await crearUsuario();
    const c0 = valorDeCookie((await iniciarSesion(u.email)).cookie);
    const c1 = valorDeCookie((await refrescar(c0)).headers['set-cookie']);
    assert.equal((await request(app).post('/api/auth/logout').set('Cookie', `refreshToken=${c1}`)).status, 200);
    assert.equal(await prisma.sesion.count({ where: { usuarioId: u.idUsuario } }), 0);
  });

  test('al cambiar la contraseña la sesión nueva también rota', async () => {
    const u = await crearUsuario();
    const { token } = await iniciarSesion(u.email);
    const cambio = await request(app).patch('/api/auth/perfil/contrasena').set(conToken(token))
      .send({ contrasenaActual: CLAVE, contrasenaNueva: 'NuevaClave-Verde-5530' });
    const c0 = valorDeCookie(cambio.headers['set-cookie']);
    assert.ok(jtiDe(c0));
    const r = await refrescar(c0);
    assert.equal(r.status, 200);
    assert.notEqual(jtiDe(valorDeCookie(r.headers['set-cookie'])), jtiDe(c0));
  });
});

test.describe('tope de sesiones por usuario', () => {
  test('al pasar de 10 se cierran las más antiguas', async () => {
    const u = await crearUsuario();
    const sesiones = [];
    for (let i = 0; i < 12; i += 1) sesiones.push(await iniciarSesion(u.email));

    assert.equal(await prisma.sesion.count({ where: { usuarioId: u.idUsuario } }), 10);
    assert.equal((await request(app).get('/api/auth/perfil').set(conToken(sesiones[0].token))).status, 401, 'la más antigua se cerró');
    assert.equal((await request(app).get('/api/auth/perfil').set(conToken(sesiones[1].token))).status, 401);
    assert.equal((await request(app).get('/api/auth/perfil').set(conToken(sesiones[2].token))).status, 200);
    assert.equal((await request(app).get('/api/auth/perfil').set(conToken(sesiones[11].token))).status, 200, 'la más nueva vale');
  });

  test('el tope es por usuario: los demás no se ven afectados', async () => {
    const a = await crearUsuario();
    const b = await crearUsuario();
    const deB = await iniciarSesion(b.email);
    for (let i = 0; i < 11; i += 1) await iniciarSesion(a.email);
    assert.equal((await request(app).get('/api/auth/perfil').set(conToken(deB.token))).status, 200);
  });
});
