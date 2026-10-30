const test = require('node:test');
const assert = require('node:assert/strict');
const {
  app, prisma, request, limpiarBase, crearUsuario, iniciarSesion, conToken, crearEspecialidad, proximaFecha,
} = require('../helpers');

test.before(limpiarBase);
test.after(() => prisma.$disconnect());

const MINUTO = 60 * 1000;

// Cada prueba arma su propio escenario: médico con una especialidad y dos pacientes con sesión.
async function escenario(opcionesMedico = {}) {
  const especialidad = await crearEspecialidad(`Esp-${Math.random().toString(36).slice(2, 8)}`);
  const medico = await crearUsuario({ rol: 'medico', medico: opcionesMedico });
  await prisma.medico.update({
    where: { idMedico: medico.medico.idMedico },
    data: { especialidades: { connect: { idEspecialidad: especialidad.idEspecialidad } } },
  });
  const ana = await crearUsuario({ rol: 'paciente' });
  const beto = await crearUsuario({ rol: 'paciente' });
  return {
    especialidad, medico,
    idMedico: medico.medico.idMedico,
    ana, beto,
    tokenAna: (await iniciarSesion(ana.email)).token,
    tokenBeto: (await iniciarSesion(beto.email)).token,
    tokenMedico: (await iniciarSesion(medico.email)).token,
  };
}

const reservar = (token, medicoId, fecha, especialidadId) =>
  request(app).post('/api/turnos').set(conToken(token))
    .send({ medicoId, fechaYhora: fecha.toISOString(), ...(especialidadId ? { especialidadId } : {}) });

test.describe('reservar un turno', () => {
  test('crea el turno PENDIENTE y le asigna la única especialidad del médico', async () => {
    const e = await escenario();
    const res = await reservar(e.tokenAna, e.idMedico, proximaFecha(2, 10));
    assert.equal(res.status, 201);
    assert.equal(res.body.data.estado, 'PENDIENTE');
    assert.equal(res.body.data.especialidadId, e.especialidad.idEspecialidad);
    assert.equal(res.body.data.confirmadoPorPaciente, false);
  });

  test('sin sesión da 401; un médico no tiene perfil de paciente (404)', async () => {
    const e = await escenario();
    const sin = await request(app).post('/api/turnos').send({ medicoId: e.idMedico, fechaYhora: proximaFecha(2, 10).toISOString() });
    assert.equal(sin.status, 401);
    assert.equal((await reservar(e.tokenMedico, e.idMedico, proximaFecha(2, 10))).status, 404);
  });

  test('una fecha pasada o con formato inválido da 400', async () => {
    const e = await escenario();
    const pasado = await request(app).post('/api/turnos').set(conToken(e.tokenAna))
      .send({ medicoId: e.idMedico, fechaYhora: new Date(Date.now() - 3600000).toISOString() });
    const raro = await request(app).post('/api/turnos').set(conToken(e.tokenAna)).send({ medicoId: e.idMedico, fechaYhora: 'mañana a la tarde' });
    assert.equal(pasado.status, 400);
    assert.equal(raro.status, 400);
  });

  test('un médico inexistente da 404', async () => {
    const e = await escenario();
    assert.equal((await reservar(e.tokenAna, 999999, proximaFecha(2, 10))).status, 404);
  });

  test('la especialidad tiene que ser una que el médico atiende y esté activa', async () => {
    const e = await escenario();
    const otra = await crearEspecialidad(`Ajena-${Date.now()}`);
    assert.equal((await reservar(e.tokenAna, e.idMedico, proximaFecha(2, 10), otra.idEspecialidad)).status, 400);

    await prisma.especialidad.update({ where: { idEspecialidad: e.especialidad.idEspecialidad }, data: { activo: false } });
    assert.equal((await reservar(e.tokenAna, e.idMedico, proximaFecha(2, 11), e.especialidad.idEspecialidad)).status, 400);
  });

  test('un médico desactivado no recibe turnos (422)', async () => {
    const e = await escenario();
    await prisma.usuario.update({ where: { idUsuario: e.medico.idUsuario }, data: { activo: false } });
    assert.equal((await reservar(e.tokenAna, e.idMedico, proximaFecha(2, 10))).status, 422);
  });
});

test.describe('choques de horario', () => {
  test('dos pacientes no pueden tener el mismo horario con el mismo médico (409)', async () => {
    const e = await escenario();
    const fecha = proximaFecha(3, 10);
    assert.equal((await reservar(e.tokenAna, e.idMedico, fecha)).status, 201);
    assert.equal((await reservar(e.tokenBeto, e.idMedico, fecha)).status, 409);
  });

  test('un turno dentro de la duración de otro choca; justo al terminar, no', async () => {
    const e = await escenario({ duracionTurnoMinutos: 30 });
    const base = proximaFecha(3, 10);
    assert.equal((await reservar(e.tokenAna, e.idMedico, base)).status, 201);
    assert.equal((await reservar(e.tokenBeto, e.idMedico, new Date(base.getTime() + 10 * MINUTO))).status, 409, '+10 min');
    assert.equal((await reservar(e.tokenBeto, e.idMedico, new Date(base.getTime() - 10 * MINUTO))).status, 409, '-10 min');
    assert.equal((await reservar(e.tokenBeto, e.idMedico, new Date(base.getTime() + 30 * MINUTO))).status, 201, '+30 min justo');
  });

  test('la duración del turno es la de cada médico', async () => {
    const e = await escenario({ duracionTurnoMinutos: 60 });
    const base = proximaFecha(3, 10);
    assert.equal((await reservar(e.tokenAna, e.idMedico, base)).status, 201);
    assert.equal((await reservar(e.tokenBeto, e.idMedico, new Date(base.getTime() + 45 * MINUTO))).status, 409);
    assert.equal((await reservar(e.tokenBeto, e.idMedico, new Date(base.getTime() + 60 * MINUTO))).status, 201);
  });

  test('un paciente no puede tener dos turnos a la misma hora, ni con médicos distintos (409)', async () => {
    const e1 = await escenario();
    const e2 = await escenario();
    const fecha = proximaFecha(4, 10);
    assert.equal((await reservar(e1.tokenAna, e1.idMedico, fecha)).status, 201);
    const otraConMismoPaciente = await request(app).post('/api/turnos').set(conToken(e1.tokenAna))
      .send({ medicoId: e2.idMedico, fechaYhora: fecha.toISOString() });
    assert.equal(otraConMismoPaciente.status, 409);
  });

  test('cancelar un turno libera el horario para otro paciente', async () => {
    const e = await escenario();
    const fecha = proximaFecha(5, 10);
    const turno = (await reservar(e.tokenAna, e.idMedico, fecha)).body.data;
    assert.equal((await reservar(e.tokenBeto, e.idMedico, fecha)).status, 409);

    const cancel = await request(app).patch(`/api/turnos/${turno.idTurno}`).set(conToken(e.tokenAna)).send({ estado: 'CANCELADO' });
    assert.equal(cancel.status, 200);
    assert.equal((await reservar(e.tokenBeto, e.idMedico, fecha)).status, 201);
  });

  test('la base impide dos turnos activos en el mismo instante, pero permite uno cancelado y uno nuevo', async () => {
    const e = await escenario();
    const fechaYhora = proximaFecha(6, 10);
    const datos = (pacienteId, estado) => ({ data: { fechaYhora, medicoId: e.idMedico, pacienteId, estado } });

    await prisma.turno.create(datos(e.ana.paciente.idPaciente, 'CANCELADO'));
    await prisma.turno.create(datos(e.beto.paciente.idPaciente, 'PENDIENTE'));
    await assert.rejects(() => prisma.turno.create(datos(e.ana.paciente.idPaciente, 'CONFIRMADO')), (err) => err.code === 'P2002');
  });
});

test.describe('disponibilidad semanal y ausencias (hora Argentina)', () => {
  // Lunes de 08:00 a 12:00 hora Argentina
  async function medicoConFranja() {
    const e = await escenario();
    await prisma.disponibilidad.create({ data: { medicoId: e.idMedico, diaSemana: 1, horaInicioMinutos: 8 * 60, horaFinMinutos: 12 * 60 } });
    return e;
  }

  test('acepta un horario dentro de la franja (09:00 Argentina = 12:00 UTC)', async () => {
    const e = await medicoConFranja();
    const fecha = proximaFecha(1, 9);
    assert.equal(fecha.getUTCHours(), 12, 'el helper arma la hora en UTC-3');
    assert.equal((await reservar(e.tokenAna, e.idMedico, fecha)).status, 201);
  });

  test('rechaza un horario fuera de la franja, otro día, o que no entra completo', async () => {
    const e = await medicoConFranja();
    assert.equal((await reservar(e.tokenAna, e.idMedico, proximaFecha(1, 13))).status, 422, 'después del cierre');
    assert.equal((await reservar(e.tokenAna, e.idMedico, proximaFecha(1, 7))).status, 422, 'antes de abrir');
    assert.equal((await reservar(e.tokenAna, e.idMedico, proximaFecha(2, 9))).status, 422, 'martes');
    assert.equal((await reservar(e.tokenAna, e.idMedico, proximaFecha(1, 11, 45))).status, 422, 'termina 12:15');
    assert.equal((await reservar(e.tokenAna, e.idMedico, proximaFecha(1, 11, 30))).status, 201, 'termina justo 12:00');
  });

  test('una ausencia bloquea ese día y no los vecinos', async () => {
    const e = await medicoConFranja();
    const lunes = proximaFecha(1, 9);
    const dia = new Date(Date.UTC(lunes.getUTCFullYear(), lunes.getUTCMonth(), lunes.getUTCDate()));
    await prisma.ausenciaMedico.create({ data: { medicoId: e.idMedico, fechaInicio: dia, fechaFin: dia, motivo: 'Vacaciones' } });

    const res = await reservar(e.tokenAna, e.idMedico, lunes);
    assert.equal(res.status, 422);
    assert.match(res.body.message, /ausencia/i);
    assert.equal((await reservar(e.tokenAna, e.idMedico, proximaFecha(1, 9, 0, 2))).status, 201, 'el lunes siguiente sí');
  });

  test('un médico sin franjas cargadas no tiene restricción de horario', async () => {
    const e = await escenario();
    assert.equal((await reservar(e.tokenAna, e.idMedico, proximaFecha(0, 3))).status, 201);
  });

  test('el listado de médicos calcula la próxima disponibilidad dentro de la franja', async () => {
    const e = await medicoConFranja();
    const res = await request(app).get('/api/medicos').set(conToken(e.tokenAna));
    const m = res.body.data.find((x) => x.idMedico === e.idMedico);
    assert.ok(m.proximaDisponibilidad, 'debería haber un horario libre');
    const prox = new Date(m.proximaDisponibilidad);
    assert.ok(prox.getTime() > Date.now());
    const hora = (prox.getUTCHours() - 3 + 24) % 24;
    assert.ok(hora >= 8 && hora < 12, `hora Argentina ${hora} dentro de 8-12`);
    assert.equal((await reservar(e.tokenAna, e.idMedico, prox)).status, 201, 'lo que promete el listado, el alta lo acepta');
  });
});

test.describe('estados y permisos sobre un turno', () => {
  const cambiar = (token, id, estado) => request(app).patch(`/api/turnos/${id}`).set(conToken(token)).send({ estado });

  test('el médico dueño confirma; el paciente solo puede cancelar', async () => {
    const e = await escenario();
    const t = (await reservar(e.tokenAna, e.idMedico, proximaFecha(2, 10))).body.data;
    assert.equal((await cambiar(e.tokenAna, t.idTurno, 'CONFIRMADO')).status, 403);
    const ok = await cambiar(e.tokenMedico, t.idTurno, 'CONFIRMADO');
    assert.equal(ok.status, 200);
    assert.equal(ok.body.data.estado, 'CONFIRMADO');
  });

  test('quien no participa del turno recibe 403', async () => {
    const e = await escenario();
    const t = (await reservar(e.tokenAna, e.idMedico, proximaFecha(2, 10))).body.data;
    assert.equal((await cambiar(e.tokenBeto, t.idTurno, 'CANCELADO')).status, 403);
    const otroMedico = await crearUsuario({ rol: 'medico' });
    const { token } = await iniciarSesion(otroMedico.email);
    assert.equal((await cambiar(token, t.idTurno, 'CONFIRMADO')).status, 403);
  });

  test('un administrador puede cambiar cualquier turno', async () => {
    const e = await escenario();
    const t = (await reservar(e.tokenAna, e.idMedico, proximaFecha(2, 10))).body.data;
    const admin = await crearUsuario({ rol: 'admin' });
    const { token } = await iniciarSesion(admin.email);
    assert.equal((await cambiar(token, t.idTurno, 'CONFIRMADO')).status, 200);
  });

  test('los estados finales no admiten más cambios (422)', async () => {
    const e = await escenario();
    const t = (await reservar(e.tokenAna, e.idMedico, proximaFecha(2, 10))).body.data;
    await cambiar(e.tokenAna, t.idTurno, 'CANCELADO');
    assert.equal((await cambiar(e.tokenMedico, t.idTurno, 'CONFIRMADO')).status, 422);
  });

  test('no se puede repetir el mismo estado, ni finalizar algo que no ocurrió, ni confirmar algo pasado', async () => {
    const e = await escenario();
    const t = (await reservar(e.tokenAna, e.idMedico, proximaFecha(2, 10))).body.data;
    assert.equal((await cambiar(e.tokenMedico, t.idTurno, 'PENDIENTE')).status, 422);
    assert.equal((await cambiar(e.tokenMedico, t.idTurno, 'FINALIZADO')).status, 422);

    const pasado = await prisma.turno.create({
      data: { fechaYhora: new Date(Date.now() - 3600000), medicoId: e.idMedico, pacienteId: e.ana.paciente.idPaciente },
    });
    assert.equal((await cambiar(e.tokenMedico, pasado.idTurno, 'CONFIRMADO')).status, 422);
    assert.equal((await cambiar(e.tokenMedico, pasado.idTurno, 'FINALIZADO')).status, 200);
  });

  test('estado inválido da 400, turno inexistente 404 e id no numérico 400', async () => {
    const e = await escenario();
    assert.equal((await cambiar(e.tokenMedico, 1, 'BORRADO')).status, 400);
    assert.equal((await cambiar(e.tokenMedico, 999999, 'CONFIRMADO')).status, 404);
    assert.equal((await request(app).patch('/api/turnos/abc').set(conToken(e.tokenMedico)).send({ estado: 'CONFIRMADO' })).status, 400);
  });
});

test.describe('reprogramar y confirmar asistencia', () => {
  test('el paciente mueve su turno: vuelve a PENDIENTE y pierde la confirmación', async () => {
    const e = await escenario();
    const t = (await reservar(e.tokenAna, e.idMedico, proximaFecha(2, 10))).body.data;
    await request(app).patch(`/api/turnos/${t.idTurno}/confirmar-asistencia`).set(conToken(e.tokenAna));
    await request(app).patch(`/api/turnos/${t.idTurno}`).set(conToken(e.tokenMedico)).send({ estado: 'CONFIRMADO' });

    const nueva = proximaFecha(2, 11);
    const res = await request(app).patch(`/api/turnos/${t.idTurno}/reprogramar`).set(conToken(e.tokenAna)).send({ fechaYhora: nueva.toISOString() });
    assert.equal(res.status, 200);
    assert.equal(res.body.data.estado, 'PENDIENTE');
    assert.equal(res.body.data.confirmadoPorPaciente, false);
    assert.equal(new Date(res.body.data.fechaYhora).getTime(), nueva.getTime());
  });

  test('reprogramar al mismo horario no choca consigo mismo, pero sí con el de otro', async () => {
    const e = await escenario();
    const fecha = proximaFecha(2, 10);
    const ocupado = proximaFecha(2, 12);
    const t = (await reservar(e.tokenAna, e.idMedico, fecha)).body.data;
    await reservar(e.tokenBeto, e.idMedico, ocupado);

    const mismo = await request(app).patch(`/api/turnos/${t.idTurno}/reprogramar`).set(conToken(e.tokenAna)).send({ fechaYhora: fecha.toISOString() });
    assert.equal(mismo.status, 200);
    const choque = await request(app).patch(`/api/turnos/${t.idTurno}/reprogramar`).set(conToken(e.tokenAna)).send({ fechaYhora: ocupado.toISOString() });
    assert.equal(choque.status, 409);
  });

  test('solo el dueño reprograma o confirma asistencia', async () => {
    const e = await escenario();
    const t = (await reservar(e.tokenAna, e.idMedico, proximaFecha(2, 10))).body.data;
    const nueva = proximaFecha(2, 11).toISOString();
    assert.equal((await request(app).patch(`/api/turnos/${t.idTurno}/reprogramar`).set(conToken(e.tokenBeto)).send({ fechaYhora: nueva })).status, 403);
    assert.equal((await request(app).patch(`/api/turnos/${t.idTurno}/confirmar-asistencia`).set(conToken(e.tokenBeto))).status, 403);
    assert.equal((await request(app).patch(`/api/turnos/${t.idTurno}/confirmar-asistencia`).set(conToken(e.tokenAna))).status, 200);
  });

  test('un turno cancelado no se puede reprogramar ni confirmar (422)', async () => {
    const e = await escenario();
    const t = (await reservar(e.tokenAna, e.idMedico, proximaFecha(2, 10))).body.data;
    await request(app).patch(`/api/turnos/${t.idTurno}`).set(conToken(e.tokenAna)).send({ estado: 'CANCELADO' });
    const nueva = proximaFecha(2, 11).toISOString();
    assert.equal((await request(app).patch(`/api/turnos/${t.idTurno}/reprogramar`).set(conToken(e.tokenAna)).send({ fechaYhora: nueva })).status, 422);
    assert.equal((await request(app).patch(`/api/turnos/${t.idTurno}/confirmar-asistencia`).set(conToken(e.tokenAna))).status, 422);
  });
});

test.describe('listados', () => {
  test('cada paciente ve solo sus turnos y el médico solo su agenda', async () => {
    const e = await escenario();
    await reservar(e.tokenAna, e.idMedico, proximaFecha(2, 10));
    await reservar(e.tokenBeto, e.idMedico, proximaFecha(2, 12));
    const otro = await escenario();
    await reservar(otro.tokenAna, otro.idMedico, proximaFecha(2, 10));

    const deAna = await request(app).get('/api/turnos/mis-turnos').set(conToken(e.tokenAna));
    assert.equal(deAna.body.data.length, 1);
    assert.equal(deAna.body.data[0].pacienteId, e.ana.paciente.idPaciente);

    const agenda = await request(app).get('/api/turnos/agenda-medico').set(conToken(e.tokenMedico));
    assert.equal(agenda.body.data.length, 2);
    assert.ok(agenda.body.data.every((t) => t.medicoId === e.idMedico));
  });

  test('el admin ve todos los turnos', async () => {
    const e = await escenario();
    await reservar(e.tokenAna, e.idMedico, proximaFecha(2, 10));
    const admin = await crearUsuario({ rol: 'admin' });
    const { token } = await iniciarSesion(admin.email);
    const res = await request(app).get('/api/turnos').set(conToken(token));
    assert.equal(res.status, 200);
    assert.ok(res.body.data.length >= 1);
  });

  test('la agenda del médico no expone la contraseña de los pacientes', async () => {
    const e = await escenario();
    await reservar(e.tokenAna, e.idMedico, proximaFecha(2, 10));
    const agenda = await request(app).get('/api/turnos/agenda-medico').set(conToken(e.tokenMedico));
    assert.ok(!JSON.stringify(agenda.body).includes('contrasena'));
  });
});
