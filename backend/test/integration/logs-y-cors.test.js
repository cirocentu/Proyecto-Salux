const test = require('node:test');
const assert = require('node:assert/strict');
const { Prisma } = require('@prisma/client');
const { app, prisma, request, limpiarBase, crearUsuario } = require('../helpers');

test.before(limpiarBase);
test.after(() => prisma.$disconnect());

function nuevaInstancia() {
  const ruta = require.resolve('../../src/app');
  delete require.cache[ruta];
  return require('../../src/app');
}

test.describe('logs sin datos personales', () => {
  test('un error real de Prisma no deja emails ni nombres en el log', async () => {
    const { registrarError } = require('../../src/utils/registrarError');
    const email = 'persona.privada@correo.test';
    const nombre = 'María Pérez Gómez';

    // Un dato mal tipado (dni numérico) hace que Prisma rechace la consulta e imprima, en
    // su mensaje, los valores reales de la consulta: acá, el email y el nombre.
    let error;
    try {
      await prisma.usuario.create({ data: { email, dni: 30123456, nomYape: nombre, contrasena: 'x' } });
    } catch (e) {
      error = e;
    }
    assert.ok(error, 'Prisma tenía que rechazar la consulta');
    assert.ok(error.message.includes(email) && error.message.includes(nombre), 'el mensaje original SÍ trae los datos');

    const original = console.error;
    const salida = [];
    console.error = (...a) => salida.push(a.join(' '));
    try {
      registrarError(error, 'prueba');
    } finally {
      console.error = original;
    }
    const texto = salida.join('\n');
    assert.ok(!texto.includes('persona.privada'));
    assert.ok(!texto.includes('María'));
    assert.match(texto, /PrismaClientValidationError/);
  });

  test('un fallo interno de un endpoint responde 500 genérico y no registra los datos de la petición', async () => {
    const original = console.error;
    const originalFind = prisma.usuario.findUnique;
    const salida = [];
    console.error = (...a) => salida.push(a.join(' '));
    prisma.usuario.findUnique = async () => {
      throw new Prisma.PrismaClientKnownRequestError(
        '\nInvalid `prisma.usuario.findUnique()` invocation:\n\n{\n  where: { email: "victima.del.log@correo.test" }\n}\n\nConnection pool timeout',
        { code: 'P2024', clientVersion: 'test' }
      );
    };
    try {
      const res = await request(app).post('/api/auth/olvide-contrasena').send({ email: 'victima.del.log@correo.test' });
      assert.equal(res.status, 500);
      assert.deepEqual(res.body, { ok: false, error: 'Error interno del servidor' });
    } finally {
      console.error = original;
      prisma.usuario.findUnique = originalFind;
    }
    const texto = salida.join('\n');
    assert.ok(!texto.includes('victima.del.log'));
    assert.match(texto, /P2024: Connection pool timeout/);
  });
});

test.describe('CORS', () => {
  const origen = (instancia, valor) => request(instancia).get('/api/config').set('Origin', valor);

  test.afterEach(() => { process.env.CORS_ORIGIN = 'http://localhost:5173'; });

  test('una lista con espacios después de la coma admite todos sus orígenes', async () => {
    process.env.CORS_ORIGIN = 'https://a.salux.test,  https://b.salux.test ,https://c.salux.test';
    const instancia = nuevaInstancia();
    for (const o of ['https://a.salux.test', 'https://b.salux.test', 'https://c.salux.test']) {
      const res = await origen(instancia, o);
      assert.equal(res.headers['access-control-allow-origin'], o, o);
      assert.equal(res.headers['access-control-allow-credentials'], 'true');
    }
  });

  test('un origen que no está en la lista no recibe permiso', async () => {
    process.env.CORS_ORIGIN = 'https://a.salux.test, https://b.salux.test';
    const instancia = nuevaInstancia();
    const res = await origen(instancia, 'https://atacante.test');
    assert.equal(res.headers['access-control-allow-origin'], undefined);
  });

  test('un origen que solo se parece (subdominio o prefijo) tampoco', async () => {
    process.env.CORS_ORIGIN = 'https://salux.test';
    const instancia = nuevaInstancia();
    for (const o of ['https://salux.test.atacante.test', 'https://evil-salux.test', 'http://salux.test', 'null']) {
      assert.equal((await origen(instancia, o)).headers['access-control-allow-origin'], undefined, o);
    }
  });

  test('entradas vacías en la lista no abren nada', async () => {
    process.env.CORS_ORIGIN = 'https://a.salux.test, ,';
    const instancia = nuevaInstancia();
    assert.equal((await origen(instancia, 'https://a.salux.test')).headers['access-control-allow-origin'], 'https://a.salux.test');
    assert.equal((await origen(instancia, '')).headers['access-control-allow-origin'], undefined);
  });
});
