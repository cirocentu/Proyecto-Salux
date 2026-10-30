const test = require('node:test');
const assert = require('node:assert/strict');
const { app, prisma, request, CLAVE, limpiarBase, crearUsuario } = require('../helpers');

// Cada intento sale de una IP distinta: así NO se activan los límites por IP, que es
// justamente el caso a probar (una red de máquinas atacando una sola cuenta).
app.set('trust proxy', 1);
let contadorIp = 0;
const login = (identificador, contrasena) => {
  contadorIp += 1;
  return request(app)
    .post('/api/auth/login')
    .set('X-Forwarded-For', `10.8.${Math.floor(contadorIp / 250)}.${(contadorIp % 250) + 1}`)
    .send({ identificador, contrasena });
};

const fallar = async (identificador, veces) => {
  for (let i = 0; i < veces; i += 1) {
    const res = await login(identificador, 'Equivocada-0000');
    assert.equal(res.status, 401, `intento ${i + 1}`);
  }
};

test.beforeEach(async () => {
  await limpiarBase();
  process.env.LOGIN_FALLOS_POR_CUENTA = '5';
});
test.after(async () => {
  delete process.env.LOGIN_FALLOS_POR_CUENTA;
  await prisma.$disconnect();
});

test('tras N fallos desde IPs distintas la cuenta se bloquea, incluso con la contraseña correcta', async () => {
  const victima = await crearUsuario();
  await fallar(victima.email, 5)
  const bloqueado = await login(victima.email, CLAVE);
  assert.equal(bloqueado.status, 429);
  assert.match(bloqueado.body.message, /Demasiados intentos fallidos/);
});

test('el bloqueo de una cuenta no afecta a las demás', async () => {
  const victima = await crearUsuario();
  const otra = await crearUsuario();
  await fallar(victima.email, 5);
  assert.equal((await login(victima.email, CLAVE)).status, 429);
  assert.equal((await login(otra.email, CLAVE)).status, 200);
});

test('usar el DNI o el email no duplica los intentos: cuentan juntos', async () => {
  const victima = await crearUsuario();
  await fallar(victima.email, 3);
  await fallar(victima.dni, 2);
  assert.equal((await login(victima.dni, CLAVE)).status, 429);
  assert.equal((await login(victima.email, CLAVE)).status, 429);
});

test('una cuenta inexistente se comporta igual: no se puede saber si existe', async () => {
  const real = await crearUsuario();
  await fallar(real.email, 5);
  await fallar('fantasma@correo.test', 5);

  const conCuenta = await login(real.email, CLAVE);
  const sinCuenta = await login('fantasma@correo.test', CLAVE);
  assert.equal(conCuenta.status, 429);
  assert.equal(sinCuenta.status, 429);
  assert.deepEqual(conCuenta.body, sinCuenta.body);
});

test('pasada la ventana vuelve a dejar entrar', async () => {
  const victima = await crearUsuario();
  await fallar(victima.email, 5);
  assert.equal((await login(victima.email, CLAVE)).status, 429);

  await prisma.$executeRaw`UPDATE "RateLimitContador" SET "expiraEn" = NOW() - interval '1 second' WHERE "clave" LIKE 'login:fallos:%'`;
  assert.equal((await login(victima.email, CLAVE)).status, 200);
});

test('entrar bien reinicia la cuenta: los fallos anteriores no se acumulan', async () => {
  const usuario = await crearUsuario();
  await fallar(usuario.email, 4);
  assert.equal((await login(usuario.email, CLAVE)).status, 200);
  await fallar(usuario.email, 4); // si no se hubiera reiniciado, el 2.º fallo ya bloquearía
  assert.equal((await login(usuario.email, CLAVE)).status, 200);
});

test('recuperar la contraseña sigue disponible aunque la cuenta esté bloqueada', async () => {
  const victima = await crearUsuario();
  await fallar(victima.email, 5);
  assert.equal((await login(victima.email, CLAVE)).status, 429);

  contadorIp += 1;
  const res = await request(app).post('/api/auth/olvide-contrasena').set('X-Forwarded-For', `10.7.0.${contadorIp % 250 + 1}`).send({ email: victima.email });
  assert.equal(res.status, 200);
});

test('los contadores no guardan el DNI ni el email', async () => {
  const usuario = await crearUsuario({ email: 'privado2@correo.test' });
  await fallar(usuario.email, 2);
  await fallar('desconocido@correo.test', 1);
  const claves = (await prisma.rateLimitContador.findMany({ where: { clave: { startsWith: 'login:fallos:' } } })).map((f) => f.clave);
  assert.ok(claves.length >= 2);
  assert.ok(claves.every((c) => !c.includes('@') && !c.includes(usuario.dni)));
});

test('con el valor por defecto el tope es de 30 fallos', async () => {
  delete process.env.LOGIN_FALLOS_POR_CUENTA;
  const usuario = await crearUsuario();
  await prisma.rateLimitContador.create({
    data: { clave: `login:fallos:u${usuario.idUsuario}`, hits: 29, expiraEn: new Date(Date.now() + 600000) },
  });
  assert.equal((await login(usuario.email, 'Equivocada-0000')).status, 401); // el 30.º fallo
  assert.equal((await login(usuario.email, CLAVE)).status, 429);
});
