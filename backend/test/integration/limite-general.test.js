const test = require('node:test');
const assert = require('node:assert/strict');
const { prisma, request, limpiarBase } = require('../helpers');

// Vercel ejecuta la API en varias instancias independientes (cada una con su memoria).
// Acá se simulan dos: dos apps de Express distintas dentro del mismo proceso, que
// comparten únicamente la base de datos.
function nuevaInstancia() {
  const ruta = require.resolve('../../src/app');
  delete require.cache[ruta];
  const app = require('../../src/app');
  app.set('trust proxy', 1);
  return app;
}

const desde = (app, ip, ruta = '/api/config') => request(app).get(ruta).set('X-Forwarded-For', ip);

test.beforeEach(limpiarBase);
test.after(() => prisma.$disconnect());

test.describe('con los contadores en la base (RATE_LIMIT_STORE=db)', () => {
  test.beforeEach(() => {
    process.env.RATE_LIMIT_STORE = 'db';
    process.env.API_LIMITE_PETICIONES = '5';
    delete process.env.API_RATE_LIMIT_MEMORIA;
  });
  test.afterEach(() => {
    process.env.RATE_LIMIT_STORE = '';
    delete process.env.API_LIMITE_PETICIONES;
  });

  test('el límite vale para todas las instancias, no por instancia', async () => {
    const a = nuevaInstancia();
    const b = nuevaInstancia();

    for (let i = 0; i < 3; i += 1) assert.equal((await desde(a, '203.0.113.7')).status, 200);
    for (let i = 0; i < 2; i += 1) assert.equal((await desde(b, '203.0.113.7')).status, 200);

    // Van 5 entre las dos: la 6.ª se rechaza en CUALQUIERA de las dos instancias.
    assert.equal((await desde(a, '203.0.113.7')).status, 429);
    assert.equal((await desde(b, '203.0.113.7')).status, 429);
  });

  test('cada IP tiene su propio cupo', async () => {
    const app = nuevaInstancia();
    for (let i = 0; i < 6; i += 1) await desde(app, '203.0.113.8');
    assert.equal((await desde(app, '203.0.113.8')).status, 429);
    assert.equal((await desde(app, '203.0.113.9')).status, 200);
  });

  test('el health check no cuenta ni se bloquea', async () => {
    const app = nuevaInstancia();
    for (let i = 0; i < 12; i += 1) assert.equal((await desde(app, '203.0.113.10', '/api/health')).status, 200);
    assert.equal((await desde(app, '203.0.113.10')).status, 200, 'el cupo de la IP sigue intacto');
  });

  test('si la base falla, el límite deja pasar en vez de tirar la API abajo', async () => {
    const app = nuevaInstancia();
    const original = prisma.$queryRaw;
    prisma.$queryRaw = async () => { throw new Error('base caída'); };
    try {
      for (let i = 0; i < 8; i += 1) assert.equal((await desde(app, '203.0.113.11')).status, 200);
    } finally {
      prisma.$queryRaw = original;
    }
  });

  test('API_RATE_LIMIT_MEMORIA=true lo deja en memoria de cada instancia (vía de escape)', async () => {
    process.env.API_RATE_LIMIT_MEMORIA = 'true';
    const a = nuevaInstancia();
    const b = nuevaInstancia();
    for (let i = 0; i < 5; i += 1) await desde(a, '203.0.113.12');
    assert.equal((await desde(a, '203.0.113.12')).status, 429);
    assert.equal((await desde(b, '203.0.113.12')).status, 200, 'la otra instancia no se entera');
  });
});

test('sin RATE_LIMIT_STORE=db (desarrollo) el límite sigue en memoria', async () => {
  process.env.RATE_LIMIT_STORE = '';
  process.env.API_LIMITE_PETICIONES = '3';
  const app = nuevaInstancia();
  delete process.env.API_LIMITE_PETICIONES;
  for (let i = 0; i < 3; i += 1) assert.equal((await desde(app, '203.0.113.13')).status, 200);
  assert.equal((await desde(app, '203.0.113.13')).status, 429);
  assert.equal(await prisma.rateLimitContador.count({ where: { clave: { startsWith: 'api:' } } }), 0, 'no escribió en la base');
});
