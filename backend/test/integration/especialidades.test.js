const test = require('node:test');
const assert = require('node:assert/strict');
const { app, prisma, request, CLAVE, limpiarBase, crearUsuario, iniciarSesion, conToken, crearEspecialidad } = require('../helpers');

let tokenAdmin;

test.before(async () => {
  await limpiarBase();
  const a = await crearUsuario({ rol: 'admin' });
  tokenAdmin = (await iniciarSesion(a.email)).token;
});
test.after(() => prisma.$disconnect());

const crear = (nombre) => request(app).post('/api/especialidades').set(conToken(tokenAdmin)).send({ nombre });
const listar = (token = tokenAdmin) => request(app).get('/api/especialidades').set(conToken(token));

test.describe('especialidades', () => {
  test('el admin crea una especialidad', async () => {
    const res = await crear('Cardiología');
    assert.equal(res.status, 201);
    assert.equal(res.body.data.nombre, 'Cardiología');
    assert.equal(res.body.data.activo, true);
  });

  test('no permite duplicados, sin importar mayúsculas', async () => {
    await crear('Pediatría');
    assert.equal((await crear('Pediatría')).status, 409);
    assert.equal((await crear('pediatría')).status, 409);
    assert.equal((await crear('PEDIATRÍA')).status, 409);
  });

  test('rechaza un nombre vacío', async () => {
    assert.equal((await crear('')).status, 400);
    assert.equal((await crear('   ')).status, 400);
  });

  test('eliminar es un borrado lógico: deja de listarse pero la fila sigue', async () => {
    const e = (await crear('Dermatología')).body.data;
    const del = await request(app).delete(`/api/especialidades/${e.idEspecialidad}`).set(conToken(tokenAdmin));
    assert.equal(del.status, 200);

    const nombres = (await listar()).body.data.map((x) => x.nombre);
    assert.ok(!nombres.includes('Dermatología'));
    const fila = await prisma.especialidad.findUnique({ where: { idEspecialidad: e.idEspecialidad } });
    assert.equal(fila.activo, false);
  });

  test('eliminar dos veces o una que no existe da 404; un id inválido da 400', async () => {
    const e = (await crear('Oftalmología')).body.data;
    await request(app).delete(`/api/especialidades/${e.idEspecialidad}`).set(conToken(tokenAdmin));
    assert.equal((await request(app).delete(`/api/especialidades/${e.idEspecialidad}`).set(conToken(tokenAdmin))).status, 404);
    assert.equal((await request(app).delete('/api/especialidades/999999').set(conToken(tokenAdmin))).status, 404);
    assert.equal((await request(app).delete('/api/especialidades/abc').set(conToken(tokenAdmin))).status, 400);
  });

  test('se puede eliminar aunque tenga médicos asignados, y ellos conservan la relación', async () => {
    const e = await crearEspecialidad('Neurología');
    const m = await crearUsuario({ rol: 'medico' });
    await prisma.medico.update({ where: { idMedico: m.medico.idMedico }, data: { especialidades: { connect: { idEspecialidad: e.idEspecialidad } } } });

    const del = await request(app).delete(`/api/especialidades/${e.idEspecialidad}`).set(conToken(tokenAdmin));
    assert.equal(del.status, 200);

    const medico = await prisma.medico.findUnique({ where: { idMedico: m.medico.idMedico }, include: { especialidades: true } });
    assert.equal(medico.especialidades.length, 1, 'la relación no se pierde');
  });

  test('volver a crear una eliminada la reactiva (conserva a sus médicos)', async () => {
    const e = await crearEspecialidad('Traumatología');
    const m = await crearUsuario({ rol: 'medico' });
    await prisma.medico.update({ where: { idMedico: m.medico.idMedico }, data: { especialidades: { connect: { idEspecialidad: e.idEspecialidad } } } });
    await request(app).delete(`/api/especialidades/${e.idEspecialidad}`).set(conToken(tokenAdmin));

    const res = await crear('traumatología');
    assert.equal(res.status, 201);
    assert.equal(res.body.data.idEspecialidad, e.idEspecialidad, 'misma fila, no una nueva');
    assert.equal(res.body.data.activo, true);

    const visible = (await listar()).body.data.find((x) => x.idEspecialidad === e.idEspecialidad);
    assert.equal(visible.medicos.length, 1);
  });

  test('el admin ve qué médicos tiene cada especialidad; el paciente no', async () => {
    const e = await crearEspecialidad('Urología');
    const m = await crearUsuario({ rol: 'medico', nomYape: 'Dra. Visible' });
    await prisma.medico.update({ where: { idMedico: m.medico.idMedico }, data: { especialidades: { connect: { idEspecialidad: e.idEspecialidad } } } });
    const p = await crearUsuario({ rol: 'paciente' });
    const { token: tokenPaciente } = await iniciarSesion(p.email);

    const paraAdmin = (await listar()).body.data.find((x) => x.idEspecialidad === e.idEspecialidad);
    assert.equal(paraAdmin.medicos[0].usuario.nomYape, 'Dra. Visible');

    const paraPaciente = (await listar(tokenPaciente)).body.data.find((x) => x.idEspecialidad === e.idEspecialidad);
    assert.equal(paraPaciente.medicos, undefined);
  });

  test('a nivel base de datos el nombre es único sin importar mayúsculas', async () => {
    await crearEspecialidad('Neumonología');
    await assert.rejects(() => prisma.especialidad.create({ data: { nombre: 'NEUMONOLOGÍA' } }));
  });
});

test.describe('médicos (alta y edición por el admin)', () => {
  const nuevoMedico = (extra = {}) => ({
    email: 'dr.nuevo@prueba.test', dni: '27111222', contrasena: 'Inicial-Verde-4482', nomYape: 'Dr. Nuevo',
    matricula: 'MP-9001', consultorio: 'B', especialidadesIds: [], ...extra,
  });

  test('crea un médico con contraseña inicial que debe cambiar y sin devolver el hash', async () => {
    const e = await crearEspecialidad('Gastroenterología');
    const res = await request(app).post('/api/medicos').set(conToken(tokenAdmin)).send(nuevoMedico({ especialidadesIds: [e.idEspecialidad] }));
    assert.equal(res.status, 201);
    assert.ok(!JSON.stringify(res.body).includes('contrasena'));
    const u = await prisma.usuario.findUnique({ where: { email: 'dr.nuevo@prueba.test' } });
    assert.equal(u.debeCambiarContrasena, true);

    const login = await request(app).post('/api/auth/login').send({ identificador: 'dr.nuevo@prueba.test', contrasena: 'Inicial-Verde-4482' });
    assert.equal(login.status, 200);
    assert.equal(login.body.usuario.rol, 'medico');
    assert.equal(login.body.usuario.debeCambiarContrasena, true);
  });

  test('rechaza email/DNI o matrícula repetidos', async () => {
    const e = await crearEspecialidad('Endocrinología');
    const base = nuevoMedico({ email: 'dr.dos@prueba.test', dni: '27333444', matricula: 'MP-9002', especialidadesIds: [e.idEspecialidad] });
    assert.equal((await request(app).post('/api/medicos').set(conToken(tokenAdmin)).send(base)).status, 201);
    const mismoMail = await request(app).post('/api/medicos').set(conToken(tokenAdmin)).send({ ...base, dni: '27999000', matricula: 'MP-9100' });
    const mismaMatricula = await request(app).post('/api/medicos').set(conToken(tokenAdmin)).send({ ...base, email: 'otro@prueba.test', dni: '27999111' });
    assert.equal(mismoMail.status, 409);
    assert.equal(mismaMatricula.status, 409);
  });

  test('exige al menos una especialidad', async () => {
    const res = await request(app).post('/api/medicos').set(conToken(tokenAdmin)).send(nuevoMedico({ email: 'sin@prueba.test', dni: '27555666', matricula: 'MP-9003' }));
    assert.equal(res.status, 400);
  });

  test('una especialidad inexistente da 400 y no deja un usuario a medias', async () => {
    const res = await request(app).post('/api/medicos').set(conToken(tokenAdmin))
      .send(nuevoMedico({ email: 'fantasma@prueba.test', dni: '27777888', matricula: 'MP-9004', especialidadesIds: [987654] }));
    assert.equal(res.status, 400);
    assert.equal(await prisma.usuario.count({ where: { email: 'fantasma@prueba.test' } }), 0);
  });

  test('editar: reemplaza el set de especialidades y cambia consultorio y duración', async () => {
    const [a, b] = [await crearEspecialidad('Reumatología'), await crearEspecialidad('Hematología')];
    const m = await crearUsuario({ rol: 'medico' });
    await prisma.medico.update({ where: { idMedico: m.medico.idMedico }, data: { especialidades: { connect: { idEspecialidad: a.idEspecialidad } } } });

    const res = await request(app).patch(`/api/medicos/${m.medico.idMedico}`).set(conToken(tokenAdmin))
      .send({ especialidadesIds: [b.idEspecialidad], consultorio: '204', duracionTurnoMinutos: 45 });
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.data.especialidades.map((e) => e.nombre), ['Hematología']);
    assert.equal(res.body.data.consultorio, '204');
    assert.equal(res.body.data.duracionTurnoMinutos, 45);
  });

  test('editar sin ningún campo da 400; un médico inexistente da 404', async () => {
    const m = await crearUsuario({ rol: 'medico' });
    assert.equal((await request(app).patch(`/api/medicos/${m.medico.idMedico}`).set(conToken(tokenAdmin)).send({})).status, 400);
    assert.equal((await request(app).patch('/api/medicos/999999').set(conToken(tokenAdmin)).send({ consultorio: 'A' })).status, 404);
  });

  test('desactivar a un médico lo saca del listado público y le corta el acceso', async () => {
    const m = await crearUsuario({ rol: 'medico' });
    const { token } = await iniciarSesion(m.email);
    const res = await request(app).patch(`/api/medicos/${m.medico.idMedico}/estado`).set(conToken(tokenAdmin)).send({ activo: false });
    assert.equal(res.status, 200);

    const publico = await request(app).get('/api/medicos').set(conToken(tokenAdmin));
    assert.ok(!publico.body.data.some((x) => x.idMedico === m.medico.idMedico));
    const todos = await request(app).get('/api/medicos/todos').set(conToken(tokenAdmin));
    assert.ok(todos.body.data.some((x) => x.idMedico === m.medico.idMedico), 'el admin sigue viéndolo');

    assert.equal((await request(app).get('/api/auth/perfil').set(conToken(token))).status, 403);
    assert.equal((await request(app).post('/api/auth/login').send({ identificador: m.email, contrasena: CLAVE })).status, 403);
  });
});
