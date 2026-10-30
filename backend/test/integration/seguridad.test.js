const test = require('node:test');
const assert = require('node:assert/strict');
const { app, prisma, request, CLAVE, limpiarBase, crearUsuario, iniciarSesion, conToken, crearEspecialidad } = require('../helpers');

test.before(limpiarBase);
test.after(() => prisma.$disconnect());

test.describe('control de acceso por rol', () => {
  test('sin token, las rutas protegidas dan 401', async () => {
    for (const [metodo, ruta] of [
      ['get', '/api/especialidades'], ['get', '/api/medicos'], ['get', '/api/medicos/todos'],
      ['get', '/api/turnos'], ['get', '/api/turnos/mis-turnos'], ['post', '/api/turnos'],
    ]) {
      const res = await request(app)[metodo](ruta);
      assert.equal(res.status, 401, `${metodo.toUpperCase()} ${ruta}`);
    }
  });

  test('un paciente no puede usar las rutas de administración', async () => {
    const p = await crearUsuario({ rol: 'paciente' });
    const { token } = await iniciarSesion(p.email);
    const e = await crearEspecialidad('Cardiología');

    const intentos = [
      request(app).post('/api/especialidades').set(conToken(token)).send({ nombre: 'Pirata' }),
      request(app).delete(`/api/especialidades/${e.idEspecialidad}`).set(conToken(token)),
      request(app).get('/api/medicos/todos').set(conToken(token)),
      request(app).get('/api/turnos').set(conToken(token)),
      request(app).patch('/api/medicos/1/estado').set(conToken(token)).send({ activo: false }),
      request(app).post('/api/medicos').set(conToken(token)).send({}),
    ];
    for (const res of await Promise.all(intentos)) assert.equal(res.status, 403);
    assert.equal((await prisma.especialidad.findUnique({ where: { idEspecialidad: e.idEspecialidad } })).activo, true);
  });

  test('un médico tampoco es administrador', async () => {
    const m = await crearUsuario({ rol: 'medico' });
    const { token } = await iniciarSesion(m.email);
    assert.equal((await request(app).get('/api/medicos/todos').set(conToken(token))).status, 403);
    assert.equal((await request(app).post('/api/especialidades').set(conToken(token)).send({ nombre: 'X' })).status, 403);
  });

  test('un paciente no tiene agenda de médico', async () => {
    const p = await crearUsuario({ rol: 'paciente' });
    const { token } = await iniciarSesion(p.email);
    assert.equal((await request(app).get('/api/turnos/agenda-medico').set(conToken(token))).status, 403);
  });

  test('el listado público de médicos no expone email, DNI ni matrícula', async () => {
    const m = await crearUsuario({ rol: 'medico' });
    const p = await crearUsuario({ rol: 'paciente' });
    const { token } = await iniciarSesion(p.email);
    const res = await request(app).get('/api/medicos').set(conToken(token));
    const texto = JSON.stringify(res.body);
    assert.equal(res.status, 200);
    assert.ok(!texto.includes(m.email));
    assert.ok(!texto.includes(m.dni));
    assert.ok(!texto.includes(m.medico.matricula));
  });
});

test.describe('mantenimiento programado (/api/cron)', () => {
  test.afterEach(() => { process.env.CRON_SECRET = ''; });

  test('sin CRON_SECRET configurado la ruta no existe', async () => {
    process.env.CRON_SECRET = '';
    assert.equal((await request(app).get('/api/cron/mantenimiento')).status, 404);
  });

  test('con secreto, rechaza a quien no lo manda o manda otro', async () => {
    process.env.CRON_SECRET = 'secreto-de-cron-de-prueba';
    assert.equal((await request(app).get('/api/cron/mantenimiento')).status, 401);
    assert.equal((await request(app).get('/api/cron/mantenimiento').set('Authorization', 'Bearer otro-secreto')).status, 401);
  });

  test('con el secreto correcto corre el mantenimiento', async () => {
    process.env.CRON_SECRET = 'secreto-de-cron-de-prueba';
    const res = await request(app).get('/api/cron/mantenimiento').set('Authorization', 'Bearer secreto-de-cron-de-prueba');
    assert.equal(res.status, 200);
    assert.equal(res.body.ok, true);
  });

  test('da de baja los turnos pendientes vencidos y purga sesiones vencidas', async () => {
    process.env.CRON_SECRET = 'secreto-de-cron-de-prueba';
    const p = await crearUsuario({ rol: 'paciente' });
    const m = await crearUsuario({ rol: 'medico' });
    const vencido = await prisma.turno.create({
      data: { fechaYhora: new Date(Date.now() - 3600 * 1000), pacienteId: p.paciente.idPaciente, medicoId: m.medico.idMedico },
    });
    const confirmadoViejo = await prisma.turno.create({
      data: { fechaYhora: new Date(Date.now() - 7200 * 1000), estado: 'CONFIRMADO', pacienteId: p.paciente.idPaciente, medicoId: m.medico.idMedico },
    });
    const futuro = await prisma.turno.create({
      data: { fechaYhora: new Date(Date.now() + 86400 * 1000), pacienteId: p.paciente.idPaciente, medicoId: m.medico.idMedico },
    });
    await prisma.sesion.create({ data: { usuarioId: p.idUsuario, expiraEn: new Date(Date.now() - 1000) } });

    await request(app).get('/api/cron/mantenimiento').set('Authorization', 'Bearer secreto-de-cron-de-prueba');

    const estado = async (t) => (await prisma.turno.findUnique({ where: { idTurno: t.idTurno } })).estado;
    assert.equal(await estado(vencido), 'CANCELADO');
    assert.equal(await estado(confirmadoViejo), 'CONFIRMADO', 'los confirmados los cierra el médico');
    assert.equal(await estado(futuro), 'PENDIENTE');
    assert.equal(await prisma.sesion.count({ where: { usuarioId: p.idUsuario } }), 0);
  });
});

test.describe('estado del servicio', () => {
  test('/api/health responde con la base conectada', async () => {
    const res = await request(app).get('/api/health');
    assert.equal(res.status, 200);
    assert.equal(res.body.ok, true);
  });

  test('una ruta inexistente da 404 en JSON', async () => {
    const res = await request(app).get('/api/no-existe');
    assert.equal(res.status, 404);
    assert.equal(res.body.ok, false);
  });

  test('responde con las cabeceras de seguridad de helmet', async () => {
    const res = await request(app).get('/api/health');
    assert.ok(res.headers['x-content-type-options']);
    assert.equal(res.headers['x-powered-by'], undefined);
  });

  test('un cuerpo JSON demasiado grande se rechaza', async () => {
    const res = await request(app).post('/api/auth/login').send({ identificador: 'a@b.com', contrasena: 'x'.repeat(20000) });
    assert.equal(res.status, 413);
  });
});

// Este bloque va AL FINAL: gasta el cupo de intentos fallidos de login.
test.describe('límite de intentos de login', () => {
  test('después de 10 fallos sobre la misma cuenta responde 429, incluso con la clave correcta', async () => {
    const u = await crearUsuario();
    for (let i = 0; i < 10; i += 1) {
      const res = await request(app).post('/api/auth/login').send({ identificador: u.email, contrasena: 'Equivocada123' });
      assert.equal(res.status, 401, `intento ${i + 1}`);
    }
    const bloqueado = await request(app).post('/api/auth/login').send({ identificador: u.email, contrasena: CLAVE });
    assert.equal(bloqueado.status, 429);
  });

  test('el bloqueo de una cuenta no afecta a otra', async () => {
    const otra = await crearUsuario();
    const res = await request(app).post('/api/auth/login').send({ identificador: otra.email, contrasena: CLAVE });
    assert.equal(res.status, 200);
  });
});
